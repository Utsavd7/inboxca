"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/src/lib/logger";
import { mailboxLogin } from "@/src/lib/mailbox-login";
import { officeDeviceAccess } from "@/src/lib/office";
import { withinLimit } from "@/src/lib/rate-limit";
import { recoveryDigest, SEEN_COOKIE, tellOwnerOnRepeat } from "@/src/lib/session";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

// Sign in: an email code first, then a code from an authenticator app (PLAN.md 4.4).
// Nobody can sign up here: people are added by their firm's owner or at payment.

export type CodeState = { step: "email" | "code"; email?: string; error?: string };

export async function requestCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success)
    return { step: "email", error: "Enter a valid email address." };
  if (await mailboxLogin(email))
    return { step: "email", email, error: "The firm's email address cannot be used to sign in." };
  // Counted for every address alike, so the answer never tells whether it has an account.
  if (!(await withinLimit("code", email)))
    return { step: "email", email, error: "Too many codes asked for this address. Try again in an hour." };
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
  if (!(await withinLimit("check", email)))
    return { step: "code", email, error: "Too many codes tried. Wait an hour, then ask for a new one." };
  const supabase = await supabaseServer();
  if (await mailboxLogin(email))
    return { step: "code", email, error: "The firm's email address cannot be used to sign in." };
  // A shared PC (5.17.4 #3): whoever was signed in on this browser before is signed out.
  const { data: before } = await supabase.auth.getSession();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error)
    return { step: "code", email, error: "That code did not work. Check it, or ask for a new one." };
  if (before.session) await supabaseAdmin().auth.admin.signOut(before.session.access_token, "local");
  if (data.user && (await officeDeviceAccess(data.user.id)).approved) {
    await oneSession(supabase, data.user.id, email);
    redirect("/app");
  }
  redirect("/sign-in/two-step");
}

// Under Office only a finished sign in ends the person's other sessions (PLAN.md 5.17.4 #39):
// a shared login or a second PC stops working at once, and repeats tell the owner.
async function oneSession(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string, email: string) {
  const { data: ended } = await supabase.rpc("end_other_sessions");
  if (!ended) return;
  const admin = supabaseAdmin();
  const { data: member } = await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  if (!member) return;
  await admin.from("activity_log").insert({ firm_id: member.firm_id, actor_id: userId, action: "session.ended_other", entity_type: "user", entity_id: userId, details: { ended } });
  await tellOwnerOnRepeat(member.firm_id, userId, email, "session.ended_other", "parallel");
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
  const { data: signedIn } = await supabase.auth.getClaims();
  if (signedIn && !(await withinLimit("twoStep", signedIn.claims.sub))) return { error: "Too many tries. Wait an hour, then try again." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code did not work. Codes change every 30 seconds; try the new one." };
  const { data: claims } = await supabase.auth.getClaims();
  if (claims) await oneSession(supabase, claims.claims.sub, String(claims.claims.email ?? ""));
  // An Orelu admin checks a passkey next (PLAN.md 8.1).
  const { data: admin } = claims ? await supabaseAdmin().from("orelu_admins").select("user_id").eq("user_id", claims.claims.sub).maybeSingle() : { data: null };
  redirect(admin ? "/sign-in/passkey" : "/app");
}

// Lost phone (5.17.4 #23): after the email code, one of the owner's recovery codes removes
// the authenticator app, so a new one is set up next. Each code works once.
export async function recoverTwoStep(_prev: StepState, form: FormData): Promise<StepState> {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  const userId = claims.claims.sub;
  if (!(await withinLimit("recovery", userId))) return { error: "Too many tries. Wait an hour, then try again." };
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.getUserById(userId);
  const saved = (data.user?.app_metadata.recovery ?? []) as string[];
  const digest = recoveryDigest(userId, String(form.get("recovery") ?? ""));
  if (!saved.includes(digest)) return { error: "That recovery code did not work. Check it, or use another one." };
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { recovery: saved.filter((code) => code !== digest) } });
  if (error) throw new Error(`Recovery code not used: ${error.code}`);
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const factor of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
  const { data: member } = await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  if (member) await admin.from("activity_log").insert({ firm_id: member.firm_id, actor_id: userId, action: "recovery.used", entity_type: "user", entity_id: userId, details: { left: saved.length - 1 } });
  redirect("/sign-in/two-step");
}

// Signs out this browser only; the person's other devices stay signed in.
export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(SEEN_COOKIE);
  redirect("/sign-in");
}
