"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/src/lib/logger";
import { SEEN_COOKIE } from "@/src/lib/session";
import { supabaseServer } from "@/src/lib/supabase";

// Sign in: an email code first, then a code from an authenticator app (PLAN.md 4.4).
// Nobody can sign up here: people are added by their firm's owner or at payment.

export type CodeState = { step: "email" | "code"; email?: string; error?: string };

export async function requestCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success)
    return { step: "email", error: "Enter a valid email address." };
  const supabase = await supabaseServer();
  const origin = (await headers()).get("origin") ?? process.env.APP_BASE_URL ?? "";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error?.status === 429)
    return { step: "email", email, error: "Too many tries. Wait a minute, then ask again." };
  // Any other refusal (an email with no account) looks the same as success, so this
  // page never tells anyone whether an address belongs to InboxCA.
  if (error) log.info("sign_in.code_refused", { status: error.status });
  return { step: "code", email };
}

export async function verifyCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "");
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token))
    return { step: "code", email, error: "The code is the 6 digits in the email." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error)
    return { step: "code", email, error: "That code did not work. Check it, or ask for a new one." };
  redirect("/sign-in/two-step");
}

export type Enrollment = { factorId: string; qr: string; secret: string } | { error: string };

// First sign in: a new authenticator app factor. Earlier unfinished ones are removed,
// so a reloaded page never leaves stray factors behind.
export async function startEnrollment(): Promise<Enrollment> {
  const supabase = await supabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? [])
    if (factor.factor_type === "totp" && factor.status === "unverified")
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
    issuer: "InboxCA",
  });
  if (error || !data) return { error: "The 2 step setup could not start. Reload the page." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export type StepState = { error?: string };

export async function verifyTwoStep(_prev: StepState, form: FormData): Promise<StepState> {
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6 digit code from your authenticator app." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code did not work. Codes change every 30 seconds; try the new one." };
  redirect("/app");
}

// Signs out this browser only; the person's other devices stay signed in.
export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(SEEN_COOKIE);
  redirect("/sign-in");
}
