import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// The one-time code for a private paper's link (PLAN.md 8.6) and the cookie that lets the
// browser that entered it download for 30 minutes. The cookie is signed with a key derived
// from the server's secret and bound to the send, so it opens nothing else.
export const CODE_MINUTES = 10;
export const CODE_TRIES = 5;
const OPEN_MINUTES = 30;

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const codeHash = (shareId: string, code: string) => createHash("sha256").update(`${shareId}:${code}`).digest("hex");

const key = () => createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("share code cookie").digest();
const sign = (shareId: string, until: number) => createHmac("sha256", key()).update(`${shareId}:${until}`).digest("base64url");

export const openCookie = (shareId: string) => ({ name: `inboxca_open_${shareId}`, maxAge: OPEN_MINUTES * 60 });
export const openValue = (shareId: string, until = Date.now() + OPEN_MINUTES * 60_000) => `${until}.${sign(shareId, until)}`;

// Whether a cookie value still opens this send.
export function opens(shareId: string, value: string | undefined) {
  const [until, mac = ""] = (value ?? "").split(".");
  const expected = sign(shareId, Number(until));
  return Number(until) > Date.now() && mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
