"use server";
import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Json } from "@/src/db/types";
import { todayInIndia } from "@/src/lib/calendar";
import { serverCrypto } from "@/src/lib/crypto";
import { firmMailer } from "@/src/lib/firm-mail";
import { checkEnquiry, lostReasons, nextFollowUp, proposeLead, sealLead, services, typedValues, worksLeads } from "@/src/lib/leads";
import { mailLive } from "@/src/lib/mail-live";
import { currentWriter } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { LeadState } from "./lead-form";

// Leads are worked by the owner, partners and the front desk (PLAN.md 3, 5.12), on a device
// that may change things. Every change goes through the database's lead functions, which
// check the role again and write one line in the log.
async function leadWriter() {
  const member = await currentWriter();
  if (!member.membership || !worksLeads(member.membership.role)) redirect("/app");
  return { ...member, membership: member.membership };
}
const lead = (id: string, more = "") => `/app/leads?lead=${encodeURIComponent(id)}${more}`;

// The board: a card dropped on another column, or moved with its menu. Won and Lost ask
// first, in the lead's panel.
export async function moveLead(id: string, stage: string) {
  const { supabase, membership } = await leadWriter();
  await supabase.rpc("change_lead", { target_firm: membership.firmId, lead: id, change: "move", val: stage });
  revalidatePath("/app", "layout");
}

// The panel: one change, named by the form (move, lost, won, follow_up, notes).
export async function changeLead(form: FormData) {
  const { supabase, membership } = await leadWriter();
  const id = String(form.get("lead") ?? "");
  const change = String(form.get("change") ?? "");
  let val = String(form.get("value") ?? "").trim() || undefined;
  if (change === "lost" && !(val && val in lostReasons)) redirect(lead(id, "&do=lost&error=reason"));
  if (change === "notes") val = val ? await serverCrypto().encrypt(membership.firmId, `clients/${id}/notes`, val.slice(0, 5000)) : "";
  const { data: done } = await supabase.rpc("change_lead", { target_firm: membership.firmId, lead: id, change, val });
  revalidatePath("/app", "layout");
  if (!done) redirect(lead(id, "&error=change"));
  redirect(change === "won" ? `/app/clients/${id}` : change === "lost" ? "/app/leads?saved=lost" : lead(id, `&saved=${change}`));
}

// Add a lead by hand, after a call or a visit.
export async function addLead(_state: LeadState, form: FormData): Promise<LeadState> {
  const { supabase, membership } = await leadWriter();
  const checked = checkEnquiry(form, false);
  if ("error" in checked) return { error: checked.error, values: typedValues(form) };
  const followUp = String(form.get("follow_up") ?? "");
  const id = randomUUID();
  const sealed = await sealLead(serverCrypto(), membership.firmId, id, checked.enquiry, /^20\d{2}-\d{2}-\d{2}$/.test(followUp) ? followUp : null);
  const { data: added } = await supabase.rpc("add_lead", { target_firm: membership.firmId, lead: id, ...sealed });
  if (!added) return { error: "The lead could not be added. Try again.", values: typedValues(form) };
  revalidatePath("/app", "layout");
  redirect(lead(id, "&saved=added"));
}

// An email offered as a possible lead, added in one click. It is read again from the mailbox,
// so the address comes from the message itself, checked against the one it was offered for;
// the name and the help needed were only proposals, and the person may correct them here.
export async function confirmEnquiry(form: FormData) {
  const { supabase, membership } = await leadWriter();
  const { data: offer } = await supabase.from("email_events").select("id, provider_message_id, sender_bidx").eq("firm_id", membership.firmId).eq("id", String(form.get("enquiry") ?? "")).eq("reason_code", "enquiry").maybeSingle();
  if (!offer) redirect("/app/leads?error=gone");
  const read = await mailLive(membership.firmId, "list", { inbox: [offer.provider_message_id], sent: null });
  const mail = "inbox" in read ? read.inbox[0] : undefined;
  const crypto = serverCrypto();
  if (!mail || (await crypto.blindIndex(membership.firmId, "email", mail.from)) !== offer.sender_bidx) redirect("/app/leads?error=read");
  const proposal = proposeLead(mail.from, mail.fromName ?? "", mail);
  const service = String(form.get("service") ?? "");
  const enquiry = {
    name: String(form.get("name") ?? "").trim().slice(0, 200) || proposal.name,
    email: mail.from,
    phone: "",
    kind: proposal.kind,
    service: service in services ? (service as keyof typeof services) : proposal.service,
    urgency: "month" as const,
    message: "",
  };
  const id = randomUUID();
  const { data: added } = await supabase.rpc("add_lead", { target_firm: membership.firmId, lead: id, ...(await sealLead(crypto, membership.firmId, id, enquiry, todayInIndia())), enquiry: offer.id });
  if (!added) redirect("/app/leads?error=gone");
  revalidatePath("/app", "layout");
  redirect(lead(id, "&saved=added"));
}

