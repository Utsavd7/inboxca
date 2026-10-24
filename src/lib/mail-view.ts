// Shared by the app and the file worker. No native or Node imports here.
// The Inbox reads mail live from the firm's mailbox through the file worker and keeps none
// of it: no subject, text or snippet is stored anywhere; it lives only for the request.
import { signView, validSignature } from "./file-worker.ts";
import type { Server } from "./mailbox.ts";

export type MailItem = { box: "inbox" | "sent"; messageId: string; from: string; to: string[]; date: string; subject: string; snippet: string };
export type MailMessage = MailItem & { inReplyTo: string; references: string[]; text: string; attachments: string[] };
// list: the inbox messages named by id (or, with q, those of them that match), and the newest
// sent ones that match. thread: one message and the conversation it belongs to.
export type ListAsk = { inbox: string[]; q?: string; sent: { limit: number; to?: string[]; since?: string; before?: string; reminders?: boolean } | null };
export type ThreadAsk = { box: "inbox" | "sent"; messageId: string };
export type MailRequest = { firm: string; expires: number; address: string; password: string; server: Server } & ({ op: "list"; ask: ListAsk } | { op: "thread"; ask: ThreadAsk });

export const mailLimits = { body: 65_536, ids: 500, sent: 50, thread: 20, text: 50_000 };

export const signMail = (body: string, secret: string) => signView(body, secret);

// A signed request, fresh, for one of the two reads, with every field in bounds.
export async function verifyMail(body: string, signature: string, secret: string, op: string, now = Date.now() / 1000): Promise<MailRequest> {
  if (!secret || body.length > mailLimits.body || !(await validSignature(body, signature, secret))) throw new Error("Not allowed");
  const value = JSON.parse(body) as MailRequest;
  const text = (item: unknown, max: number) => typeof item === "string" && item.length <= max;
  const ok = value && value.op === op && text(value.firm, 64) && !!value.firm && Number.isInteger(value.expires) && value.expires > now && value.expires <= now + 75 &&
    text(value.address, 320) && text(value.password, 1000) && text(value.server?.host, 255) && Number.isInteger(value.server?.port) &&
    (value.op === "list"
      ? Array.isArray(value.ask.inbox) && value.ask.inbox.length <= mailLimits.ids && value.ask.inbox.every((id) => text(id, 998)) && (value.ask.q === undefined || text(value.ask.q, 200)) &&
        (value.ask.sent === null || (Number.isInteger(value.ask.sent.limit) && value.ask.sent.limit >= 1 && value.ask.sent.limit <= mailLimits.sent && (value.ask.sent.to ?? []).length <= 20))
      : ["inbox", "sent"].includes(value.ask.box) && text(value.ask.messageId, 998) && !!value.ask.messageId);
  if (!ok) throw new Error("Not allowed");
  return value;
}

// The text without the earlier messages it quotes, so a conversation does not repeat itself.
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line) => /^On .{4,200} wrote:\s*$/.test(line.trim()) || /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}$/i.test(line.trim()));
  return (cut === -1 ? lines : lines.slice(0, cut)).filter((line) => !line.startsWith(">")).join("\n").trim();
}

// The first words of a message for its row in the list.
export const snippet = (text: string) => stripQuoted(text).replace(/\s+/g, " ").trim().slice(0, 140);

// The paragraphs of a message, as written.
export const paragraphs = (text: string) => stripQuoted(text).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

// Every Message-ID that ties a message to its conversation, newest last, at most 20.
export function threadKeys(messageId: string, inReplyTo: string, references: string[]) {
  return [...new Set([...references, inReplyTo, messageId].filter(Boolean))].slice(-mailLimits.thread);
}

export const replySubject = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`).slice(0, 200);

// Who sent a message from the firm's mailbox: InboxCA's reminders, InboxCA's other emails
// (secure links, receipts), or the team.
export function sentKind(messageId: string): "reminder" | "inboxca" | "team" {
  if (/^<reminder-/.test(messageId)) return "reminder";
  return /^<(share|received)-/.test(messageId) ? "inboxca" : "team";
}

export const whens = { today: "Today", week: "This week", month: "This month", older: "Older" } as const;
export type When = keyof typeof whens;
// The span of days a When choice covers, India time: from (inclusive) and until (exclusive).
export function whenRange(when: string, today: string): { from?: string; until?: string } {
  const day = new Date(`${today}T00:00:00Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  const first = `${today.slice(0, 8)}01`;
  const at = (date: string) => `${date}T00:00:00+05:30`;
  if (when === "today") return { from: at(today) };
  if (when === "week") return { from: at(monday) };
  if (when === "month") return { from: at(first) };
  if (when === "older") return { until: at(first) };
  return {};
}

// Papers of the client that the email seems to ask for: the types its words name (the asked
// types from the records rules, and any of the firm's document types written in it), the
// asked period first, newest first, at most four.
export function suggestPapers<T extends { document_type: string; period_key: string }>(text: string, documents: T[], asked: { types: string[]; period: string }, types: string[]) {
  const words = text.toLowerCase();
  const named = new Set([...asked.types, ...types.filter((type) => type.length > 3 && type !== "Document" && words.includes(type.toLowerCase()))]);
  const inPeriod = (key: string) => !asked.period || key === asked.period || (asked.period.length === 4 && key.length === 7 && key >= `${Number(asked.period) - 1}-04` && key <= `${asked.period}-03`);
  return documents
    .filter((document) => named.has(document.document_type))
    .sort((a, b) => Number(inPeriod(b.period_key)) - Number(inPeriod(a.period_key)) || b.period_key.localeCompare(a.period_key))
    .slice(0, 4);
}
