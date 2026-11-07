import { randomBytes } from "node:crypto";
import { periodLabel, yearName } from "./calendar";
import { fileName, financialYear, folderPath, type FolderOrder, type Naming, type WorkType } from "./drive";
import type { supabaseAdmin } from "./supabase";
import type { Label } from "./triage";

// What an attachment is, read by rules from its name and the email's subject (PLAN.md
// 5.5.0, D29): no AI and nothing kept but the result. Checked in order, so a more
// specific name comes first; a type's work is used unless it says "other".
const types: [RegExp, string, WorkType][] = [
  [/itr[\s-]?v\b/, "ITR-V", "income_tax"],
  // TDS papers for the quarterly statements. ITNS 281 is the TDS challan under the 1961 Act and
  // ITNS 281N from tax year 2026-27 (incometax.gov.in, "Create Challan through PAN login
  // (ITNS 281N)" FAQ).
  [/itns[\s-]?281|\btds\b.*\bchallans?\b|\bchallans?\b.*\btds\b/, "TDS challans", "tds"],
  [/salary register|payroll/, "Salary register", "tds"],
  [/\bt[dc]s\b.*\b(register|deductions?)\b|\b(deduction|payment|collection)s? register\b/, "TDS register", "tds"],
  [/acknowledg/, "Acknowledgement", "other"],
  [/audit report|\b3c[abd]\b/, "Audit report", "tax_audit"],
  [/computation/, "Computation", "income_tax"],
  [/gstr[\s-]?2b/, "GSTR-2B", "gst"],
  [/gstr[\s-]?2a/, "GSTR-2A", "gst"],
  [/gstr[\s-]?3b/, "GSTR-3B", "gst"],
  [/gstr[\s-]?1\b/, "GSTR-1", "gst"],
  [/purchase/, "Purchase bills", "gst"],
  [/\bsales?\b/, "Sales bills", "gst"],
  [/e[\s-]?way/, "E-way bills", "gst"],
  [/invoice/, "Invoices", "gst"],
  [/form[\s-]?16a?\b/, "Form 16", "income_tax"],
  // Form No. 130 and Form No. 168 replace Form 16 and Form 26AS from tax year 2026-27.
  [/form[\s-]?(no\.?\s*)?130\b/, "Form 130", "income_tax"],
  [/26\s?as/, "Form 26AS", "income_tax"],
  [/form[\s-]?(no\.?\s*)?168\b/, "Form 168", "income_tax"],
  [/\bais\b/, "AIS", "income_tax"],
  [/\btis\b/, "TIS", "income_tax"],
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
export const finalPapers = new Set(["ITR-V", "Acknowledgement", "Audit report", "GSTR-1", "GSTR-3B", "Notice", "Order", "Certificate", "Challan", "Form 16", "Form 130", "Balance sheet", "Computation"]);
// A TDS challan receipt by what it prints: its form, or the minor head of TDS deposited by the
// deductor (the same FAQ).
export const tdsChallanText = (text: string) => /\bITNS\s?281N?\b|TDS\/TCS Payable by Taxpayer/i.test(text);
const labelWork: Partial<Record<Label, WorkType>> = { data_gst: "gst", data_income_tax: "income_tax", data_tax_audit: "tax_audit" };
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNames = months.map((month) => month[0].toUpperCase() + month.slice(1));

// "2026-09" for a month, "2027" for FY 2026-27 (or tax year 2026-27, or AY 2027-28), or ""
// when none is named.
export function findPeriod(text: string) {
  const year = text.match(/\b(fy|a\.?y\.?|assessment year)?:?\s?(20\d\d)\s?[-/]\s?(?:20)?(\d\d)\b/);
  if (year && (Number(year[2]) + 1) % 100 === Number(year[3])) return String(Number(year[2]) + (year[1]?.startsWith("a") ? 0 : 1));
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s-]?'?(20)?(\d\d)\b/);
  if (named) return `20${named[3]}-${String(months.indexOf(named[1].slice(0, 3)) + 1).padStart(2, "0")}`;
  const monthFirst = text.match(/\b(0?[1-9]|1[0-2])\s?[-/]\s?(20\d\d)\b/);
  if (monthFirst) return `${monthFirst[2]}-${monthFirst[1].padStart(2, "0")}`;
  const yearFirst = text.match(/\b(20\d\d)\s?[-/]\s?(0[1-9]|1[0-2])\b/);
  return yearFirst ? `${yearFirst[1]}-${yearFirst[2]}` : "";
}

