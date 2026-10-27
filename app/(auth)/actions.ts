"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/src/lib/logger";
import { mailboxLogin } from "@/src/lib/mailbox-login";
import { chosenFirm } from "@/src/lib/office";
import { CHALLENGE_COOKIE, checkAdminKeyUse, newChallenge } from "@/src/lib/pc-key";
import { withinLimit } from "@/src/lib/rate-limit";
import { recoveryDigest, SEEN_COOKIE } from "@/src/lib/session";
import { afterFirstStep, factorCode, isProvider, oneSession, providers, readyProviders } from "@/src/lib/sign-in";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

// Sign in: an email code, or Google or Microsoft, first; then a code from an authenticator
// app (PLAN.md 4.4).

export type CodeState = { step: "email" | "code"; email?: string; error?: string };

export async function requestCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success)
    return { step: "email", error: "Enter a valid email address." };
  if (await mailboxLogin(email))
    return { step: "email", email, error: "This is your firm email, which InboxCA reads. Sign in with your own work email instead." };
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
    return { step: "code", email, error: "This is your firm email, which InboxCA reads. Sign in with your own work email instead." };
  // A shared PC (5.17.4 #3): whoever was signed in on this browser before is signed out.
  const { data: before } = await supabase.auth.getSession();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error)
    return { step: "code", email, error: "That code did not work. Check it, or ask for a new one." };
  if (before.session) await supabaseAdmin().auth.admin.signOut(before.session.access_token, "local");
  redirect(data.user ? await afterFirstStep(supabase, data.user.id, email) : "/sign-in/two-step");
}

// Continue with Google or Microsoft, by Supabase Auth: the PKCE verifier waits in a cookie
// for /auth/callback, which carries on as after the email code.
export async function continueWith(form: FormData) {
  const provider = form.get("provider");
  if (!isProvider(provider) || !readyProviders().includes(provider)) redirect("/sign-in");
  const origin = (await headers()).get("origin") ?? process.env.APP_BASE_URL ?? "";
  const { data, error } = await (await supabaseServer()).auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback?via=${provider}`, scopes: providers[provider].scopes },
  });
  if (error || !data.url) {
    log.warn("sign_in.provider_start_failed", { provider, status: error?.status });
    redirect(`/sign-in?reason=provider&via=${provider}`);
  }
  redirect(data.url);
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
  return afterTwoStep(supabase);
}

async function afterTwoStep(supabase: Awaited<ReturnType<typeof supabaseServer>>): Promise<never> {
  const { data: claims } = await supabase.auth.getClaims();
  if (claims) await oneSession(supabase, claims.claims.sub, String(claims.claims.email ?? ""));
  // An Orelu admin checks a passkey next (PLAN.md 8.1).
  const { data: admin } = claims ? await supabaseAdmin().from("orelu_admins").select("user_id").eq("user_id", claims.claims.sub).maybeSingle() : { data: null };
  redirect(admin ? "/sign-in/passkey" : "/app");
}

// A passkey in place of the 6 digit code (PLAN.md 5.17, 8.5), after the email code as before; or
// a new one, named, from Settings. A one time question for this person's passkeys.
export async function personPasskeyChallenge(name?: string) {
  const { data: claims } = await (await supabaseServer()).auth.getClaims();
  if (!claims) redirect("/sign-in");
  const userId = claims.claims.sub;
  const admin = supabaseAdmin();
  // One passkey per name, checked before the device makes it.
  if (name !== undefined) {
    const clean = name.trim();
    if (!clean || clean.length > 40) return { error: "Name the passkey first, in up to 40 letters, such as Office laptop." };
    const { count } = await admin.from("passkeys").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("name", clean);
    if (count) return { error: `You already have a passkey named ${clean}. Choose another name.` };
  }
  const { challenge, cookie } = newChallenge(`passkey:${userId}`);
  (await cookies()).set(CHALLENGE_COOKIE, cookie, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
  const { data: keys } = await admin.from("passkeys").select("id").eq("user_id", userId);
  // Its own name on the device, so it never replaces an Orelu admin passkey made there.
  return { challenge, userId: `person:${userId}`, email: String(claims.claims.email ?? ""), keys: (keys ?? []).map((key) => key.id) };
}

const usedKey = z.object({ id: z.base64url().max(400), clientDataJSON: z.base64url().max(4000), authenticatorData: z.base64url().max(4000), signature: z.base64url().max(1000) });

// The passkey checks out, so the server answers the passkey's own 2 step factor with the code only
// it can make: to the database this is a 2 step sign in like any other. A signature counter that
// does not go up means a copied passkey: refused and logged.
export async function checkPersonPasskey(key: z.infer<typeof usedKey>) {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  const userId = claims.claims.sub;
  if (!(await withinLimit("twoStep", userId))) return "Too many tries. Wait an hour, then try again.";
  const admin = supabaseAdmin();
  const jar = await cookies();
  const parsed = usedKey.safeParse(key);
  const { data: saved } = parsed.success ? await admin.from("passkeys").select("public_key, counter, factor_id, secret").eq("id", parsed.data.id).eq("user_id", userId).maybeSingle() : { data: null };
  const counter = parsed.success && saved ? checkAdminKeyUse(parsed.data, saved.public_key, (await headers()).get("origin") ?? "", jar.get(CHALLENGE_COOKIE)?.value, userId, "passkey") : null;
  if (!parsed.success || !saved || counter === null) return "That passkey did not work. Try again, or enter the 6 digit code.";
  if ((counter || saved.counter) && counter <= saved.counter) {
    const member = await chosenFirm((await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
    if (member) await admin.from("activity_log").insert({ firm_id: member.firm_id, actor_id: userId, action: "passkey.copied", entity_type: "user", entity_id: userId });
    return "That passkey looks copied. Enter the 6 digit code, then remove the passkey in Your sign in.";
  }
  jar.delete(CHALLENGE_COOKIE);
  await admin.from("passkeys").update({ counter }).eq("id", parsed.data.id);
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: saved.factor_id, code: await factorCode(userId, saved.secret) });
  if (error) return "The passkey could not finish signing you in. Enter the 6 digit code instead.";
  return afterTwoStep(supabase);
}

// Lost phone (5.17.4 #23): after the email code, one of the owner's recovery codes removes
// the authenticator app, so a new one is set up next, and any passkeys with their factors.
// Each code works once.
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
  if (error) return { error: "That recovery code could not be used just now. Try again in a minute." };
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
  const { count: passkeys } = await admin.from("passkeys").select("id", { count: "exact", head: true }).eq("user_id", userId);
  for (const factor of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
  const member = await chosenFirm((await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
  if (member) await admin.from("activity_log").insert({ firm_id: member.firm_id, actor_id: userId, action: "recovery.used", entity_type: "user", entity_id: userId, details: { left: saved.length - 1, passkeys: passkeys ?? 0 } });
  redirect("/sign-in/two-step");
}

// Signs out this browser only; the person's other devices stay signed in.
export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(SEEN_COOKIE);
  redirect("/sign-in");
}
