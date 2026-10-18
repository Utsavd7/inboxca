import { randomBytes } from "node:crypto";
import { fileName, financialYear, folderPath, type FolderOrder, type WorkType } from "./drive";
import type { Label } from "./triage";

// What an attachment is, read by rules from its name and the email's subject (PLAN.md
// 5.5.0, D29): no AI and nothing kept but the result. Checked in order, so a more
// specific name comes first; a type's work is used unless it says "other".
const types: [RegExp, string, WorkType][] = [
  [/itr[\s-]?v\b/, "ITR-V", "income_tax"],
  [/acknowledg/, "Acknowledgement", "other"],
  [/audit report|\b3c[abd]\b/, "Audit report", "tax_audit"],
  [/gstr[\s-]?2b/, "GSTR-2B", "gst"],
  [/gstr[\s-]?2a/, "GSTR-2A", "gst"],
  [/gstr[\s-]?3b/, "GSTR-3B", "gst"],
  [/gstr[\s-]?1\b/, "GSTR-1", "gst"],
  [/purchase/, "Purchase bills", "gst"],
  [/\bsales?\b/, "Sales bills", "gst"],
  [/e[\s-]?way/, "E-way bills", "gst"],
  [/invoice/, "Invoices", "gst"],
  [/form[\s-]?16a?\b/, "Form 16", "income_tax"],
  [/26\s?as/, "Form 26AS", "income_tax"],
  [/\bais\b/, "AIS", "income_tax"],
  [/salary|pay\s?slip/, "Salary slips", "income_tax"],
  [/interest cert/, "Interest certificate", "income_tax"],
  [/capital gain/, "Capital gains statement", "income_tax"],
  [/rent receipt/, "Rent receipts", "income_tax"],
  [/\b80c\b|investment proof/, "Investment proofs", "income_tax"],
  [/trial balance/, "Trial balance", "tax_audit"],
  [/balance sheet/, "Balance sheet", "tax_audit"],
  [/ledger/, "Ledger", "tax_audit"],
  [/stock statement/, "Stock statement", "tax_audit"],
  [/fixed asset/, "Fixed asset register", "tax_audit"],
  [/tally/, "Tally backup", "tax_audit"],
  [/bank statement|statement of account/, "Bank statement", "other"],
  [/challan/, "Challan", "other"],
  [/notice|intimation/, "Notice", "other"],
  [/certificate/, "Certificate", "other"],
  [/\border\b/, "Order", "other"],
];

// Final papers: what clients ask for in later years, and what the first import brings by
// default (PLAN.md 5.16).
export const finalPapers = new Set(["ITR-V", "Acknowledgement", "Audit report", "GSTR-1", "GSTR-3B", "Notice", "Order", "Certificate", "Challan", "Form 16", "Balance sheet"]);
const labelWork: Partial<Record<Label, WorkType>> = { data_gst: "gst", data_income_tax: "income_tax", data_tax_audit: "tax_audit" };
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNames = months.map((month) => month[0].toUpperCase() + month.slice(1));

// "2026-09" for a month, "2027" for FY 2026-27 (or AY 2027-28), or "" when none is named.
export function findPeriod(text: string) {
  const year = text.match(/\b(fy|ay)?\s?(20\d\d)\s?[-/]\s?(\d\d)\b/);
  if (year && (Number(year[2]) + 1) % 100 === Number(year[3])) return String(Number(year[2]) + (year[1] === "ay" ? 0 : 1));
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s-]?'?(20)?(\d\d)\b/);
  if (named) return `20${named[3]}-${String(months.indexOf(named[1].slice(0, 3)) + 1).padStart(2, "0")}`;
  const monthFirst = text.match(/\b(0?[1-9]|1[0-2])\s?[-/]\s?(20\d\d)\b/);
  if (monthFirst) return `${monthFirst[2]}-${monthFirst[1].padStart(2, "0")}`;
  const yearFirst = text.match(/\b(20\d\d)\s?[-/]\s?(0[1-9]|1[0-2])\b/);
  return yearFirst ? `${yearFirst[1]}-${yearFirst[2]}` : "";
}

export const periodName = (key: string) =>
  key.length === 4 ? `FY ${Number(key) - 1}-${key.slice(2)}` : key ? `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : "";

// The type, work, period and financial year of an attachment. Sure only when both the type
// and the period were found; otherwise it is filed under To check for a person to confirm.
export function describeFile(fileName: string, subject: string, label: string | null, receivedAt: string) {
  const name = fileName.toLowerCase().replace(/[_.]+/g, " ");
  const found = types.find(([pattern]) => pattern.test(name)) ?? types.find(([pattern]) => pattern.test(subject.toLowerCase()));
  const period = findPeriod(name) || findPeriod(subject.toLowerCase());
  const work = found && found[2] !== "other" ? found[2] : (labelWork[label as Label] ?? "other");
  const year = financialYear(period.length === 4 ? `${period}-03` : period || receivedAt.slice(0, 7));
  return { type: found?.[1] ?? "Document", work, period, year, sure: !!found && !!period };
}

// Every type a person can pick when confirming a file, in the order shown.
export const documentTypes = [...new Set(types.map(([, type]) => type))].sort().concat("Document");

// The periods a person can pick: the last 18 months and the last four financial years.
export function periodChoices(today: string) {
  const year = Number(today.slice(0, 4));
  const monthsBack = Array.from({ length: 18 }, (_, back) => {
    const at = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 1 - back, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const lastYearEnd = Number(today.slice(5, 7)) >= 4 ? year + 1 : year;
  return [...monthsBack, ...Array.from({ length: 4 }, (_, back) => String(lastYearEnd - back))];
}

// "17 Oct 2026", the India date a file arrived.
export const receivedLabel = (at: string) => new Date(at).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

// Where a document goes: its client's folder for the year and work, under To check when a
// person still has to confirm it.
export function folderFor(order: FolderOrder, client: string, document: { work: WorkType; period: string; receivedAt: string; toCheck: boolean }) {
  const year = financialYear(document.period.length === 4 ? `${document.period}-03` : document.period || document.receivedAt.slice(0, 7));
  return [...folderPath(order, year, client, document.work), ...(document.toCheck ? ["To check"] : [])];
}

// Saves or moves a file under its plain name; a taken name gets the received date, then a
// short id, so nothing is ever overwritten.
export async function placeUnderFreeName(parts: { client: string; type: string; period: string; extension: string }, received: string, place: (name: string) => Promise<{ id: string } | "taken">) {
  for (const suffix of [undefined, received, randomBytes(3).toString("hex")]) {
    const name = fileName({ ...parts, suffix });
    const placed = await place(name);
    if (placed !== "taken") return { id: placed.id, name };
  }
  return "taken" as const;
}
