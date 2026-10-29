import { cookies } from "next/headers";
import { z } from "zod";
import { dpaUpdated, legalUpdated } from "@/content/legal";
import { log } from "@/src/lib/logger";
import { inNoFirm } from "@/src/lib/sign-in";
import { supabaseAdmin } from "@/src/lib/supabase";
import { states } from "./states";

// Public sign up's firm details wait in this browser, for an hour at most, until the email code
// proves the address (verifyCode, or the email's link): only then is the firm made, so an address
// nobody proved makes no firm and uses none of sign up's hourly limit. Checked again when read,
// as anyone can change their own cookie.
const COOKIE = "inboxca_sign_up";
const kept = z.object({ email: z.string(), firm: z.string().trim().min(1).max(200), state: z.string().refine((code) => states.some(([state]) => state === code)) });

export async function keepSignUp(details: z.infer<typeof kept>) {
  (await cookies()).set(COOKIE, Buffer.from(JSON.stringify(details)).toString("base64url"), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
}

// After the email code: the firm, for the address that asked, if it is in no firm yet.
export async function finishSignUp(userId: string, email: string) {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return;
  store.delete(COOKIE);
  let details;
  try {
    details = kept.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
  } catch {
    return;
  }
  if (details.email !== email.toLowerCase() || !(await inNoFirm(userId))) return;
  const { error } = await supabaseAdmin().rpc("sign_up_firm", {
    firm_name: details.firm,
    state: details.state,
    owner: userId,
    accepted: { terms: legalUpdated, privacy: legalUpdated, dpa: dpaUpdated },
  });
  if (error) log.error("sign_up.firm_failed", { code: error.code });
}
