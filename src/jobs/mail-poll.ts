import { serverCrypto } from "@/src/lib/crypto";
import { readNewMail, type MailSettings, type NewMail } from "@/src/lib/mailbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import { classify } from "@/src/lib/triage";
import { todayInIndia } from "@/src/lib/calendar";
import type { Handler } from "./runner";

// Reads a connected mailbox's new mail (PLAN.md 4.5, 5.5). Mail from anyone who is not a
// client or a contact of the firm is skipped without being opened or kept. The rest is
// labelled in memory; only the label and reason are kept, and anything unclear becomes a
// Needs team reply request. A refused password marks the mailbox to be connected again,
// which stops polling until the owner does.
export const mailPoll: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: account } = await admin
    .from("connected_accounts")
    .select("id, firm_id, address_enc, credentials_enc, sync_cursor, settings, status")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  if (account?.status !== "connected") return { done: true };
  const firm = account.firm_id;
  const crypto = serverCrypto();
  const address = await crypto.decrypt(firm, `accounts/${account.id}/address`, account.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firm, `accounts/${account.id}/credentials`, account.credentials_enc));

  // Senders are matched by blind index, so no address is compared or kept in plain text.
  type Sender = { index: string; contact_id: string | null; client_id: string | null };
  const senders = new Map<string, Sender>();
  const keep = async (mail: NewMail[]) => {
    const indexes = new Map(await Promise.all([...new Set(mail.map((m) => m.from))].map(async (from) => [from, await crypto.blindIndex(firm, "email", from)] as const)));
    const values = [...new Set(indexes.values())];
    const [{ data: contacts }, { data: clients }] = await Promise.all([
      admin.from("contacts").select("id, email_bidx, contact_clients(client_id)").eq("firm_id", firm).in("email_bidx", values),
      admin.from("clients").select("id, email_bidx").eq("firm_id", firm).is("archived_at", null).in("email_bidx", values),
    ]);
    for (const [from, index] of indexes) {
      const contact = contacts?.find((row) => row.email_bidx === index);
      const own = clients?.filter((row) => row.email_bidx === index) ?? [];
      if (!contact && !own.length) continue;
      const forClients = contact ? contact.contact_clients.map((link) => link.client_id) : own.map((row) => row.id);
      senders.set(from, { index, contact_id: contact?.id ?? null, client_id: forClients.length === 1 ? forClients[0] : null });
    }
    return mail.filter((m) => senders.has(m.from));
  };
  const read = await readNewMail(address, password, (account.settings as MailSettings).imap, account.sync_cursor, keep);
  if ("error" in read) {
    if (read.error === "server") return { retry: "mail_unreachable" };
    await admin.from("connected_accounts").update({ status: "needs_reconnect" }).eq("id", account.id);
    return { done: true };
  }

  const today = todayInIndia();
  const events = read.mail.map((mail) => {
    const sender = senders.get(mail.from)!;
    const { label, reason } = classify(mail.content, today);
    return {
      firm_id: firm,
      account_id: account.id,
      provider_message_id: mail.messageId,
      thread_id: mail.threadId,
      sender_bidx: sender.index,
      contact_id: sender.contact_id,
      client_id: sender.client_id,
      received_at: mail.receivedAt,
      label,
      decision_source: "rule",
      reason_code: reason,
    };
  });
  if (events.length) {
    const { data: saved, error } = await admin
      .from("email_events")
      .upsert(events, { onConflict: "account_id,provider_message_id", ignoreDuplicates: true })
      .select("id, client_id, provider_message_id, label, reason_code");
    if (error) return { retry: "events_not_saved" };
    // A known client's attachments are filed into the firm's drive by a job of their own,
    // so a drive that is slow or away never holds up reading mail.
    const withFiles = new Set(read.mail.filter((mail) => mail.content.attachments.length).map((mail) => mail.messageId));
    const filing = (saved ?? [])
      .filter((event) => event.client_id && withFiles.has(event.provider_message_id))
      .map((event) => ({ firm_id: firm, kind: "file_mail", entity_type: "email", entity_id: event.id, idempotency_key: `file_mail:${event.id}` }));
    // A known client asking for a paper is answered by a job of its own (5.5.2).
    const asking = (saved ?? [])
      .filter((event) => event.client_id && (event.label === "records_past" || event.label === "records_current"))
      .map((event) => ({ firm_id: firm, kind: "records_reply", entity_type: "email", entity_id: event.id, idempotency_key: `records_reply:${event.id}` }));
    // A known client's notice is recorded by a job of its own (5.6).
    const notices = (saved ?? [])
      .filter((event) => event.client_id && event.label === "notice_received")
      .map((event) => ({ firm_id: firm, kind: "notice_from_mail", entity_type: "email", entity_id: event.id, idempotency_key: `notice_from_mail:${event.id}` }));
    const queued = [...filing, ...asking, ...notices];
    if (queued.length) await admin.from("jobs").upsert(queued, { onConflict: "idempotency_key", ignoreDuplicates: true });
    // Unclear mail, or mail whose client is not known yet, waits for the team.
    const replies = (saved ?? [])
      .filter((event) => event.label === "other" || !event.client_id)
      .map((event) => ({ firm_id: firm, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: event.client_id ? event.reason_code : "client_unclear" }));
    if (replies.length) await admin.from("requests").upsert(replies, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
  }
  await admin.from("connected_accounts").update({ sync_cursor: read.cursor }).eq("id", account.id);
  return { done: true };
};
