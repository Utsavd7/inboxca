import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { closingToday } from "./hours";
import { may, type Permissions, type Right } from "./rights";
import { accessSetting, SEEN_COOKIE, seenAt } from "./session";
import { officeDeviceAccess, officeProof } from "./office";
import { supabaseAdmin, supabaseServer } from "./supabase";

// The signed in person and their firm, for every product page and action; cached for the
// request, so the layout and the page share one lookup. Sends anyone who has not finished
// the required sign in steps back to sign in, and signs out anyone past the firm's idle limit. Row
// level security shows only active memberships, within office hours and the session limit
// where the firm uses them; a person in two firms sees the first for now.
export const currentMember = cache(async () => {
  const signedIn = await supabaseServer();
  const { data: claims } = await signedIn.auth.getClaims();
  if (!claims) redirect("/sign-in");
  const userId = claims.claims.sub;
  const office = await officeDeviceAccess(userId);
  if (claims.claims.aal !== "aal2" && !office.approved) redirect("/sign-in/two-step");
  const supabase = office.approved || office.remoteUntil ? await supabaseServer({ "x-inboxca-office": await officeProof(userId, String(claims.claims.session_id ?? "")) }) : signedIn;
  const { data } = await supabase
    .from("firm_members")
    .select("firm_id, role, access, firms(name, settings)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) {
    const { data: closed } = await supabase.rpc("closed_firms");
    if (closed?.[0]?.reason === "hours") {
      const { data: firm } = await supabaseAdmin().from("firm_members").select("firm_id")
        .eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
      if (firm) {
        const { error } = await supabaseAdmin().rpc("office_refused", { target_firm: firm.firm_id, person: userId, reason: "hours" });
        if (error) throw new Error(`Office refusal failed: ${error.code}`);
      }
    }
  }
  if (!data) return { supabase, userId, membership: null, deviceStatus: office.deviceStatus, connectionWaiting: office.connectionWaiting };
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
  // Closing time today for anyone office hours bind, for the warning before it.
  const closing = data.role !== "owner" && accessSetting(settings, data.role, data.access, "hours_only") ? closingToday(settings, data.access) : null;
  const membership = {
    firmId: data.firm_id, firmName: data.firms?.name ?? "", settings, role: data.role, access, idleMinutes, closing, email: String(claims.claims.email ?? ""),
    // On a personal device allowed away from the office the person only views, until its end date.
    viewOnlyUntil: office.remoteUntil,
    may: (right: Right) => !office.remoteUntil && may(data.role, right, settings.permissions as Permissions, (access.always ?? []) as string[]),
  };
  return { supabase, userId, membership, deviceStatus: office.deviceStatus, connectionWaiting: office.connectionWaiting };
});

// For actions that change anything: a view only device gets no further.
export async function currentWriter() {
  const member = await currentMember();
  if (member.membership?.viewOnlyUntil) redirect("/app?error=view_only");
  return member;
}
