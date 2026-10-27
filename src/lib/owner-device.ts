import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE, deviceName } from "./device";
import { supabaseAdmin } from "./supabase";

// The owner's login works only on computers the owner approved (PLAN.md D38): the first one by
// itself, any other from a computer already signed in, or with a recovery code when every other
// one is lost. Each is a short digest of the browser's random device cookie, keyed by the server's
// secret and tied to the person, in their app_metadata.devices; nothing about the computer itself
// is kept. The database checks the same through the server's proof (private.device_allows).
export const ASK_MINUTES = 30;
const KEPT = 20;

export async function thisComputer(userId: string) {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return token
    ? createHmac("sha256", createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("owner device").digest()).update(`${userId}:${token}`).digest("base64url").slice(0, 22)
    : "";
}

// The approved computers with this one added, the newest 20.
export const withThisComputer = async (userId: string, devices: unknown) =>
  [...new Set([...((devices ?? []) as string[]), await thisComputer(userId)].filter(Boolean))].slice(-KEPT);

// Null when this computer may use the owner's login; else whether its request waits, was refused
// or has ended. A computer that asks gets one request for its sign in session, which the owner
// answers on Today or in Settings, and is told of by phone notification and email.
export async function newComputer(userId: string, firmId: string, claims: { session_id?: unknown; app_metadata?: { [key: string]: unknown } }): Promise<"waiting" | "refused" | "ended" | null> {
  const digest = await thisComputer(userId);
  if (digest && (claims.app_metadata?.devices as string[] | undefined)?.includes(digest)) return null;
  const admin = supabaseAdmin();
  const session = String(claims.session_id ?? "");
  const [{ data: user, error }, { data: asked }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    session ? admin.from("requests").select("status, expires_at").eq("kind", "alert").eq("entity_type", "owner_device").eq("entity_id", session).maybeSingle() : { data: null },
  ]);
  if (error) throw new Error(`Owner computers not read: ${error.code}`);
  const devices = (user.user?.app_metadata.devices ?? []) as string[];
  if (digest && devices.includes(digest)) return null;
  // The first computer, or one the owner approved, from now on (the token says so at its next refresh).
  if (digest && (!devices.length || asked?.status === "approved")) {
    const { error: saved } = await admin.auth.admin.updateUserById(userId, { app_metadata: { devices: await withThisComputer(userId, devices) } });
    if (saved) throw new Error(`Owner computer not saved: ${saved.code}`);
    await admin.from("activity_log").insert({ firm_id: firmId, actor_id: userId, action: "device.trusted", entity_type: "user", entity_id: userId, details: { via: devices.length ? "approved" : "first" } });
    return null;
  }
  if (!asked && digest && session) {
    const { error: taken } = await admin.from("requests").insert({
      firm_id: firmId, kind: "alert", entity_type: "owner_device", entity_id: session, reason_code: "owner_device",
      expires_at: new Date(Date.now() + ASK_MINUTES * 60_000).toISOString(),
      details: { by: userId, name: deviceName((await headers()).get("user-agent") ?? ""), at: new Date().toISOString() },
    });
    if (!taken) await admin.from("activity_log").insert({ firm_id: firmId, actor_id: userId, action: "device.asked", entity_type: "user", entity_id: userId });
    return "waiting";
  }
  return asked?.status === "refused" ? "refused" : asked?.status === "pending" && Date.parse(asked.expires_at ?? "") > Date.now() ? "waiting" : "ended";
}
