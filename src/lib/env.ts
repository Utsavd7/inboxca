import { createHmac } from "node:crypto";

// What the server will not start without (instrumentation.ts). APP_HMAC_KEY is its own key for
// the digests and signed cookies it keeps: recovery codes, approved owner computers, PC key
// questions, the idle and private paper cookies, rate limits and the AI cache. It is apart from
// Supabase's secret, so rotating that one changes none of them.
export function checkEnv(env: Record<string, string | undefined> = process.env) {
  if ((env.APP_HMAC_KEY ?? "").length < 32) throw new Error("APP_HMAC_KEY must be set to 32 or more random characters (openssl rand -base64 32)");
}

const derive = (secret: string, use: string) => createHmac("sha256", secret).update(use).digest();

// One key for each use, so a digest made for one never passes for another.
export function hmacKey(use: string) {
  checkEnv();
  return derive(process.env.APP_HMAC_KEY!, use);
}

// The keys a kept digest or a cookie may have been made with, the one in use first. While
// APP_HMAC_OLD_KEY is set (the key before, at first the SUPABASE_SECRET_KEY these were made with),
// what it made is still accepted, and owner computers and the idle cookie are signed again with
// the key in use as they are seen. A recovery code cannot be: only its digest is kept.
export const hmacKeys = (use: string) => [hmacKey(use), ...(process.env.APP_HMAC_OLD_KEY ? [derive(process.env.APP_HMAC_OLD_KEY, use)] : [])];
