import { findPeriod } from "./documents";

// The records auto-reply (PLAN.md 5.5.2): which paper a client's email asks for, which filed
// document answers it, and whether it may go at once. By rules, never AI (D29).

// Routine papers go at once; every other paper is private and waits for one approval.
export const ROUTINE_DEFAULT = ["ITR-V", "Acknowledgement", "GSTR-1", "GSTR-3B", "Challan", "Certificate"];
export type SharePolicy = "auto" | "approval" | "internal";
export type RecordsSettings = { routine?: string[]; approve_all?: boolean };
export const isRoutine = (type: string, settings: RecordsSettings = {}) => !settings.approve_all && (settings.routine ?? ROUTINE_DEFAULT).includes(type==="Filing record" ? "Acknowledgement" : type);

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
  [/form[\s-]?16/, ["Form 16"]],
  [/26\s?as/, ["Form 26AS"]],
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
// are left to the team.
export function pickPaper<T extends { document_type: string; period_key: string; status: string }>(documents: T[], asked: { types: string[]; period: string }) {
  const candidates = documents.filter((document) => document.status === "filed" && asked.types.includes(document.document_type));
  const period = asked.period || candidates.map((document) => document.period_key).sort().at(-1) || "";
  const matches = candidates.filter((document) => (asked.period.length === 4 ? inYear(document.period_key, asked.period) : document.period_key === period));
  if (!matches.length) return { reason: "record_not_found" as const };
  if (matches.length > 1) return { reason: "record_unclear" as const };
  return { document: matches[0] };
}

export type BulkSend = { by: string; day: string; type: string; period: string; clients: { id: string; share: string; state?: "sent" | "waiting" | "skipped"; reason?: string }[] };
export const sendSkip: Record<string,string> = { no_email: "No email address", record_not_found: "No filed paper for this year", record_unclear: "More than one matching paper. Please choose on the client's page", record_internal: "Kept inside your firm", archived: "Client is archived or no longer available" };
