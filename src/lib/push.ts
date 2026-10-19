import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { supabaseAdmin } from "./supabase";

// Phone notifications from the website (Web Push, RFC 8291 and 8292), with Node's own crypto.
// The message is encrypted for the one browser, so the push service carries it unread. Off
// until the server's key pair is set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, both base64url).
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Message = { title: string; body: string; url: string };

const b64 = (value: Buffer) => value.toString("base64url");
export const pushReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// The message body for one browser: salt, record size, the server's one-time public key, and
// the text sealed with a key only that browser can derive.
export function encrypt(payload: string, keys: Subscription["keys"], salt = randomBytes(16), serverKey?: Buffer) {
  const server = createECDH("prime256v1");
  if (serverKey) server.setPrivateKey(serverKey);
  const serverPublic = serverKey ? server.getPublicKey() : server.generateKeys();
  const browserPublic = Buffer.from(keys.p256dh, "base64url");
  const info = (label: string) => Buffer.from(`Content-Encoding: ${label}\0`);
  const ikm = Buffer.from(hkdfSync("sha256", server.computeSecret(browserPublic), Buffer.from(keys.auth, "base64url"),
    Buffer.concat([Buffer.from("WebPush: info\0"), browserPublic, serverPublic]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, info("aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, info("nonce"), 12));
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, sealed]);
}

// Who sends it: a short signed note for the push service, as RFC 8292 describes.
function vapid(endpoint: string) {
  const publicKey = Buffer.from(process.env.VAPID_PUBLIC_KEY!, "base64url");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: process.env.VAPID_PRIVATE_KEY!, x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33, 65)) },
    format: "jwk",
  });
  const part = (value: object) => b64(Buffer.from(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.APP_BASE_URL || "https://inboxca.invalid" })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64(signature)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

// Sends one message to every browser these people turned notifications on in; a browser
// that no longer exists is forgotten. Message text never names a client.
export async function notify(userIds: string[], message: Message) {
  if (!pushReady() || !userIds.length) return 0;
  const admin = supabaseAdmin();
  const { data: subscriptions } = await admin.from("push_subscriptions").select("id, endpoint, keys").in("user_id", userIds);
  let sent = 0;
  for (const subscription of subscriptions ?? []) {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high", Authorization: vapid(subscription.endpoint) },
      body: new Uint8Array(encrypt(JSON.stringify(message), subscription.keys as Subscription["keys"])),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (response?.status === 404 || response?.status === 410) await admin.from("push_subscriptions").delete().eq("id", subscription.id);
    else if (response?.ok) sent++;
  }
  return sent;
}
