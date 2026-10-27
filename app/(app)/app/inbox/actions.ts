"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { statusKind, type Delivery } from "@/src/jobs/answer-mail";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { aiReady, askAi } from "@/src/lib/ai";
import { aiReasons, writeReply } from "@/src/lib/ai-reply";
import { answerOf } from "@/src/lib/answers";
import { serverCrypto } from "@/src/lib/crypto";
import { firmMailer } from "@/src/lib/firm-mail";
import { replySubject, threadKeys } from "@/src/lib/mail-view";
import { currentWriter } from "@/src/lib/member";
import { sendShare } from "@/src/lib/shares";
import { supabaseAdmin } from "@/src/lib/supabase";
import { conversation } from "./conversation";

const MAX_FILES = 25 * 1024 * 1024;

// A reply from the Inbox (PLAN.md 5.5): written by a person, sent from the firm's own mailbox
// in the client's conversation, to the address the email came from when it is the client's
// or contact's registered one. Papers from the drive go as secure links by the usual rules;
// files picked from the computer are attached and kept nowhere. Only what was sent, never
// the text, is logged; the email's Needs reply is then done.
export async function sendReply(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const id = String(form.get("mail") ?? "");
  const back = `/app/inbox?mail=${encodeURIComponent(id)}`;
  const text = String(form.get("text") ?? "").trim();
  const files = form.getAll("file").filter((file): file is File => file instanceof File && file.size > 0);
  const papers = [...new Set(form.getAll("paper").map(String))].slice(0, 10);
  if (!text || text.length > 20_000) redirect(`${back}&error=reply`);
  const open = await conversation(supabase, membership.firmId, { mail: id });
  const event = open?.event;
  const parent = open?.opened;
  if (!event?.client_id) redirect(back);
  if ((files.length || papers.length) && !membership.may("send", event.client_id)) redirect(`${back}&error=needs`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES) redirect(`${back}&error=upload`);
  if (!parent || (await serverCrypto().blindIndex(membership.firmId, "email", parent.from)) !== event.sender_bidx) redirect(`${back}&error=mailbox`);
  const mailer = await firmMailer(membership.firmId, membership.firmName);
  if (!mailer) redirect(`${back}&error=mailbox`);
  const messageId = `<reply-${randomUUID()}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
  const attachments = await Promise.all(files.map(async (file) => ({ filename: file.name.slice(0, 200), content: Buffer.from(await file.arrayBuffer()) })));
  const sent = await mailer.send(parent.from, replySubject(parent.subject), text, messageId, parent.messageId, { references: threadKeys(parent.messageId, parent.inReplyTo, parent.references), attachments });
  if (!sent) redirect(`${back}&error=mailbox`);
  const admin = supabaseAdmin();
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "email.replied", entity_type: "email", entity_id: event.id, details: { files: files.length, papers } });
  // The email is done, answered by the team (the Inbox's "Answered by your team").
  const { data: ask } = await admin.from("requests").select("id, details").eq("firm_id", membership.firmId).eq("kind", "team_reply").eq("entity_type", "email").eq("entity_id", event.id).maybeSingle();
  await (ask
    ? admin.from("requests").update({ status: "done", details: { ...(ask.details as object), replied: true } }).eq("id", ask.id)
    : admin.from("requests").insert({ firm_id: membership.firmId, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, status: "done", details: { replied: true } }));
  const { data: chosen } = papers.length ? await supabase.from("documents").select("id, name").eq("client_id", event.client_id).eq("status", "filed").in("id", papers) : { data: [] };
  let unsent = papers.length - (chosen?.length ?? 0);
  for (const paper of chosen ?? []) {
    const shared = await sendShare({
      firmId: membership.firmId,
      firmName: membership.firmName, actor: userId,
      documentId: paper.id,
      documentName: paper.name,
      clientName: open.client?.name ?? "",
      contactId: event.contact_id,
      to: parent.from,
      emailEventId: event.id,
      inReplyTo: messageId,
    }).catch(() => false);
    if (!shared) unsent++;
  }
  revalidatePath("/app", "layout");
  redirect(`${back}&replied=1${unsent ? `&unsent=${unsent}` : ""}`);
}

// A new email to a client from the Inbox, sent from the firm's own mailbox like a reply. It
// goes only to the client's own address or its contact people, picked from the client's
// record and never typed. Papers and files go as in a reply; only what was sent is logged.
export async function sendEmail(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const id = String(form.get("client") ?? "");
  const back = `/app/inbox?compose=${encodeURIComponent(id)}`;
  const subject = String(form.get("subject") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  const files = form.getAll("file").filter((file): file is File => file instanceof File && file.size > 0);
  const papers = [...new Set(form.getAll("paper").map(String))].slice(0, 10);
  const { data: client } = await supabase.from("clients").select("id, name, email_enc, contact_clients(contact_id, contacts(email_enc))").eq("firm_id", membership.firmId).eq("id", id).is("archived_at", null).maybeSingle();
  if (!client) redirect("/app/inbox");
  if (!subject || subject.length > 300 || !text || text.length > 20_000) redirect(`${back}&error=write`);
  if ((files.length || papers.length) && !membership.may("send", client.id)) redirect(`${back}&error=needs`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES) redirect(`${back}&error=upload`);
  const picked = new Set(form.getAll("to").map(String));
  const crypto = serverCrypto();
  const to = [
    ...(picked.has("client") && client.email_enc ? [{ address: await crypto.decrypt(membership.firmId, `clients/${client.id}/email`, client.email_enc), contact: null }] : []),
    ...(await Promise.all(client.contact_clients.filter((link) => picked.has(link.contact_id) && link.contacts).map(async (link) => ({ address: await crypto.decrypt(membership.firmId, `contacts/${link.contact_id}/email`, link.contacts!.email_enc), contact: link.contact_id })))),
  ];
  if (!to.length) redirect(`${back}&error=to`);
  const mailer = await firmMailer(membership.firmId, membership.firmName);
  if (!mailer) redirect(`${back}&error=mailbox`);
  const messageId = `<write-${randomUUID()}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
  const attachments = await Promise.all(files.map(async (file) => ({ filename: file.name.slice(0, 200), content: Buffer.from(await file.arrayBuffer()) })));
  const sent = await mailer.send(to.map((recipient) => recipient.address).join(", "), subject, text, messageId, undefined, { references: [], attachments });
  if (!sent) redirect(`${back}&error=mailbox`);
  await supabaseAdmin().from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "email.written", entity_type: "client", entity_id: client.id, details: { to: to.length, files: files.length, papers } });
  const { data: chosen } = papers.length ? await supabase.from("documents").select("id, name").eq("client_id", client.id).eq("status", "filed").in("id", papers) : { data: [] };
  let unsent = papers.length - (chosen?.length ?? 0);
  for (const paper of chosen ?? []) {
    let missed = false;
    for (const recipient of to) {
      const shared = await sendShare({ firmId: membership.firmId, firmName: membership.firmName, actor: userId, documentId: paper.id, documentName: paper.name, clientName: client.name, contactId: recipient.contact, to: recipient.address }).catch(() => false);
      missed ||= !shared;
    }
    if (missed) unsent++;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/inbox?written=1${unsent ? `&unsent=${unsent}` : ""}`);
}

export type Draft = { text?: string; papers?: string[]; error?: string };

// "Write with AI" for a new email: a draft from the subject, for the person to read, change
// and send themselves. Off until an AI key is set.
export async function draftEmail(_previous: Draft, form: FormData): Promise<Draft> {
  const { supabase, membership } = await currentWriter();
  if (!membership || !aiReady()) return { error: "Turns on when AI is set up." };
  const subject = String(form.get("subject") ?? "").trim().slice(0, 300);
  const { data: client } = await supabase.from("clients").select("name").eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!client || !subject) return { error: "Write the subject first." };
  const answer = await askAi("email_draft", "You draft a short, polite plain text email from an Indian CA firm to its client about the subject given. Never invent figures, dates or facts. Answer as JSON: {\"text\": string}", JSON.stringify({ firm: membership.firmName, client: client.name, subject }));
  try {
    return { text: String((JSON.parse(answer ?? "") as { text?: unknown }).text ?? "").slice(0, 20_000) };
  } catch {
    return { error: "No draft this time. Write the email yourself." };
  }
}

// "Write a reply with AI": a draft for the person to read, change and send themselves, and
// the client's papers it thinks were asked for, from the client's records by the assistant's
// tools under the person's own access, with the output checks (src/lib/ai-reply.ts). Off until
// an AI key is set.
export async function draftReply(_previous: Draft, form: FormData): Promise<Draft> {
  const { supabase, membership } = await currentWriter();
  if (!membership || !aiReady()) return { error: "Turns on when AI is set up." };
  const result = await writeReply(supabase, membership.firmId, membership.firmName, String(form.get("mail") ?? ""), "reply_draft", !membership.viewOnlyUntil);
  if (!result) return { error: "The email could not be read just now." };
  return result.outcome === "draft" ? { text: result.text, papers: result.papers } : { error: `No draft this time. ${aiReasons[result.reason]}` };
}

// InboxCA's answer by rules (Inbox, answered B and C) from the open email or the Inbox's list:
// Send one held for a person (Ask me first) now, or stop it: Don't send a held one, Undo one
// still in its 5 minutes. Whoever may see and reply to the email may do it. A stopped question
// waits in Needs reply; a stopped receipt is simply not sent. Each is logged.
export async function manageAnswer(form: FormData) {
  const { supabase, userId, membership } = await currentWriter();
  if (!membership) redirect("/app");
  const back = String(form.get("back") ?? "").startsWith("/app/inbox") ? String(form.get("back")) : "/app/inbox";
  const note = (part: string) => `${back}${back.includes("?") ? "&" : "?"}${part}`;
  const { data: event } = await supabase.from("email_events").select("id, client_id, label, delivery").eq("firm_id", membership.firmId).eq("id", String(form.get("email") ?? "")).maybeSingle();
  const kind = answerOf(event?.label ?? null);
  const delivery = (event?.delivery ?? {}) as Delivery;
  if (!event?.client_id || !kind) redirect(note("error=answer"));
  const admin = supabaseAdmin();
  revalidatePath("/app", "layout");
  if (form.get("intent") === "send") {
    const { data: held } = await admin.from("email_events").update({ delivery: { ...delivery, ack: "queued", at: new Date().toISOString(), by: userId } }).eq("id", event.id).eq("delivery->>ack", "held").select("id");
    if (!held?.length) redirect(note("error=answer"));
    await admin.from("jobs").insert({ firm_id: membership.firmId, kind: "answer_mail", entity_type: "email", entity_id: event.id, idempotency_key: `answer_mail:${event.id}:${randomUUID()}` });
    runJobsSoon();
    redirect(note(`went=${event.id}`));
  }
  if (delivery.ack === "queued") {
    const { data: stopped } = await admin.from("jobs").update({ state: "cancelled" }).eq("kind", "answer_mail").eq("entity_type", "email").eq("entity_id", event.id).eq("state", "pending").select("id");
    if (!stopped?.length) redirect(note("error=started"));
  } else if (delivery.ack !== "held") redirect(note("error=started"));
  await admin.from("email_events").update({ delivery: { ...delivery, ack: "stopped" } }).eq("id", event.id);
  if (statusKind(kind)) await admin.from("requests").upsert({ firm_id: membership.firmId, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: event.label }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "email.answer_stopped", entity_type: "email", entity_id: event.id, details: { kind } });
  redirect(note(`stopped=${kind}`));
}
