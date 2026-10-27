import type { Json } from "@/src/db/types";
import { answerMode, answerOf, dueAnswer, filedAnswer, papersAnswer, receivedLines, UNDO_MINUTES, type AnswerTask, type Asked } from "@/src/lib/answers";
import { addDays, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { serverCrypto } from "@/src/lib/crypto";
import { emailTemplates, TEMPLATE_VERSION } from "@/src/lib/email-templates";
import { firmMailer } from "@/src/lib/firm-mail";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

type Admin = ReturnType<typeof supabaseAdmin>;
// The answer's state, kept on the email (see the inbox_answers migration).
export type Delivery = { ack?: "held" | "queued" | "sending" | "ready" | "sent" | "stopped"; at?: string; by?: string; asked?: Asked };
export const answerEvent = "id, firm_id, client_id, contact_id, label, provider_message_id, delivery, clients(name, email_enc), firms(name, settings)";
type AnswerEvent = { id: string; firm_id: string; client_id: string | null; contact_id: string | null; label: string | null; provider_message_id: string; delivery: Json; clients: { name: string; email_enc: string | null } | null; firms: { name: string; settings: Json } | null };
export const statusKind = (kind: string | null) => kind === "filed" || kind === "papers" || kind === "due";

// Who may get InboxCA's answer: the client's own registered address, or a contact the firm
// allows to receive the client's papers. Empty for anyone else.
export async function answerTo(admin: Admin, event: AnswerEvent) {
  const crypto = serverCrypto();
  if (event.contact_id) {
    const { data: link } = await admin.from("contact_clients").select("can_receive_documents, contacts(email_enc)").eq("contact_id", event.contact_id).eq("client_id", event.client_id!).maybeSingle();
    return link?.can_receive_documents && link.contacts ? crypto.decrypt(event.firm_id, `contacts/${event.contact_id}/email`, link.contacts.email_enc) : "";
  }
  return event.clients?.email_enc ? crypto.decrypt(event.firm_id, `clients/${event.client_id}/email`, event.clients.email_enc) : "";
}

// What the records say for a status question (filed, due, papers), read only for this firm's
// client with the client given (the server's, or a person's under row level security): its
// lines, or why a person must answer instead. AI's tools read the same (src/lib/ai-reply.ts).
export async function recordLines(db: Admin, firm: string, client: string, kind: "filed" | "due" | "papers", asked: Asked, link = true): Promise<{ lines: string[] } | { team: string }> {
  const today = todayInIndia();
  if (kind === "papers") {
    const { data: asks, error } = await db.from("requests").select("id, details").eq("firm_id", firm).eq("client_id", client).eq("kind", "documents").eq("status", "pending").gt("expires_at", new Date().toISOString());
    if (error) throw new Error("records_not_read");
    const crypto = serverCrypto();
    const open = asks.map((ask) => ({ id: ask.id, details: ask.details as unknown as DocumentRequest })).filter((ask) => ask.details.link_enc);
    return papersAnswer(await Promise.all(open.map(async ({ id, details }) => ({
      period: details.period,
      missing: details.items.filter((item) => !item.received.length).map((item) => item.type),
      link: link ? `${process.env.APP_BASE_URL ?? ""}/u/${await crypto.decrypt(firm, `requests/${id}/link`, details.link_enc!)}` : "(the upload link)",
    }))), asked);
  }
  const [{ data: tasks, error }, { data: rules, error: rulesError }] = await Promise.all([
    db.from("tasks").select("code, period_key, due_on, status, details").eq("firm_id", firm).eq("client_id", client).eq("kind", "compliance").gte("due_on", addDays(today, -400)).lte("due_on", addDays(today, 400)),
    db.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", ""),
  ]);
  if (error || rulesError) throw new Error("records_not_read");
  const rule = new Map(rules.map((row) => [row.code, row]));
  const list: AnswerTask[] = tasks.map((task) => {
    const of = rule.get(task.code ?? "");
    return { code: task.code ?? "", period_key: task.period_key ?? "", due_on: task.due_on, status: task.status, details: task.details as AnswerTask["details"], rule: { name: of?.name ?? task.code ?? "", frequency: of?.frequency ?? null, verified: !!of?.verified_on } };
  });
  return kind === "filed" ? filedAnswer(list, asked, today) : dueAnswer(list, asked, today);
}

// The answer an email calls for, from the firm's records as they are now: its email, or why a
// person must answer instead (team), or null when there is nothing to say (no papers saved).
// The upload link is left out for someone who may only view.
export async function draftAnswer(admin: Admin, event: AnswerEvent, link = true) {
  const kind = answerOf(event.label);
  if (!kind || !event.client_id || !event.clients || !event.firms) return null;
  const asked = ((event.delivery ?? {}) as Delivery).asked ?? {};
  let answer: { lines: string[] } | { team: string } = { lines: [] };
  if (kind === "filed" || kind === "due" || kind === "papers") answer = await recordLines(admin, event.firm_id, event.client_id, kind, asked, link);
  else if (kind === "received") {
    const { data: papers, error } = await admin.from("documents").select("document_type, work_type, period_key, status").eq("email_event_id", event.id).in("status", ["filed", "earlier", "to_check"]);
    if (error) throw new Error("records_not_read");
    if (!papers.length) return null;
    answer = { lines: receivedLines(papers.map((paper) => ({ type: paper.document_type, work: paper.work_type, period: paper.period_key ?? "", toCheck: paper.status === "to_check" }))) };
  }
  if ("team" in answer) return { kind, team: answer.team };
  return { kind, ...emailTemplates.answer(kind, event.clients.name, event.firms.name, answer.lines) };
}

// Answers a client's email by rules ("Inbox, answered" B and C), queued by the mail poll for a
// status question, after filing for saved papers, and after recording a notice. The first run
// decides by the firm's setting: Off leaves a question in Needs reply; Ask me first holds the
// answer in the Inbox for a person to send or edit; Auto waits 5 minutes for an Undo, then
// sends. The answer is built again from the records when it goes. An email a person already
// answers, or a sender who may not receive the client's papers, gets nothing from InboxCA.
export const answerMail: Handler = async (job, { markSending }) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin.from("email_events").select(answerEvent).eq("id", job.entity_id ?? "").maybeSingle();
  const kind = answerOf(event?.label ?? null);
  const delivery = (event?.delivery ?? {}) as Delivery;
  if (!event?.client_id || !event.firms || !kind || ["held", "sent", "stopped"].includes(delivery.ack ?? "")) return { done: true };
  const save = async (change: Delivery) => {
    const { error } = await admin.from("email_events").update({ delivery: { ...delivery, ...change } as NonNullable<Json> }).eq("id", event.id);
    if (error) throw new Error("answer_not_saved");
  };
  const toTeam = async (reason: string) => {
    if (!statusKind(kind)) return;
    const { error } = await admin.from("requests").upsert({ firm_id: event.firm_id, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: reason }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
    if (error) throw new Error("team_reply_not_saved");
  };
  const { data: person, error } = await admin.from("requests").select("id").eq("kind", "team_reply").eq("entity_type", "email").eq("entity_id", event.id).maybeSingle();
  if (error) return { retry: "reply_not_read" };
  if (person) return { done: true };
  const mode = answerMode(event.firms.settings as Record<string, unknown>, kind);
  if (!delivery.ack && mode === "off") {
    await toTeam(event.label!);
    return { done: true };
  }
  const [to, answer] = await Promise.all([answerTo(admin, event), draftAnswer(admin, event)]);
  if (!answer) return { done: true };
  if (!to || "team" in answer) {
    await toTeam(to ? (answer as { team: string }).team : "answer_not_allowed");
    return { done: true };
  }
  if (!delivery.ack) {
    if (mode === "ask") await save({ ack: "held" });
    if (mode !== "auto") return { done: true };
    const at = new Date(Date.now() + UNDO_MINUTES * 60_000);
    await save({ ack: "queued", at: at.toISOString() });
    return { retry: "undo_window", at };
  }
  // Its Undo is over or a person pressed Send (queued), the mailbox asked to wait (ready), or a
  // try stopped part way (sending). The same message id lets a resumed try see a send that went.
  const mailer = await firmMailer(event.firm_id, event.firms.name);
  if (!mailer) return { retry: "mail_not_connected", at: new Date(Date.now() + 3600_000) };
  const messageId = `<received-${event.id}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
  const finish = async () => {
    const { error } = await admin.rpc("finish_answer", { event_id: event.id, template: `${kind}.en.${TEMPLATE_VERSION}`, ...(delivery.by && { actor: delivery.by }) });
    if (error) throw new Error("answer_not_saved");
  };
  if (delivery.ack === "sending" && (await mailer.sentAlready(messageId))) {
    await finish();
    return { done: true };
  }
  await save({ ack: "sending" });
  await markSending();
  if (!(await mailer.send(to, answer.subject, answer.text, messageId, event.provider_message_id))) {
    if (mailer.waitUntil) await save({ ack: "ready" });
    return mailer.waitUntil ? { retry: "mail_wait", at: mailer.waitUntil } : { retry: "mail_not_sent", patient: true };
  }
  await finish();
  return { done: true };
};
