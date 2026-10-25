"use server";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LeadState } from "@/app/(app)/app/leads/lead-form";
import { todayInIndia } from "@/src/lib/calendar";
import { serverCrypto } from "@/src/lib/crypto";
import { checkEnquiry, FORM_LIMITS, humanSent, sealLead, typedValues } from "@/src/lib/leads";
import { requestAddress } from "@/src/lib/office";
import { supabaseAdmin } from "@/src/lib/supabase";
import { formFirm, stampTime } from "./firm";

// An enquiry from the firm's public form (PLAN.md 5.12, 8.9). No one is signed in, so the lead
// is written with the server's key, only for the firm the form's key names. A bot that filled
// the hidden field, or sent the form sooner than a person could, is thanked and nothing is
// kept. One address may send 5 an hour and a firm takes 50 an hour; the address is kept only
// as a hash keyed with the firm's own key. The lead waits on the firm's board, due today.
export async function sendEnquiry(_state: LeadState, form: FormData): Promise<LeadState> {
  const key = String(form.get("key") ?? "");
  const firm = await formFirm(key);
  if (!firm) redirect(`/f/${encodeURIComponent(key)}`);
  const thanks = `/f/${key}?sent=1`;
  const crypto = serverCrypto();
  const started = await stampTime(firm.id, String(form.get("started") ?? ""));
  if (!started || !humanSent(String(form.get("website") ?? ""), started)) redirect(thanks);
  const checked = checkEnquiry(form, true);
  if ("error" in checked) return { error: checked.error, values: typedValues(form) };

  const admin = supabaseAdmin();
  const ip = await crypto.blindIndex(firm.id, "ip", requestAddress(await headers()) || "unknown");
  const recent = () => admin.from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", firm.id).eq("action", "lead.added").eq("details->>source", "form").gte("at", new Date(Date.now() - 3_600_000).toISOString());
  const [{ count: fromHere }, { count: all }] = await Promise.all([recent().eq("details->>ip", ip), recent()]);
  if ((fromHere ?? 0) >= FORM_LIMITS.perSender || (all ?? 0) >= FORM_LIMITS.perFirm) return { error: "Many enquiries arrived just now. Please try again in an hour.", values: typedValues(form) };

  const id = randomUUID();
  const { error } = await admin.rpc("add_form_lead", { target_firm: firm.id, lead: id, ...(await sealLead(crypto, firm.id, id, checked.enquiry, todayInIndia())), ip });
  if (error) return { error: "Your enquiry could not be sent. Please try again.", values: typedValues(form) };
  redirect(thanks);
}
