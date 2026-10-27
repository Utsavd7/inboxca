import { cookies } from "next/headers";
import { serverKek } from "./crypto";
import { chosenFirm, officeDeviceAccess } from "./office";
import { totp } from "./pc-key";
import { tellOwnerOnRepeat } from "./session";
import { supabaseAdmin, supabaseServer } from "./supabase";

// Continue with Google or Microsoft: Supabase Auth's own sign in with PKCE, asking only for
// the person's address and name (openid, email, profile). Each shows only once its app is
// registered and its client ID is set, under the same name Supabase's config.toml reads.
// Microsoft uses the common tenant, so work and personal accounts both sign in.
export const providers = {
  google: { name: "Google", env: "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", scopes: undefined },
  azure: { name: "Microsoft", env: "SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID", scopes: "email profile" },
} as const;
export type Provider = keyof typeof providers;
export const isProvider = (value: unknown): value is Provider => value === "google" || value === "azure";
export const readyProviders = () => (Object.keys(providers) as Provider[]).filter((provider) => !!process.env[providers[provider].env]);
// The buttons the sign in and sign up pages show.
export const providerChoices = () => readyProviders().map((id) => ({ id, name: providers[id].name }));

// Why Supabase sent the person back without a sign in, from its error query: cancelled
// (cancel or refused consent), unverified (the provider has not confirmed the address), or
// anything else.
export function refusal(params: URLSearchParams) {
  const code = params.get("error_code");
  if (code === "provider_email_needs_verification") return "unverified";
  return !code && params.get("error") === "access_denied" ? "cancelled" : "provider";
}

// Whether a person is in no firm yet (invited, active or removed), nor an Orelu admin: they
// set one up next. The server's own access, because row level security hides invited and
// removed memberships, and those outside office hours.
export async function inNoFirm(userId: string) {
  const admin = supabaseAdmin();
  const [{ count }, { data: orelu }] = await Promise.all([
    admin.from("firm_members").select("firm_id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("orelu_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  return !count && !orelu;
}

// The signed in person, when they are in no firm yet. A visitor with no session cookie is no one,
// without asking Supabase.
export async function firmlessAccount() {
  if (!(await cookies()).getAll().some(({ name }) => /^sb-.+-auth-token/.test(name))) return null;
  const { data } = await (await supabaseServer()).auth.getClaims();
  return data && (await inNoFirm(data.claims.sub)) ? { id: data.claims.sub, email: String(data.claims.email ?? "") } : null;
}

// Under Office only a finished sign in ends the person's other sessions (PLAN.md 5.17.4 #39):
// a shared login or a second PC stops working at once, and repeats tell the owner.
export async function oneSession(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string, email: string) {
  const { data: ended } = await supabase.rpc("end_other_sessions");
  if (!ended) return;
  const admin = supabaseAdmin();
  const member = await chosenFirm((await admin.from("firm_members").select("firm_id").eq("user_id", userId).eq("status", "active").order("firm_id").limit(20)).data);
  if (!member) return;
  await admin.from("activity_log").insert({ firm_id: member.firm_id, actor_id: userId, action: "session.ended_other", entity_type: "user", entity_id: userId, details: { ended } });
  await tellOwnerOnRepeat(member.firm_id, userId, email, "session.ended_other", "parallel");
}

// Where the first step (the email code, Google or Microsoft) leads: the first step alone only
// on an approved PC on the office connection (D41), never on Remote friendly's approved
// devices anywhere; everyone else enters the 2 step code next.
export async function afterFirstStep(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string, email: string) {
  const office = await officeDeviceAccess(userId);
  if (!office.approved || office.anywhere) return "/sign-in/two-step";
  await oneSession(supabase, userId, email);
  return "/app";
}

// A firm person's passkey (PLAN.md 5.17, 8.5) has its own 2 step factor in Supabase Auth, named
// so the 2 step page passes it by. Its key is kept sealed by the outer key, bound to the person,
// and opened only to answer for the passkey once it checks out.
export const PASSKEY_FACTOR = "Passkey ";
export const sealFactor = async (userId: string, secret: string) =>
  (await serverKek().wrap(Buffer.from(secret), `passkey:${userId}`)).toString("base64");
export const factorCode = async (userId: string, sealed: string) =>
  totp((await serverKek().unwrap(Buffer.from(sealed, "base64"), `passkey:${userId}`)).toString());
