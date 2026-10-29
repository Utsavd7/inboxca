"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dpaUpdated, legalUpdated } from "@/content/legal";
import { log } from "@/src/lib/logger";
import { requestAddress } from "@/src/lib/office";
import { withinLimit } from "@/src/lib/rate-limit";
import { firmlessAccount } from "@/src/lib/sign-in";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";
import { keepSignUp } from "./finish";
import { states } from "./states";

// Public sign up (PLAN.md D5): the firm starts pending, as the plan has it for a firm
// that has not paid. Billing is left out for now, so the owner goes straight in. The firm is
// made once the email code proves the address (finish.ts).
// field: the input a refusal is about, so its words show under it.
export type SignUpState = { email?: string; error?: string; field?: string; fields?: Record<string, string> };

export async function signUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const name = String(form.get("firm") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const state = String(form.get("state") ?? "");
  // A refused form shows again with what was typed, the box still ticked.
  const fail = (error: string, field?: string) => ({ error, field, fields: { firm: name, email, state, accept: String(form.get("accept") ?? "") } });
  if (!name || name.length > 200) return fail("Enter your firm's name.", "firm");
  if (!z.email().safeParse(email).success) return fail("Enter a valid email address.", "email");
  const wrong = detailsProblem(state, form);
  if (wrong) return fail(...wrong);

  // The code this sends counts towards the address's sign in codes, whether it has an account or
  // not, and towards the sign ups from the visitor's internet address, when the host says it.
  if (!(await withinLimit("code", email))) return fail("Too many codes asked for this address. Try again in an hour.", "email");
  const from = requestAddress(await headers());
  if (from && !(await withinLimit("signUp", from))) return fail("Too many sign ups from this internet connection. Try again in an hour.");
  if (await busy()) return fail("Sign up is busy right now. Try again in an hour.");
  // The login is made now, as Supabase emails a code only to an existing one. An address that
  // already has an account gets an ordinary sign in code, so this page never tells a visitor
  // which addresses have accounts; it makes a firm only if that account is in none yet.
  const { error } = await supabaseAdmin().auth.admin.createUser({ email, email_confirm: true });
  if (error && error.code !== "email_exists") return fail("Sign up did not work. Try again in a minute.");
  await keepSignUp({ email, firm: name, state });
  return sendCode(email);
}

// After Google or Microsoft: a signed in person in no firm yet sets one up as its owner, with
// the address the provider confirmed, then sets up the 2 step code.
export async function setUpFirm(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const account = await firmlessAccount();
  if (!account) redirect("/sign-in");
  const name = String(form.get("firm") ?? "").trim();
  const state = String(form.get("state") ?? "");
  const fail = (error: string, field?: string) => ({ error, field, fields: { firm: name, state, accept: String(form.get("accept") ?? "") } });
  if (!name || name.length > 200) return fail("Enter your firm's name.", "firm");
  const wrong = detailsProblem(state, form);
  if (wrong) return fail(...wrong);
  if (await busy()) return fail("Sign up is busy right now. Try again in an hour.");
  const { error } = await supabaseAdmin().rpc("sign_up_firm", {
    firm_name: name,
    state,
    owner: account.id,
    accepted: { terms: legalUpdated, privacy: legalUpdated, dpa: dpaUpdated },
  });
  if (error) {
    log.error("sign_up.firm_failed", { code: error.code });
    return fail("Sign up did not work. Try again in a minute.");
  }
  redirect("/sign-in/two-step");
}

function detailsProblem(state: string, form: FormData): [string, string] | undefined {
  if (!states.some(([code]) => code === state)) return ["Choose your firm's state.", "state"];
  if (form.get("accept") !== "on") return ["Tick the box to accept the terms, privacy notice and DPA.", "accept"];
}

// A public form that makes firms and sends email: at most 30 new firms an hour in all, counted
// once their address is proved.
async function busy() {
  const { count } = await supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true })
    .eq("action", "firm.signed_up").gte("at", new Date(Date.now() - 3_600_000).toISOString());
  return (count ?? 0) >= 30;
}

async function sendCode(email: string): Promise<SignUpState> {
  const origin = (await headers()).get("origin") ?? process.env.APP_BASE_URL ?? "";
  const supabase = await supabaseServer();
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` },
  });
  return { email };
}
