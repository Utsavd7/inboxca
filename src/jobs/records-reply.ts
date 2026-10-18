import { serverCrypto } from "@/src/lib/crypto";
import { readAttachments, type MailSettings } from "@/src/lib/mailbox";
import { askedPaper, isRoutine, pickPaper, type RecordsSettings } from "@/src/lib/records";
import { sendShare } from "@/src/lib/shares";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Answers a client's request for a paper (PLAN.md 5.5.2): reads the email again in memory
// for what is asked, finds the one filed document that answers it, and, if the sender may
// receive the client's papers, replies from the firm's mailbox with a secure link. A routine
// paper goes at once; a private one waits for one approval in the Inbox. Anything not found,
// unclear, or asked by someone who may not receive it goes to Needs team reply.
export const recordsReply: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, contact_id, label, provider_message_id, clients(name, email_enc), connected_accounts(id, address_enc, credentials_enc, settings, status), firms(name, settings)")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  const mailbox = event?.connected_accounts;
  if (!event?.client_id || !event.clients || !event.firms || !["records_past", "records_current"].includes(event.label ?? "") || mailbox?.status !== "connected") return { done: true };
  const { data: answered } = await admin.from("shares").select("id").eq("email_event_id", event.id).limit(1);
  if (answered?.length) return { done: true };
  const firm = event.firm_id;
  const toTeam = (reason: string) =>
    admin.from("requests").upsert({ firm_id: firm, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: reason }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
  const crypto = serverCrypto();

  // Who may receive: the client's own registered address, or a contact allowed to receive its papers.
  let to = "";
  if (event.contact_id) {
    const { data: link } = await admin.from("contact_clients").select("can_receive_documents, contacts(email_enc)").eq("contact_id", event.contact_id).eq("client_id", event.client_id).maybeSingle();
    if (link?.can_receive_documents && link.contacts) to = await crypto.decrypt(firm, `contacts/${event.contact_id}/email`, link.contacts.email_enc);
  } else if (event.clients.email_enc) to = await crypto.decrypt(firm, `clients/${event.client_id}/email`, event.clients.email_enc);
  if (!to) {
    await toTeam("not_allowed");
    return { done: true };
  }

  const address = await crypto.decrypt(firm, `accounts/${mailbox.id}/address`, mailbox.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firm, `accounts/${mailbox.id}/credentials`, mailbox.credentials_enc));
  const read = await readAttachments(address, password, (mailbox.settings as MailSettings).imap, event.provider_message_id);
  if ("error" in read) return read.error === "server" ? { retry: "mail_unreachable" } : { done: true };
  const asked = askedPaper(read.subject, read.text);
  if (!asked.types.length) {
    await toTeam("record_unclear");
    return { done: true };
  }
  const { data: documents } = await admin.from("documents").select("id, name, document_type, period_key, status").eq("client_id", event.client_id).in("document_type", asked.types);
  const picked = pickPaper(documents ?? [], asked);
  if (!("document" in picked) || !picked.document) {
    await toTeam(picked.reason ?? "record_not_found");
    return { done: true };
  }
  const paper = picked.document;
  const settings = ((event.firms.settings as { records?: RecordsSettings }).records ?? {}) as RecordsSettings;
  if (!isRoutine(paper.document_type, settings)) {
    await admin.from("shares").insert({ firm_id: firm, document_id: paper.id, contact_id: event.contact_id, email_event_id: event.id, status: "waiting" });
    return { done: true };
  }
  const sent = await sendShare({
    firmId: firm,
    firmName: event.firms.name,
    documentId: paper.id,
    documentName: paper.name,
    clientName: event.clients.name,
    contactId: event.contact_id,
    to,
    emailEventId: event.id,
    inReplyTo: event.provider_message_id,
  });
  return sent ? { done: true } : { retry: "mail_not_sent" };
};
