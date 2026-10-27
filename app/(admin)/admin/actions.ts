"use server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@/src/db/types";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { adminRefund } from "@/src/lib/billing/billing";
import { financialYear, indiaDay, taxSchema, type Tax } from "@/src/lib/billing/money";
import { officeProof } from "@/src/lib/office";
import { CHALLENGE_COOKIE, checkAdminKey, checkAdminKeyUse, newChallenge } from "@/src/lib/pc-key";
import { supabaseAdmin } from "@/src/lib/supabase";
import { systemMailReady } from "@/src/lib/system-mail";
import { startOf, untilAfter } from "@/src/lib/templates";
import { currentAdmin, listedAdmin, PROOF_COOKIE } from "./admin";

// Puts a failed job back in the queue and runs it now.
export async function retryJob(form: FormData) {
  const { supabase } = await currentAdmin();
  const { data } = await supabase.rpc("admin_retry_job", { job_id: Number(form.get("job")) });
  if (data) runJobsSoon();
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/firms/[id]", "page");
}

const fail = (path: string, error: string) => redirect(`${path}?error=${error}`);
const parts = z.array(z.enum(["app", "mail", "files", "reminders"])).min(1);

// The status page's incidents (PLAN.md 5.17 #43): posted, noted and closed by an admin.
export async function postIncident(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ title: z.string().trim().min(3).max(200), parts, level: z.enum(["slow", "down"]) })
    .safeParse({ title: form.get("title"), parts: form.getAll("parts"), level: form.get("level") });
  if (!asked.success) return fail("/admin/status", "incident");
  const { error } = await supabase.rpc("admin_post_incident", { incident_title: asked.data.title, incident_parts: asked.data.parts, incident_level: asked.data.level });
  if (error) throw new Error(`Posting the incident failed: ${error.code}`);
  revalidatePath("/admin/status");
}

export async function updateIncident(form: FormData) {
  const { supabase } = await currentAdmin();
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const { error } = await supabase.rpc("admin_update_incident", { incident: String(form.get("incident")), note, finish: form.get("finish") === "yes" });
  if (error) throw new Error(`Updating the incident failed: ${error.code}`);
  revalidatePath("/admin/status");
}

// The outage email to the affected firms' owners, only once Orelu's system mail is set up.
export async function emailIncident(form: FormData) {
  const { supabase } = await currentAdmin();
  if (!systemMailReady()) return fail("/admin/status", "mail_off");
  const { data, error } = await supabase.rpc("admin_email_incident", { incident: String(form.get("incident")) });
  if (error) throw new Error(`Emailing the firms failed: ${error.code}`);
  if (data) runJobsSoon();
  revalidatePath("/admin/status");
}

// A CA's check of a due date rule, or a government extension entered for a CA to check.
export async function verifyRule(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/), period: z.string().regex(/^(|[0-9]{4}-[0-9]{2})$/), link: z.url({ protocol: /^https$/ }).max(500), by: z.string().trim().min(2).max(120) })
    .safeParse({ code: form.get("code"), period: form.get("period") ?? "", link: form.get("link"), by: form.get("by") });
  if (!asked.success) return fail("/admin/due-dates", "verify");
  const { error } = await supabase.rpc("admin_verify_rule", { rule_code: asked.data.code, rule_period: asked.data.period, link: asked.data.link, checked_by: asked.data.by });
  if (error) throw new Error(`Checking the rule failed: ${error.code}`);
  revalidatePath("/admin", "layout");
}

export async function addExtension(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/), period: z.string().regex(/^[0-9]{4}-[0-9]{2}$/), on: z.iso.date(), link: z.url({ protocol: /^https$/ }).max(500) })
    .safeParse({ code: form.get("code"), period: form.get("period"), on: form.get("on"), link: form.get("link") });
  if (!asked.success) return fail("/admin/due-dates", "extension");
  const { data, error } = await supabase.rpc("admin_add_extension", { rule_code: asked.data.code, rule_period: asked.data.period, new_date: asked.data.on, link: asked.data.link });
  if (error || !data) return fail("/admin/due-dates", "extension");
  revalidatePath("/admin", "layout");
}

// The fixed connection suggestion's thresholds (PLAN.md 5.8).
export async function setOffice(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ taps: z.coerce.number().int().min(1).max(50), days: z.coerce.number().int().min(1).max(90) }).safeParse({ taps: form.get("taps"), days: form.get("days") });
  if (!asked.success) return fail("/admin/office", "thresholds");
  const { error } = await supabase.rpc("admin_set_office", { taps: asked.data.taps, days: asked.data.days });
  if (error) throw new Error(`Saving the thresholds failed: ${error.code}`);
  revalidatePath("/admin/office");
}

// Asks a firm's owner for an hour's support session (PLAN.md 8.5).
export async function askSupport(form: FormData) {
  const { supabase } = await currentAdmin();
  const firm = z.uuid().parse(form.get("firm"));
  const { error } = await supabase.rpc("admin_ask_support", { target: firm });
  if (error) throw new Error(`Asking for support access failed: ${error.code}`);
  revalidatePath(`/admin/firms/${firm}`);
}

// Marks a change from the daily forms check as reviewed.
export async function reviewChange(form: FormData) {
  const { supabase } = await currentAdmin();
  await supabase.rpc("admin_review_change", { change_source: String(form.get("source")), change_at: String(form.get("at")) });
  revalidatePath("/admin");
}

