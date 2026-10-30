import { mailHealth, openMail } from "@/src/lib/firm-mail";
import { serverCrypto } from "@/src/lib/crypto";
import type { NewMail } from "@/src/lib/mailbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import { askedAbout } from "@/src/lib/answers";
import { classify, statusLabels, type Label } from "@/src/lib/triage";
import { officialKind, officialSender, taxNumbersIn, type OfficialWork } from "@/src/lib/gov-mail";
import { todayInIndia } from "@/src/lib/calendar";
import type { Handler } from "./runner";

// Reads a connected mailbox's new mail (PLAN.md 4.5, 5.5). Mail from anyone who is not a
// client or a contact of the firm, or an official tax portal sender that passed SPF or DKIM
// (src/lib/gov-mail.ts), is skipped without being opened or kept. Official mail is matched to
// the client by the PAN or GSTIN in it, and goes to Notices or is filed with the papers. The rest is
// labelled in memory; only the label and reason are kept, and anything unclear becomes a
// Needs team reply request. Repeated refused passwords mark the mailbox to be connected again,
// which stops polling until the owner does.
export const mailPoll: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: account } = await admin
    .from("connected_accounts")
    .select("id, firm_id, provider, address_enc, credentials_enc, sync_cursor, settings, status")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  if (account?.status !== "connected") return { done: true };
  const firm = account.firm_id;
  const crypto = serverCrypto();

  // Senders are matched by blind index, so no address is compared or kept in plain text.
  type Sender = { index: string; contact_id: string | null; client_id: string | null; official?: true };
  const senders = new Map<string, Sender>();
  // Each official message that passed SPF or DKIM, by id: one that did not is skipped even
  // when another from the same address passed.
  const officialMail = new Map<string, OfficialWork>();
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
      if (!contact && !own.length) {
        for (const m of mail.filter((m) => m.from === from)) {
          const work = officialSender(from, m.auth);
          if (work) officialMail.set(m.messageId, work);
          if (work) senders.set(from, { index, contact_id: null, client_id: null, official: true });
        }
        continue;
      }
      const forClients = contact ? contact.contact_clients.map((link) => link.client_id) : own.map((row) => row.id);
      senders.set(from, { index, contact_id: contact?.id ?? null, client_id: forClients.length === 1 ? forClients[0] : null });
    }
    return mail.filter((m) => senders.has(m.from) && (!senders.get(m.from)!.official || officialMail.has(m.messageId)));
  };
  const read = await (await openMail(firm, account)).readNewMail(account.sync_cursor, keep);
  if ("error" in read) {
    if (read.error === "server") return { retry: "mail_unreachable" };
    const failed=await mailHealth(account.id,"read",true,account.credentials_enc);
    return failed>=3 ? {done:true} : {retry:"mail_sign_in",at:new Date(Date.now()+2**failed*60_000)};
  }

  await mailHealth(account.id,"read",false,account.credentials_enc);
  const today = todayInIndia();
  // An official mail's client is the one whose PAN or GSTIN it names; several, or none, wait
  // for the team. Its label comes from its words, never from the triage rules for clients.
  const official = async (mail: typeof read.mail[number], work: OfficialWork) => {
    const numbers = taxNumbersIn(`${mail.content.subject}\n${mail.content.text}`);
    const indexes = await Promise.all([...numbers.gstins.map((n) => crypto.blindIndex(firm, "gstin", n)), ...numbers.pans.map((n) => crypto.blindIndex(firm, "pan", n))]);
    const { data: found } = indexes.length ? await admin.from("client_registrations").select("client_id").eq("firm_id", firm).in("number_bidx", indexes) : { data: [] };
    const clients = [...new Set((found ?? []).map((row) => row.client_id))];
    const kind = officialKind(mail.content.subject, mail.content.text);
    const label: Label = kind === "notice" ? "notice_received" : kind === "other" ? "other" : work === "gst" ? "data_gst" : "data_income_tax";
    return { client_id: clients.length === 1 ? clients[0] : null, label, reason: `government_${kind === "other" ? "mail" : kind}` };
  };
  const events = await Promise.all(read.mail.map(async (mail) => {
    const sender = senders.get(mail.from)!;
    const work = officialMail.get(mail.messageId);
    const { client_id, label, reason } = work ? await official(mail, work) : { client_id: sender.client_id, ...classify(mail.content, today) };
    return {
      firm_id: firm,
      account_id: account.id,
      provider_message_id: mail.messageId,
      thread_id: mail.threadId,
      sender_bidx: sender.index,
      contact_id: sender.contact_id,
      client_id,
      received_at: mail.receivedAt,
      label,
      decision_source: "rule",
      reason_code: reason,
      // Which return and period a status question names, for its answer; never its words.
      delivery: statusLabels.includes(label) ? { asked: askedAbout(mail.content.subject, mail.content.text) } : {},
    };
  }));
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
      .filter((event) => event.client_id && event.label !== "notice_received" && withFiles.has(event.provider_message_id))
      .map((event) => ({ firm_id: firm, kind: "file_mail", entity_type: "email", entity_id: event.id, idempotency_key: `file_mail:${event.id}` }));
    // A known client asking for a paper is answered by a job of its own (5.5.2).
    const asking = (saved ?? [])
      .filter((event) => event.client_id && (event.label === "records_past" || event.label === "records_current"))
      .map((event) => ({ firm_id: firm, kind: "records_reply", entity_type: "email", entity_id: event.id, idempotency_key: `records_reply:${event.id}` }));
    // A known client's notice is recorded by a job of its own (5.6).
    const notices = (saved ?? [])
      .filter((event) => event.client_id && event.label === "notice_received")
      .map((event) => ({ firm_id: firm, kind: "notice_from_mail", entity_type: "email", entity_id: event.id, idempotency_key: `notice_from_mail:${event.id}` }));
    // A known client's question about where things stand is answered by rules (Inbox, answered B).
    const status = (saved ?? [])
      .filter((event) => event.client_id && statusLabels.includes(event.label as Label))
      .map((event) => ({ firm_id: firm, kind: "answer_mail", entity_type: "email", entity_id: event.id, idempotency_key: `answer_mail:${event.id}` }));
    // The portal's e-verification confirmation closes the client's one filed income tax return
    // still waiting to be verified; with more than one, a person marks the right one.
    for (const event of (saved ?? []).filter((event) => event.client_id && event.reason_code === "government_verified")) {
      const { data: waiting } = await admin.from("tasks").select("id, details").eq("firm_id", firm).eq("client_id", event.client_id!).eq("status", "filed").like("code", "ITR%").is("details->>verified_on", null);
      if (waiting?.length === 1) await admin.from("tasks").update({ details: { ...(waiting[0].details as Record<string, unknown>), verified_on: today, verified_by: "portal" } }).eq("id", waiting[0].id);
    }
    const queued = [...filing, ...asking, ...notices, ...status];
    if (queued.length) await admin.from("jobs").upsert(queued, { onConflict: "idempotency_key", ignoreDuplicates: true });
    // Unclear mail, a notice that asks something, or mail whose client is not known yet,
    // waits for the team.
    const replies = (saved ?? [])
      .filter((event) => event.label === "other" || event.reason_code === "notice_question" || !event.client_id)
      .map((event) => ({ firm_id: firm, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: event.client_id ? event.reason_code : event.reason_code?.startsWith("government_") ? "government_unmatched" : "client_unclear" }));
    if (replies.length) await admin.from("requests").upsert(replies, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
  }
  await admin.from("connected_accounts").update({ sync_cursor: read.cursor }).eq("id", account.id);
  return { done: true };
};
