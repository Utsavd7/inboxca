import { findPeriod } from "./documents";

// The records auto-reply (PLAN.md 5.5.2): which paper a client's email asks for, which filed
// document answers it, and whether it may go at once. By rules, never AI (D29).

// Routine papers go at once; every other paper is private and waits for one approval.
export const ROUTINE_DEFAULT = ["ITR-V", "Acknowledgement", "GSTR-1", "GSTR-3B", "Challan", "Certificate"];
export type RecordsSettings = { routine?: string[]; approve_all?: boolean };
export const isRoutine = (type: string, settings: RecordsSettings = {}) => !settings.approve_all && (settings.routine ?? ROUTINE_DEFAULT).includes(type);

// Words for a paper, the most specific first, and the document types that answer them.
const asks: [RegExp, string[]][] = [
  [/financial statement|balance sheet|profit and loss|p\s?&\s?l\b/, ["Balance sheet"]],
  [/audit report|\b3c[abd]\b/, ["Audit report"]],
  [/gstr[\s-]?3b/, ["GSTR-3B"]],
  [/gstr[\s-]?1\b/, ["GSTR-1"]],
  [/form[\s-]?16/, ["Form 16"]],
  [/26\s?as/, ["Form 26AS"]],
  [/challan/, ["Challan"]],
  [/certificate/, ["Certificate"]],
  [/\bitr\b|itr[\s-]?v|return copy|filed return|income tax return|acknowledg/, ["ITR-V", "Acknowledgement"]],
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
