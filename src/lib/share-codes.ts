import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { hmacKey, hmacKeys } from "./env";

// The one-time code for a private paper's link (PLAN.md 8.6) and the cookie that lets the
// browser that entered it download for 30 minutes. The cookie is signed with the server's own
// key (src/lib/env.ts) and bound to the send, so it opens nothing else.
export const CODE_MINUTES = 10;
export const CODE_TRIES = 5;
const OPEN_MINUTES = 30;

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const codeHash = (shareId: string, code: string) => createHash("sha256").update(`${shareId}:${code}`).digest("hex");

const sign = (shareId: string, until: number, key = hmacKey("share code cookie")) => createHmac("sha256", key).update(`${shareId}:${until}`).digest("base64url");

export const openCookie = (shareId: string) => ({ name: `inboxca_open_${shareId}`, maxAge: OPEN_MINUTES * 60 });
export const openValue = (shareId: string, until = Date.now() + OPEN_MINUTES * 60_000) => `${until}.${sign(shareId, until)}`;

// Whether a cookie value still opens this send.
export function opens(shareId: string, value: string | undefined) {
  const [until, mac = ""] = (value ?? "").split(".");
  return Number(until) > Date.now() && hmacKeys("share code cookie").some((key) => {
    const expected = sign(shareId, Number(until), key);
    return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  });
}
