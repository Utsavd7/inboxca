import { mailHealth, openMail } from "@/src/lib/firm-mail";
import { readNotice, reviewBy, type NoticeDetails } from "@/src/lib/notices";
import { readText } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Records a notice a client emailed (PLAN.md 5.6): the email and any PDF with it are read
// again in memory, and only what the rules find is kept. Its attachments are filed as usual.
// Until a person confirms an action date, the notice is due by the firm's review deadline.
export const noticeFromMail: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, label, received_at, provider_message_id, connected_accounts(id, provider, address_enc, credentials_enc, settings, status), firms(settings)")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  const mailbox = event?.connected_accounts;
  if (!event?.client_id || event.label !== "notice_received") return { done: true };
  if (mailbox?.status !== "connected") return {retry:"mail_not_connected",at:new Date(Date.now()+3600_000)};
  const { data: known } = await admin.from("tasks").select("id").eq("kind", "notice").eq("details->>email_event_id", event.id).limit(1);
  // Its attachments are filed, and the client gets the receipt by the firm's setting (Inbox, answered C).
  const queueFiles = () => admin.from("jobs").upsert(["file_mail", "answer_mail"].map((kind) => ({ firm_id: event.firm_id, kind, entity_type: "email", entity_id: event.id, idempotency_key: `${kind}:${event.id}` })), { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (known?.length) { await queueFiles(); return { done: true }; }
  const firm = event.firm_id;
  const read = await (await openMail(firm, mailbox)).readAttachments(event.provider_message_id);
  if ("error" in read) {
    if (read.error==="sign_in") await mailHealth(mailbox.id,"read",true,mailbox.credentials_enc);
    return {retry:"mail_unreachable",at:new Date(Date.now()+3600_000)};
  }
  await mailHealth(mailbox.id,"read",false,mailbox.credentials_enc);
  const pdfs = await Promise.all(read.files.filter((file) => file.name.toLowerCase().endsWith(".pdf")).map((file) => readText(file.name, file.bytes)));
  const receivedOn = new Date(event.received_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const notice = readNotice([read.subject, read.text, ...pdfs].join("\n"), receivedOn);
  const settings = (event.firms?.settings ?? {}) as { notice_review_days?: number; holidays?: string[] };
  const details: NoticeDetails = {
    authority: notice.authority,
    notice_type: notice.type,
    reference: notice.reference,
    received_on: receivedOn,
    ...(notice.suggested && { suggested_date: notice.suggested }),
    email_event_id: event.id,
  };
  const { error } = await admin.from("tasks").insert({ firm_id: firm, client_id: event.client_id, kind: "notice", due_on: reviewBy(receivedOn, settings.notice_review_days ?? 1, settings.holidays ?? []), status: "upcoming", details });
  if (error) return { retry: "notice_not_saved" };
  await queueFiles();
  return { done: true };
};
