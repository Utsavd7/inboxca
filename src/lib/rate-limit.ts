import { createHmac } from "node:crypto";
import { hmacKey } from "./env";
import { supabaseAdmin } from "./supabase";

// Limits for the sign in steps anyone can reach (PLAN.md 8.9), per email address, person or
// internet address.
// Supabase Auth's own limits count per IP address, and in production every request reaches
// it from this server's address, so they cannot tell one visitor from another.
export const LIMITS = {
  code: { most: 10, seconds: 3600 }, // sign in codes emailed to one address
  signUp: { most: 10, seconds: 3600 }, // public sign ups from one internet address
  check: { most: 10, seconds: 3600 }, // email codes tried for one address
  twoStep: { most: 10, seconds: 3600 }, // authenticator app codes tried by one person
  recovery: { most: 5, seconds: 3600 }, // recovery codes tried by one person
  notice: { most: 1000, seconds: 3600 }, // OneDrive change notices posted from one internet address
  ai: { most: 120, seconds: 3600 }, // AI drafts and reminder openings for one firm (PLAN.md 5.11)
} as const;

// The database's key for a limit: a keyed digest, never the address or the person's id.
export const limitKey = (kind: keyof typeof LIMITS, who: string) =>
  createHmac("sha256", hmacKey("rate limit"))
    .update(`${kind}:${who.trim().toLowerCase()}`)
    .digest("base64url");

// Counts one try; false once the limit is reached, until the hour is over.
export async function withinLimit(kind: keyof typeof LIMITS, who: string) {
  const { most, seconds } = LIMITS[kind];
  const { data, error } = await supabaseAdmin().rpc("rate_limit", { bucket: limitKey(kind, who), most, seconds });
  if (error) throw new Error(`Rate limit not checked: ${error.code}`);
  return data === true;
}