// A TDS paper is for the quarter of its statement, kept as the month the quarter ends, as the
// calendar's TDS_RET task keeps it ("2026-09" for July to September 2026): named as Q2 of a year
// ("Q2 2026-27"), as its months ("Jul-Sep 2026") or by a month in it. Anything else is unclear.
export const quarterEnd = (key: string) => (key.length === 7 ? `${key.slice(0, 5)}${String(Math.ceil(Number(key.slice(5)) / 3) * 3).padStart(2, "0")}` : key);
export function findQuarter(text: string) {
  const q = text.match(/\bq([1-4])\b[\s,-]*(?:fy|tax year)?\s?(20\d\d)\s?[-/]\s?(?:20)?(\d\d)\b/);
  if (q && (Number(q[2]) + 1) % 100 === Number(q[3])) return q[1] === "4" ? `${Number(q[2]) + 1}-03` : `${q[2]}-${String(Number(q[1]) * 3 + 3).padStart(2, "0")}`;
  const months = text.match(/\b(apr|jul|oct|jan)[a-z]*\s?(?:-|to)\s?(jun|sep|dec|mar)[a-z]*[\s-]?'?(?:20)?(\d\d)\b/);
  const ends: Record<string, string> = { apr: "jun", jul: "sep", oct: "dec", jan: "mar" };
  if (months && ends[months[1]] === months[2]) return quarterEnd(`20${months[3]}-${String(["jan", "apr", "jul", "oct"].indexOf(months[1]) * 3 + 1).padStart(2, "0")}`);
  const month = findPeriod(text);
  return month.length === 7 ? quarterEnd(month) : "";
}

// "FY 2026-27" or "Sep 2026" as drive file names write a period. Names never change, so a
// firm's drive keeps one layout.
export const filePeriod = (key: string) =>
  key.length === 4 ? `FY ${Number(key) - 1}-${key.slice(2)}` : key ? `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : "";

// The period in words for people: a month as "Sep 2026", a year by calendar.ts yearName, as
// income tax when any work given is ("Tax year 2026-27"), else "FY 2026-27" (a balance sheet's
// tax_audit work too: the books keep the financial year). TDS papers alone name their quarter.
export const periodName = (key: string, ...work: (string | null | undefined)[]) =>
  key.length === 4 ? yearName(key, work.includes("income_tax")) : work.length && work.every((one) => one === "tds") ? periodLabel("quarterly", quarterEnd(key)) : filePeriod(key);

// The type, work, period and financial year of an attachment. Sure only when both the type
// and the period were found; otherwise it is filed under To check for a person to confirm.
// A challan sent about TDS, or one whose content reads as a TDS challan (typed), is a TDS challan.
const fileWords = (fileName: string) => fileName.toLowerCase().replace(/[_.]+/g, " ");
export function describeFile(fileName: string, subject: string, label: string | null, receivedAt: string, typed?: string) {
  const name = fileWords(fileName);
  const named = (typed ? types.find(([, type]) => type === typed) : types.find(([pattern]) => pattern.test(name))) ?? types.find(([pattern]) => pattern.test(subject.toLowerCase()));
  const found = named?.[1] === "Challan" && /\btds\b/.test(subject.toLowerCase()) ? types.find(([, type]) => type === "TDS challans") : named;
  const period = found?.[2] === "tds" ? findQuarter(name) || findQuarter(subject.toLowerCase()) : findPeriod(name) || findPeriod(subject.toLowerCase());
  const work = found && found[2] !== "other" ? found[2] : (labelWork[label as Label] ?? "other");
  const year = financialYear(period.length === 4 ? `${period}-03` : period || receivedAt.slice(0, 7));
  return { type: found?.[1] ?? "Document", work, period, year, sure: !!found && !!period };
}

// Tax papers whose printed layout InboxCA knows (src/lib/tax-papers.ts). A PDF typed as one of
// them by a name or an email's words keeps that type only when its content has the layout:
// a bank statement sent with a Form 16 is an Other paper under To check, and a Form No. 130
// named as Form 16 is Form 130. A file whose own name says it (form16.pdf), but whose content
// InboxCA cannot read as one, keeps that type under To check.
export const layoutTyped = new Set(["Form 16", "Form 130", "Form 26AS", "Form 168", "AIS", "TIS"]);
export function typeByContent<T extends { type: string; sure: boolean }>(about: T, found: { type: string } | null, fileName = ""): T {
  if (!layoutTyped.has(about.type)) return about;
  if (found) return { ...about, type: found.type };
  const named = types.find(([pattern]) => pattern.test(fileWords(fileName)))?.[1] === about.type;
  return { ...about, type: named ? about.type : "Document", sure: false };
}

// The work a paper's type belongs to, by the same rules; "other" when none says.
export const workOfType = (type: string): WorkType => types.find(([pattern]) => pattern.test(type.toLowerCase()))?.[2] ?? "other";

// The GSTIN a paper is for (decided 24 Oct 2026): only GST work has one. It is the client's
// only GSTIN, or with more, the one a person chose, if any.
export const gstinFor = (work: string, gstins: string[], chosen?: string | null) =>
  work !== "gst" ? null : gstins.length === 1 ? gstins[0] : chosen && gstins.includes(chosen) ? chosen : null;

// Papers a client often sends several of in one period, each its own paper, never versions:
// a Form 16 for each employer and often its Part A and Part B apart, and Form 26AS as both
// its PDF and its text file. A quarter's TDS registers and challans often come a month at a time.
const manyAPeriod = new Set(["TDS challans", "TDS register", "Salary register", "Acknowledgement", "Challan", "Notice", "Order", "Certificate", "Document", "Form 16", "Form 130", "Form 26AS"]);
// Bills, statements, slips and the like also come many to a period, each file its own paper; only a
// spreadsheet of them (a register InboxCA reads for a return) replaces an earlier spreadsheet, so a
// corrected register is read once and never added to the one it corrects.
const loose = new Set(["Purchase bills", "Sales bills", "E-way bills", "Invoices", "Salary slips", "Rent receipts", "Investment proofs", "Bank statement", "Interest certificate", "Capital gains statement", "Ledger"]);
const spreadsheet = (name: string) => /\.(xlsx?|ods|csv)$/i.test(name);

// The TDS registers of a quarter the TDS statement page can read: the spreadsheets filed under a
// client's TDS work for that quarter, newest first. The page offers every filed spreadsheet of the
// client not read yet, so these are among them; a page may list them first.
export async function tdsRegisters(db: Pick<ReturnType<typeof supabaseAdmin>, "from">, firm: string, clients: string[], quarters: string[]) {
  const { data } = await db.from("documents").select("id, client_id, period_key, name, document_type, received_at").eq("firm_id", firm).in("client_id", clients).in("period_key", quarters).eq("work_type", "tds").eq("status", "filed").is("prepared", null)
    .in("document_type", ["TDS register", "Salary register"]).order("received_at", { ascending: false }).limit(500).throwOnError();
  return (data ?? []).filter((paper) => spreadsheet(paper.name));
}

// Versions (decided 24 Oct 2026): of a client's filed papers of one type, period and GSTIN,
// the latest to arrive is current and the others are kept as earlier versions, their files
// left in the drive. Papers with no period, prepared forms, and GST papers of a client with
// several GSTINs whose GSTIN is not known are left as they are.
export async function settleVersions(
  admin: ReturnType<typeof supabaseAdmin>,
  paper: { client_id: string; work_type: string; document_type: string; period_key: string; registration_id: string | null },
) {
  if (!paper.period_key || manyAPeriod.has(paper.document_type)) return;
  if (paper.work_type === "gst" && !paper.registration_id) {
    const { count } = await admin.from("client_registrations").select("id", { count: "exact", head: true }).eq("client_id", paper.client_id).eq("kind", "gstin");
    if ((count ?? 0) > 1) return;
  }
  const group = admin.from("documents").select("id, status, name").eq("client_id", paper.client_id).eq("document_type", paper.document_type).eq("period_key", paper.period_key).in("status", ["filed", "earlier"]).is("prepared", null);
  const { data } = await (paper.registration_id ? group.eq("registration_id", paper.registration_id) : group.is("registration_id", null)).order("received_at", { ascending: false }).order("id", { ascending: false });
  let rows = data ?? [];
  if (loose.has(paper.document_type)) {
    // A bill the earlier rule took for an old version is its own paper again.
    const back = rows.filter((row) => !spreadsheet(row.name) && row.status === "earlier").map((row) => row.id);
    if (back.length) await admin.from("documents").update({ status: "filed" }).in("id", back);
    rows = rows.filter((row) => spreadsheet(row.name));
  }
  const [current, ...older] = rows;
  if (current?.status === "earlier") await admin.from("documents").update({ status: "filed" }).eq("id", current.id);
  const earlier = older.filter((other) => other.status === "filed").map((other) => other.id);
  if (earlier.length) await admin.from("documents").update({ status: "earlier" }).in("id", earlier);
}

// Every type a person can pick when confirming a file, in the order shown.
export const documentTypes = [...new Set(types.map(([, type]) => type))].sort().concat("Document");
// Form No. 130 and Form No. 168 replace Form 16 and Form 26AS from tax year 2026-27 (period
// "2027", or a month from Apr 2026). Pickers list each pair once, by its new name (paper-type.ts);
// a paper is still kept as its period's form, so old papers read and match as before.
const replaced: Record<string, string> = { "Form 16": "Form 130", "Form 26AS": "Form 168" };
export const listedTypes = documentTypes.filter((type) => !(type in replaced));
export const listedType = (type: string) => replaced[type] ?? type;
const oldOf = (type: string) => Object.keys(replaced).find((key) => key === type || replaced[key] === type);
export function lawType(type: string, period: string) {
  const old = oldOf(type);
  if (!old || !period) return type;
  return (period.length === 4 ? period >= "2027" : period >= "2026-04") ? replaced[old] : old;
}
// Both forms of a pair, as a paper sent for either may be stored as the other: a form16.pdf
// for tax year 2026-27 is typed Form 16 by its name.
export const sameForm = (type: string) => {
  const old = oldOf(type);
  return old ? [old, replaced[old]] : [type];
};

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
export async function placeUnderFreeName(
  parts: { client: string; type: string; period: string; extension: string },
  received: string,
  place: (name: string) => Promise<{ id: string } | "taken">,
  naming?: Naming,
) {
  for (const suffix of [undefined, received, randomBytes(3).toString("hex")]) {
    const name = fileName({ ...parts, suffix }, naming);
    const placed = await place(name);
    if (placed !== "taken") return { id: placed.id, name };
  }
  return "taken" as const;
}
