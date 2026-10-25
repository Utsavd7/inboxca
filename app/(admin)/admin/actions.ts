"use server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { officeProof } from "@/src/lib/office";
import { CHALLENGE_COOKIE, checkAdminKey, checkAdminKeyUse, newChallenge } from "@/src/lib/pc-key";
import { supabaseAdmin } from "@/src/lib/supabase";
import { currentAdmin, listedAdmin, PROOF_COOKIE } from "./admin";

// Puts a failed job back in the queue and runs it now.
export async function retryJob(form: FormData) {
  const { supabase } = await currentAdmin();
  const { data } = await supabase.rpc("admin_retry_job", { job_id: Number(form.get("job")) });
  if (data) runJobsSoon();
  revalidatePath("/admin/jobs");
}

// Marks a change from the daily forms check as reviewed.
export async function reviewChange(form: FormData) {
  const { supabase } = await currentAdmin();
  await supabase.rpc("admin_review_change", { change_source: String(form.get("source")), change_at: String(form.get("at")) });
  revalidatePath("/admin");
}

// An admin's passkeys (PLAN.md 8.1, 8.10): a one-time question, then a new passkey or a check
// with one, which opens the console in this sign in session for an hour.
export async function passkeyChallenge() {
  const { userId, email } = await listedAdmin();
  const { challenge, cookie } = newChallenge(`admin:${userId}`);
  (await cookies()).set(CHALLENGE_COOKIE, cookie, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
  const { data: keys } = await supabaseAdmin().from("admin_passkeys").select("id").eq("user_id", userId);
  return { challenge, userId, email, keys: (keys ?? []).map((key) => key.id) };
}

const answer = z.object({ id: z.base64url().max(400), clientDataJSON: z.base64url().max(4000), authenticatorData: z.base64url().max(4000) });

async function prove(userId: string, session: string) {
  const jar = await cookies();
  jar.delete(CHALLENGE_COOKIE);
  jar.set(PROOF_COOKIE, await officeProof(`admin:${userId}`, session, 3600), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/admin", maxAge: 3600 });
}

// The first passkey comes after the email and 2 step codes; more only from inside the console.
export async function savePasskey(key: { id: string; clientDataJSON: string; authenticatorData: string; publicKey: string }) {
  const { userId, session } = await listedAdmin();
  const admin = supabaseAdmin();
  const { count } = await admin.from("admin_passkeys").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (count) await currentAdmin();
  const parsed = answer.extend({ publicKey: z.base64url().max(400) }).safeParse(key);
  const fail = "The passkey could not be set up. Reload the page and try again.";
  if (!parsed.success || !checkAdminKey(parsed.data, (await headers()).get("origin") ?? "", (await cookies()).get(CHALLENGE_COOKIE)?.value, userId)) return fail;
  const { error } = await admin.from("admin_passkeys").insert({ id: parsed.data.id, user_id: userId, public_key: parsed.data.publicKey });
  if (error) return fail;
  await admin.from("activity_log").insert({ actor_id: userId, action: "admin.passkey_added", entity_type: "admin", entity_id: userId });
  if (!count) {
    await prove(userId, session);
    redirect("/admin");
  }
  (await cookies()).delete(CHALLENGE_COOKIE);
  revalidatePath("/admin/admins");
  return "";
}

export async function checkPasskey(key: { id: string; clientDataJSON: string; authenticatorData: string; signature: string }) {
  const { userId, session } = await listedAdmin();
  const admin = supabaseAdmin();
  const parsed = answer.extend({ signature: z.base64url().max(1000) }).safeParse(key);
  const { data: saved } = parsed.success ? await admin.from("admin_passkeys").select("public_key, counter").eq("id", parsed.data.id).eq("user_id", userId).maybeSingle() : { data: null };
  const counter = parsed.success && saved ? checkAdminKeyUse(parsed.data, saved.public_key, (await headers()).get("origin") ?? "", (await cookies()).get(CHALLENGE_COOKIE)?.value, userId) : null;
  if (!parsed.success || !saved || counter === null) return "That passkey did not work. Try again, or ask another Orelu admin to remove your passkeys.";
  // A counter that does not go up means the passkey was copied: refused and logged.
  if ((counter || saved.counter) && counter <= saved.counter) {
    await admin.from("activity_log").insert({ actor_id: userId, action: "admin.passkey_copied", entity_type: "admin", entity_id: userId });
    return "That passkey looks copied. Ask another Orelu admin to remove your passkeys.";
  }
  await admin.from("admin_passkeys").update({ counter }).eq("id", parsed.data.id);
  await admin.from("activity_log").insert({ actor_id: userId, action: "admin.passkey_used", entity_type: "admin", entity_id: userId });
  await prove(userId, session);
  redirect("/admin");
}

// Recovery: removes another admin's passkeys and signs them out (the database logs it).
export async function removePasskeys(form: FormData) {
  const { supabase } = await currentAdmin();
  const { error } = await supabase.rpc("admin_remove_passkeys", { person: String(form.get("person")) });
  if (error) throw new Error(`Removing passkeys failed: ${error.code}`);
  revalidatePath("/admin/admins");
}