// Not a lead: InboxCA forgets the offer; the email stays in the firm's mailbox.
export async function dismissEnquiry(form: FormData) {
  const { supabase, membership } = await leadWriter();
  const { data: done } = await supabase.rpc("dismiss_enquiry", { target_firm: membership.firmId, enquiry: String(form.get("enquiry") ?? "") });
  revalidatePath("/app/leads");
  redirect(done ? "/app/leads?saved=dismissed" : "/app/leads?error=gone");
}

// A follow up email, only when the person sends it: written in the panel, sent from the firm's
// own mailbox to the lead's address, and kept nowhere but the mailbox (PLAN.md 5.2, D6). The
// next follow up falls 3 days later, up to 4 (lib/leads.ts).
export async function sendFollowUp(form: FormData) {
  const { supabase, membership } = await leadWriter();
  const id = String(form.get("lead") ?? "");
  const writing = lead(id, "&write=1");
  const subject = String(form.get("subject") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  if (!subject || subject.length > 300 || !text || text.length > 20_000) redirect(`${writing}&error=write`);
  const { data: row } = await supabase.from("clients").select("id, email_enc").eq("firm_id", membership.firmId).eq("id", id).neq("stage", "client").maybeSingle();
  if (!row?.email_enc) redirect(lead(id));
  const mailer = await firmMailer(membership.firmId, membership.firmName);
  if (!mailer) redirect(`${writing}&error=mailbox`);
  const to = await serverCrypto().decrypt(membership.firmId, `clients/${id}/email`, row.email_enc);
  const messageId = `<lead-${randomUUID()}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
  if (!(await mailer.send(to, subject, text, messageId, undefined, { references: [], attachments: [] }))) redirect(`${writing}&error=mailbox`);
  const { count } = await supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("entity_id", id).eq("action", "lead.followed_up");
  await supabase.rpc("change_lead", { target_firm: membership.firmId, lead: id, change: "followed_up", val: nextFollowUp(todayInIndia(), count ?? 0) ?? undefined });
  revalidatePath("/app", "layout");
  redirect(lead(id, "&saved=followed_up"));
}

// The owner turns the enquiry form on, with a new link each time, or off; the firm's own
// change log records it (firms_changed).
export async function setEnquiryForm(form: FormData) {
  const { supabase, membership } = await leadWriter();
  if (membership.role !== "owner") redirect("/app/leads");
  const on = form.get("on") === "on";
  const settings = { ...membership.settings };
  delete settings.enquiry_form;
  await supabase.from("firms").update({ settings: (on ? { ...settings, enquiry_form: { key: randomBytes(12).toString("base64url") } } : settings) as { [key: string]: Json } }).eq("id", membership.firmId);
  revalidatePath("/app/leads");
  redirect(`/app/leads?panel=setup&saved=${on ? "form_on" : "form_off"}`);
}

// The owner asks InboxCA to look for enquiries in the firm's email, or stops it. The mailbox's
// settings hold its server details and are not open to members, so the server writes the
// switch after this check, and logs who changed it.
export async function setEnquiryCapture(form: FormData) {
  const { userId, membership } = await leadWriter();
  if (membership.role !== "owner") redirect("/app/leads");
  const on = form.get("on") === "on";
  const admin = supabaseAdmin();
  const { data: mailbox } = await admin.from("connected_accounts").select("id, settings").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle();
  if (!mailbox) redirect("/app/leads?panel=setup");
  await admin.from("connected_accounts").update({ settings: { ...(mailbox.settings as Record<string, Json>), capture_enquiries: on } }).eq("id", mailbox.id);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "enquiries.capture", entity_type: "account", entity_id: mailbox.id, details: { on } });
  revalidatePath("/app/leads");
  redirect(`/app/leads?panel=setup&saved=${on ? "capture_on" : "capture_off"}`);
}
