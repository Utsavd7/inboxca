import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { todayInIndia } from "./calendar";
import { supabaseAdmin } from "./supabase";

// A firm's access setting for one person: their own, else their role's, else the firm's,
// in the same order as the database's access_setting().
export function accessSetting(settings: Record<string, unknown>, role: string, person: unknown, key: string) {
  const access = (settings.access ?? {}) as { roles?: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  return (person as Record<string, unknown> | null)?.[key] ?? access.roles?.[role]?.[key] ?? access[key];
}

// The limits an owner can choose in Settings; 0 is off.
export const IDLE_CHOICES = [0, 15, 30, 60, 120];
export const SESSION_CHOICES = [0, 4, 8, 12, 24];

// When a person was last active, for the idle limit: only the app sees activity, so it is
// kept in a cookie, signed with a key derived from the server's secret and tied to the
// person, so it can be neither moved forward nor reused by someone else.
export const SEEN_COOKIE = "inboxca_seen";
const sign = (userId: string, at: number) =>
  createHmac("sha256", createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("idle cookie").digest())
    .update(`${userId}:${at}`)
    .digest("base64url");

export const seenCookie = (userId: string, at = Date.now()) => `${at}.${sign(userId, at)}`;

// The time in a valid cookie for this person, else 0.
export function seenAt(userId: string, value: string | undefined) {
  const [at, mac = ""] = (value ?? "").split(".");
  const expected = sign(userId, Number(at));
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? Number(at) : 0;
}

// The owner's recovery codes (PLAN.md 5.17.3, 5.17.4 #23): 10 codes of 10 letters and
// digits. Only a short keyed digest of each is kept, in the person's app_metadata, which
// only the server writes and which travels in their sign in token.
const RECOVERY_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newRecoveryCodes = () =>
  Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => RECOVERY_LETTERS[randomInt(RECOVERY_LETTERS.length)]).join(""));
export const recoveryDigest = (userId: string, code: string) =>
  createHmac("sha256", createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("recovery code").digest())
    .update(`${userId}:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`)
    .digest("base64url")
    .slice(0, 22);

// The third time in a day one person does something worth a look (a screen capture, a sign
// in that ends their other session) tells the owner and partners on Home, for that day.
export async function tellOwnerOnRepeat(firmId: string, userId: string, email: string, action: string, reason: string) {
  const admin = supabaseAdmin();
  const day = todayInIndia();
  const { count } = await admin.from("activity_log").select("at", { count: "exact", head: true })
    .eq("firm_id", firmId).eq("actor_id", userId).eq("action", action).gte("at", new Date(`${day}T00:00:00+05:30`).toISOString());
  if ((count ?? 0) >= 3)
    await admin.from("requests").upsert(
      { firm_id: firmId, kind: "alert", entity_type: reason, entity_id: userId, reason_code: reason, status: "pending", details: { email, day, count } },
      { onConflict: "kind,entity_type,entity_id" },
    );
}
