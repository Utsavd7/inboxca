import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { accessSetting, SEEN_COOKIE, seenAt } from "./session";
import { officeBound, officeProof, onOfficeLine, requestAddress, type Office } from "./office";
import { DEVICE_COOKIE, deviceHash, deviceName } from "./device";
import { supabaseAdmin, supabaseServer } from "./supabase";

// The signed in person and their firm, for every product page and action; cached for the
// request, so the layout and the page share one lookup. Sends anyone who has not finished
// both sign in steps back to sign in, and signs out anyone past the firm's idle limit. Row
// level security shows only active memberships, within office hours and the session limit
// where the firm uses them; a person in two firms sees the first for now.
export const currentMember = cache(async () => {
  const signedIn = await supabaseServer();
  const { data: claims } = await signedIn.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const userId = claims.claims.sub;
  // Under Office only, the server sends the proof only from an approved PC on an office
  // line. From anywhere else it sends none, and the database shows staff nothing.
  const admin = supabaseAdmin();
  const { data: firmRow } = await admin.from("firm_members").select("firm_id, role, firms(settings)").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  const office = (firmRow?.firms?.settings as { office?: Office } | undefined)?.office;
  const requestHeaders = await headers();
  const onLine = !!office?.on && !!firmRow && officeBound(firmRow.role) && onOfficeLine(requestAddress(requestHeaders), office);
  let deviceStatus: "waiting" | "refused" | null = null;
  let approved = false;
  if (onLine && firmRow) {
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (token) {
      const tokenHash = await deviceHash(token);
      const { data } = await admin.rpc("register_device", {
        target_firm: firmRow.firm_id,
        actor: userId,
        token_digest: tokenHash,
        label: deviceName(requestHeaders.get("user-agent") ?? ""),
      });
      const device = data?.[0];
      approved = device?.status === "approved";
      if (device?.status === "waiting" || device?.status === "refused") deviceStatus = device.status;
    } else deviceStatus = "waiting";
  }
  const fromOffice = onLine && approved;
  const supabase = fromOffice ? await supabaseServer({ "x-inboxca-office": await officeProof(userId, String(claims.claims.session_id ?? "")) }) : signedIn;
  const { data } = await supabase
    .from("firm_members")
    .select("firm_id, role, access, firms(name, settings)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) return { supabase, userId, membership: null, deviceStatus };

  const settings = (data.firms?.settings ?? {}) as Record<string, unknown>;
  const idleMinutes = Number(accessSetting(settings, data.role, data.access, "idle_minutes")) || 0;
  if (idleMinutes) {
    // Last active: the signed cookie, or the 2 step code if there is none yet.
    const twoStep = (claims.claims.amr ?? []).flatMap((entry) =>
      typeof entry === "object" && entry.method === "totp" ? [entry.timestamp * 1000] : [],
    );
    const last = Math.max(0, ...twoStep, seenAt(userId, (await cookies()).get(SEEN_COOKIE)?.value));
    if (Date.now() - last > idleMinutes * 60_000) redirect("/auth/sign-out?reason=idle");
  }
  const membership = { firmId: data.firm_id, firmName: data.firms?.name ?? "", settings, role: data.role, idleMinutes, email: String(claims.claims.email ?? "") };
  return { supabase, userId, membership, deviceStatus };
});
