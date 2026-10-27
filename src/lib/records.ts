import { findPeriod } from "./documents";

// The records auto-reply (PLAN.md 5.5.2): which paper a client's email asks for, which filed
// document answers it, and whether it may go at once. By rules, never AI (D29).

// Routine papers go at once; every other paper is private and waits for one approval. The
// firm's own note of an acknowledgement number is never routine.
export const ROUTINE_DEFAULT = ["ITR-V", "Acknowledgement", "GSTR-1", "GSTR-3B", "Challan", "Certificate"];
export type SharePolicy = "auto" | "approval" | "internal";
export type RecordsSettings = { routine?: string[]; approve_all?: boolean };
export const isRoutine = (type: string, settings: RecordsSettings = {}) => !settings.approve_all && type !== "Filing record" && (settings.routine ?? ROUTINE_DEFAULT).includes(type);

export const paperPolicy = (paper: { document_type: string; share_policy?: string | null }, settings: RecordsSettings = {}): SharePolicy =>
  paper.share_policy === "internal" ? "internal" : settings.approve_all ? "approval" : paper.share_policy === "approval" ? "approval" : paper.share_policy === "auto" || isRoutine(paper.document_type, settings) ? "auto" : "approval";

// Words for a paper, the most specific first, and the document types that answer them.
// A GST return not named as GSTR-1 or GSTR-3B is either; with both filed for the period the
// team picks. Hindi and Gujarati words are those clients write for the same papers.
const asks: [RegExp, string[]][] = [
  [/financial statement|balance sheet|profit\s?(and|&)\s?loss|p\s?&\s?l\b|बैलेंस शीट|બેલેન્સ શીટ/, ["Balance sheet"]],
  [/audit report|\b3c[abd]\b|ऑडिट रिपोर्ट|ઓડિટ રિપોર્ટ/, ["Audit report"]],
  [/gstr[\s-]?3b/, ["GSTR-3B"]],
  [/gstr[\s-]?1\b/, ["GSTR-1"]],
  // Form No. 130 and Form No. 168 replace Form 16 and Form 26AS from tax year 2026-27, so
  // either name finds either paper; the name the client wrote comes first.
  [/form[\s-]?16\b/, ["Form 16", "Form 130"]],
  [/form[\s-]?(no\.?\s?)?130\b/, ["Form 130", "Form 16"]],
  [/26\s?as/, ["Form 26AS", "Form 168"]],
  [/form[\s-]?(no\.?\s?)?168\b/, ["Form 168", "Form 26AS"]],
  [/computation/, ["Computation"]],
  [/challan|चालान|ચલણ/, ["Challan"]],
  [/certificate/, ["Certificate"]],
  [/gst return/, ["GSTR-3B", "GSTR-1"]],
  [/\bitr\b|itr[\s-]?v|return copy|filed return|income tax return|acknowledg|रिटर्न|રિટર્ન/, ["ITR-V", "Acknowledgement"]],
];

export function askedPaper(subject: string, text: string) {
  const words = `${subject}\n${text}`.toLowerCase();
  return { types: asks.find(([pattern]) => pattern.test(words))?.[1] ?? [], period: findPeriod(words) };
}

// "2026" is the financial year ending March 2026; its months run from April 2025.
const inYear = (key: string, year: string) => key === year || (key.length === 7 && `${key}` >= `${Number(year) - 1}-04` && `${key}` <= `${year}-03`);

// The one filed document that answers the request, or why there is none: the asked period
// when one is named, otherwise the newest period on file. Two papers for the same period
// are left to the team. A return InboxCA prepared is its working file, not the filed copy, so it
// never answers; with only that for the period, the team sends the filed copy. A month's
// acknowledgement is a GST return's, so it answers a request for an ITR only for that month.
export function pickPaper<T extends { document_type: string; period_key: string; status: string; prepared?: unknown }>(documents: T[], asked: { types: string[]; period: string }) {
  const itr = asked.types.includes("ITR-V") && asked.period.length !== 7;
  const filed = documents.filter((document) => document.status === "filed" && asked.types.includes(document.document_type) && !(itr && document.period_key.length === 7));
  const candidates = filed.filter((document) => !document.prepared);
  const period = asked.period || candidates.map((document) => document.period_key).sort().at(-1) || "";
  const inPeriod = (key: string) => (asked.period.length === 4 ? inYear(key, asked.period) : key === period);
  const matches = candidates.filter((document) => inPeriod(document.period_key));
  if (!matches.length) return { reason: filed.some((document) => document.prepared && (!asked.period || inPeriod(document.period_key))) ? ("record_prepared" as const) : ("record_not_found" as const) };
  if (matches.length > 1) return { reason: "record_unclear" as const };
  return { document: matches[0] };
}

export type BulkSend = { by: string; day: string; type: string; period: string; clients: { id: string; share: string; state?: "sent" | "waiting" | "skipped"; reason?: string }[] };
export const sendSkip: Record<string,string> = { no_email: "No email address", record_not_found: "No saved paper of this type for this year", record_unclear: "More than one matching paper. Please choose on the client's page", record_prepared: "Only the prepared return is saved, not the filed copy", record_internal: "Kept inside your firm", archived: "Client is archived or no longer available" };
