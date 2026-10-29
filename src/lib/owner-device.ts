import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE, deviceName } from "./device";
import { hmacKeys } from "./env";
import { supabaseAdmin } from "./supabase";

// The owner's login works only on computers the owner approved (PLAN.md D38): the first one by
// itself, any other from a computer already signed in, or with a recovery code when every other
// one is lost. Each is a short digest of the browser's random device cookie, keyed by the server's
// own key (src/lib/env.ts) and tied to the person, with when it was approved, in their
// app_metadata.devices; nothing about the computer itself is kept. The database checks the same through the server's proof
// (private.device_allows), for a sign in session that still exists.
export const ASK_MINUTES = 30;
const KEPT = 20;
export type Computer = { id: string; at: string };
export const computersOf = (devices: unknown) => (devices ?? []) as Computer[];

// This computer's digest under each key in use, the one in use first.
async function digestsOf(userId: string) {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return token ? hmacKeys("owner device").map((key) => createHmac("sha256", key).update(`${userId}:${token}`).digest("base64url").slice(0, 22)) : [];
}
export const thisComputer = async (userId: string) => (await digestsOf(userId))[0] ?? "";

// The approved computers with this one added, the newest 20.
export async function withThisComputer(userId: string, devices: unknown) {
  const ids = await digestsOf(userId), id = ids[0] ?? "";
  const others = computersOf(devices).filter((computer) => !ids.includes(computer.id));
  return id ? [...others, { id, at: new Date().toISOString() }].slice(-KEPT) : others;
}

// Null when this computer may use the owner's login; else whether its request waits, was refused
// or has ended. A computer that asks gets one request for its sign in session, which the owner
// answers on Today or in Settings, and is told of by phone notification and email.
export async function newComputer(userId: string, firmId: string, claims: { session_id?: unknown; app_metadata?: { [key: string]: unknown } }): Promise<"waiting" | "refused" | "ended" | null> {
  const digest = await thisComputer(userId);
  if (digest && computersOf(claims.app_metadata?.devices).some((computer) => computer.id === digest)) return null;
  const admin = supabaseAdmin();
  const session = String(claims.session_id ?? "");
  const [{ data: user, error }, { data: asked }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    session ? admin.from("requests").select("status, expires_at").eq("kind", "alert").eq("entity_type", "owner_device").eq("entity_id", session).maybeSingle() : { data: null },
  ]);
  if (error) throw new Error(`Owner computers not read: ${error.code}`);
  const devices = computersOf(user.user?.app_metadata.devices);
  if (digest && devices.some((computer) => computer.id === digest)) return null;
  // Approved under the key before (src/lib/env.ts hmacKeys): signed again with the key in use.
  const older = (await digestsOf(userId)).slice(1).find((id) => devices.some((computer) => computer.id === id));
  if (older) {
    const { error: saved } = await admin.auth.admin.updateUserById(userId, { app_metadata: { devices: devices.map((computer) => (computer.id === older ? { ...computer, id: digest } : computer)) } });
    if (saved) throw new Error(`Owner computer not saved: ${saved.code}`);
    return null;
  }
  // The first computer, or one the owner approved, from now on (the token says so at its next
  // refresh). An approval is used once, so a computer removed later cannot use it again.
  if (digest && (!devices.length || asked?.status === "approved")) {
    const { error: saved } = await admin.auth.admin.updateUserById(userId, { app_metadata: { devices: await withThisComputer(userId, devices) } });
    if (saved) throw new Error(`Owner computer not saved: ${saved.code}`);
    if (asked) await admin.from("requests").update({ status: "used" }).eq("kind", "alert").eq("entity_type", "owner_device").eq("entity_id", session).eq("status", "approved");
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
