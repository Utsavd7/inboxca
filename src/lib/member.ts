import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { billingReady } from "./billing/provider";
import { closingToday } from "./hours";
import { may, mayDecide, type Permissions, type Right, type Standing } from "./rights";
import { accessSetting, SEEN_COOKIE, seenAt } from "./session";
import { chosenFirm, memberHours, officeDeviceAccess, officeProof } from "./office";
import { newComputer } from "./owner-device";
import { personName } from "./roles";
import { supabaseAdmin, supabaseServer } from "./supabase";

// The signed in person and their firm, for every product page and action; cached for the
// request, so the layout and the page share one lookup. Sends anyone who has not finished
// the required sign in steps back to sign in, and signs out anyone past the firm's idle limit. Row
// level security shows only active memberships, within office hours and the session limit
// where the firm uses them. A person in two firms works in the one they last chose in the
// sidebar (FIRM_COOKIE), else the first, and every query after this names it
// (x-inboxca-firm), so the database shows that firm alone.
export { FIRM_COOKIE } from "./office";
export const signedInMember = cache(async () => {
  const signedIn = await supabaseServer();
  const { data: claims } = await signedIn.auth.getClaims();
  if (!claims) redirect("/sign-in");
  const userId = claims.claims.sub;
  const office = await officeDeviceAccess(userId);
  if (claims.claims.aal !== "aal2" && (!office.approved || office.anywhere)) redirect("/sign-in/two-step");
  const session = String(claims.claims.session_id ?? "");
  // The owner's login on a computer the owner has not approved reaches nothing of the firm (D38).
  const ownerDevice = office.ownerOf ? await newComputer(userId, office.ownerOf, claims.claims) : null;
  if (ownerDevice) return { supabase: signedIn, userId, membership: null, deviceStatus: null, connectionWaiting: false, pcKey: null, ownerDevice };
  // India only (5.17, Remote friendly): the country the host vouches for, from the header
  // COUNTRY_HEADER names (Cloudflare's CF-IPCountry); unset, the check is off. The database
  // refuses those it binds without this proof (country_allows); the owner works from anywhere.
  const countryHeader = process.env.COUNTRY_HEADER;
  const inIndia = !countryHeader || (await headers()).get(countryHeader) === "IN";
  const proof = {
    ...(office.approved || office.remoteUntil ? { "x-inboxca-office": await officeProof(userId, session) } : {}),
    ...(inIndia && { "x-inboxca-country": await officeProof(`country:${userId}`, session) }),
    ...(office.ownerOf && { "x-inboxca-device": await officeProof(`device:${userId}`, session) }),
  };
  const anyFirm = Object.keys(proof).length ? await supabaseServer(proof) : signedIn;
  const { data: rows } = await anyFirm
    .from("firm_members")
    .select("firm_id, role, access, firms(name, settings, status), branch:groups!firm_members_firm_id_branch_id_fkey(kind, settings)")
    .eq("user_id", userId)
    .order("firm_id")
    .limit(20);
  const data = await chosenFirm(rows);
  const supabase = data ? await supabaseServer({ ...proof, "x-inboxca-firm": data.firm_id }) : anyFirm;
  if (!data) {
    const { data: closed } = await supabase.rpc("closed_firms");
    if (closed?.[0]?.reason === "country") redirect("/auth/sign-out?reason=country");
    if (closed?.[0]?.reason === "hours") {
      const firm = await chosenFirm((await supabaseAdmin().from("firm_members").select("firm_id")
        .eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
      if (firm) {
        const { error } = await supabaseAdmin().rpc("office_refused", { target_firm: firm.firm_id, person: userId, reason: "hours" });
        if (error) throw new Error(`Office refusal failed: ${error.code}`);
      }
    }
  }
  if (!data) return { supabase, userId, membership: null, deviceStatus: office.deviceStatus, connectionWaiting: office.connectionWaiting, pcKey: office.pcKey };
  const access = (data.access ?? {}) as Record<string, unknown>;

  const settings = (data.firms?.settings ?? {}) as Record<string, unknown>;
  const idleMinutes = Number(accessSetting(settings, data.role, data.access, "idle_minutes")) || 0;
  if (idleMinutes) {
    // Last active: the signed cookie, or the latest sign in proof if there is none yet.
    const signedAt = (claims.claims.amr ?? []).flatMap((entry) =>
      typeof entry === "object" ? [entry.timestamp * 1000] : [],
    );
    const last = Math.max(0, ...signedAt, seenAt(userId, (await cookies()).get(SEEN_COOKIE)?.value));
    if (Date.now() - last > idleMinutes * 60_000) redirect("/auth/sign-out?reason=idle");
  }
  // Closing time today for anyone office hours bind, by their branch's hours if it has its own,
  // for the warning before it.
  const closing = data.role !== "owner" && accessSetting(settings, data.role, data.access, "hours_only") ? closingToday(memberHours(settings, data.branch), data.access) : null;
  // The plan (5.14.1): a firm signed up but not yet paid, once payments are set up, waits for its
  // first payment; days 0 to 7 unpaid show a banner; read only after that and after a money back.
  // Read only keeps each person's own view and changes nothing; the owner can still pay.
  const status = data.firms?.status;
  const billing = status === "pending" && billingReady() ? "start" : status === "grace" || status === "read_only" ? status : null;
  const viewOnlyUntil = office.remoteUntil ?? (billing === "start" || billing === "read_only" ? "billing" : undefined);
  const email = String(claims.claims.email ?? "");
  const membership = {
    firmId: data.firm_id, firmName: data.firms?.name ?? "", settings, role: data.role, access, idleMinutes, closing, email,
    // How the app names this person: the name from Google or Microsoft, else from the email.
    name: personName(email, claims.claims.user_metadata?.full_name ?? claims.claims.user_metadata?.name),
    // Every firm the person may open now, for the sidebar's switcher.
    firms: rows!.map((row) => ({ id: row.firm_id, name: row.firms?.name ?? "" })),
    // On a personal device allowed away from the office the person only views, until its end date.
    viewOnlyUntil,
    billing,
    may: (right: Right, client?: string) => !viewOnlyUntil && may(data.role, right, settings.permissions as Permissions, (access.always ?? []) as Standing[], client),
  };
  return { supabase, userId, membership, deviceStatus: office.deviceStatus, connectionWaiting: office.connectionWaiting, pcKey: office.pcKey };
});
// Sign up's plan and payment come first (5.14.1): until the first payment is in, every page,
// action and route of the app opens /start instead. /start and the owner's billing actions read
// signedInMember itself, so the plan can be paid and nothing loops.
export const currentMember = cache(async () => {
  const member = await signedInMember();
  if (member.membership?.billing === "start") redirect("/start");
  return member;
});

// The permission questions this person may answer now (5.17.2): never their own; a manager or
// partner only their team's, with the right to approve. Today, the Inbox and the menu's Inbox
// count all read this one list.
export const myQuestions = cache(async () => {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) return [];
  const [{ data: asks }, { data: me }] = await Promise.all([
    supabase.from("requests").select("id, client_id, reason_code, details, clients(name)").eq("kind", "permission").eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(200),
    supabase.from("firm_members").select("role, team_id").eq("firm_id", membership.firmId).eq("user_id", userId).single(),
  ]);
  const deputy = ((membership.settings.office as { deputies?: string[] } | undefined)?.deputies ?? []).includes(userId);
  return (asks ?? []).filter((request) => me && (!["manager", "partner"].includes(me.role) || deputy || membership.may("approve_requests", request.client_id ?? undefined)) && mayDecide({ id: userId, role: me.role, team_id: me.team_id, deputy }, request.details as { by: string; route: "owner" | "manager"; team_id: string | null }));
});

// Why a button is off for someone who may only view, in one line beside it.
export const viewOnlyWords = (until?: string) => (until ? (until === "billing" ? "Your firm can only view for now." : "This laptop can only view while it is away from the office.") : "");

// For actions that change anything: a view only device gets no further.
export async function currentWriter() {
  const member = await currentMember();
  if (member.membership?.viewOnlyUntil) redirect(`/app?error=${member.membership.viewOnlyUntil === "billing" ? "billing" : "view_only"}`);
  return member;
}