// The one line firms see under a new government item: InboxCA uses it from a date, or keeps the
// earlier version for some periods (the database logs it).
export async function noteUpdate(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ item: z.string().regex(/^[0-9a-f]{16}$/), uses: z.union([z.iso.date(), z.literal("")]), keeps: z.union([z.string().min(3).max(80), z.literal("")]) })
    .safeParse({ item: form.get("item"), uses: form.get("uses") ?? "", keeps: String(form.get("keeps") ?? "").trim() });
  if (!asked.success || !asked.data.uses === !asked.data.keeps) return fail("/admin", "line");
  const { data, error } = await supabase.rpc("admin_note_update", { item: asked.data.item, uses: asked.data.uses || undefined, keeps: asked.data.keeps || undefined });
  if (error || !data) return fail("/admin", "line");
  revalidatePath("/admin");
}

// A form version's last period, only with the official link that discontinues it (logged).
export async function endTemplate(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ form: z.string().regex(/^[A-Z0-9_]{2,30}$/), version: z.string().regex(/^\d+(\.\d+){0,3}$/), last: z.string().max(7), link: z.url({ protocol: /^https$/ }).max(500) })
    .safeParse({ form: form.get("form"), version: form.get("version"), last: form.get("last"), link: form.get("link") });
  const until = asked.success ? untilAfter(asked.data.form, asked.data.last) : null;
  if (!asked.success || !until) return fail("/admin/forms", "end");
  const { data, error } = await supabase.rpc("admin_end_template", { form: asked.data.form, ver: asked.data.version, until, link: asked.data.link });
  if (error || !data) return fail("/admin/forms", "end");
  revalidatePath("/admin", "layout");
}

// A new official file the daily check found with the same layout, used from a period without an
// app release. The database takes the file, its hash and link only from what the check
// recorded, and logs it.
export async function addVersion(form: FormData) {
  const { supabase } = await currentAdmin();
  const asked = z.object({ source: z.string().min(1).max(100), at: z.iso.datetime(), file: z.string().min(1).max(200), form: z.string().regex(/^[A-Z0-9_]{2,30}$/), from: z.string().max(7) })
    .safeParse({ source: form.get("source"), at: form.get("at"), file: form.get("file"), form: form.get("form"), from: form.get("from") });
  const starts = asked.success ? startOf(asked.data.form, asked.data.from) : null;
  if (!asked.success || !starts) return fail("/admin", "use");
  const { data, error } = await supabase.rpc("admin_add_template", { change_source: asked.data.source, change_at: asked.data.at, file: asked.data.file, starts });
  if (error || !data) return fail("/admin", "use");
  revalidatePath("/admin", "layout");
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

// Orelu's tax details for receipts and invoices (D32): checked here, saved and logged by the
// database. Nothing about GST is typed in code.
export async function saveTax(form: FormData) {
  const { supabase } = await currentAdmin();
  const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
  const { data: before } = await supabase.rpc("admin_billing");
  const turnover = { ...((before as { tax?: Tax } | null)?.tax?.turnover ?? {}), ...(text("turnover") && { [financialYear(indiaDay(new Date()))]: Math.round(Number(text("turnover")) * 100) }) };
  const asked = taxSchema.safeParse({
    legalName: text("legalName"), address: text("address"), pan: text("pan")?.toUpperCase(), gstin: text("gstin")?.toUpperCase(), stateCode: text("stateCode"),
    sac: text("sac"), rate: text("rate") ? Number(text("rate")) : undefined, gstFrom: text("gstFrom"), signatory: text("signatory"), turnover,
  });
  // GST needs all of its details, and the GSTIN starts with its state code and holds the PAN.
  const gst = asked.success && [asked.data.gstin, asked.data.stateCode, asked.data.sac, asked.data.rate, asked.data.gstFrom];
  if (!asked.success || (gst && gst.some(Boolean) && !gst.every(Boolean)) || (asked.data.gstin && (!asked.data.gstin.startsWith(asked.data.stateCode ?? "") || asked.data.gstin.slice(2, 12) !== asked.data.pan))) return fail("/admin/billing", "tax");
  const { error } = await supabase.rpc("admin_set_tax", { tax: asked.data as unknown as Json });
  if (error) throw new Error(`Saving the tax details failed: ${error.code}`);
  revalidatePath("/admin/billing");
}

// A payment taken twice or in error, given back in full (5.14.1); the admin is logged with it.
export async function refundPayment(form: FormData) {
  const { userId } = await currentAdmin();
  const reason = z.enum(["duplicate", "charge_error"]).safeParse(form.get("reason"));
  if (!reason.success) return fail("/admin/billing", "reason");
  if (!(await adminRefund(z.uuid().parse(form.get("payment")), userId, reason.data))) return fail("/admin/billing", "refund");
  revalidatePath("/admin/billing");
}

// A pilot firm starts without a payment (M0 "admin override for pilots").
export async function startPilot(form: FormData) {
  const { supabase } = await currentAdmin();
  const firm = z.uuid().parse(form.get("firm"));
  const { error } = await supabase.rpc("admin_pilot", { target: firm });
  if (error) throw new Error(`Starting the pilot failed: ${error.code}`);
  revalidatePath(`/admin/firms/${firm}`);
}

// Recovery: removes another admin's passkeys and signs them out (the database logs it).
export async function removePasskeys(form: FormData) {
  const { supabase } = await currentAdmin();
  const { error } = await supabase.rpc("admin_remove_passkeys", { person: String(form.get("person")) });
  if (error) throw new Error(`Removing passkeys failed: ${error.code}`);
  revalidatePath("/admin/admins");
}
