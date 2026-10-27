import { isPan } from "./identifiers.ts";

// Income tax papers clients send (PLAN.md 5.3.1), known by the printed titles and headings
// of the official layout, never by row numbers or the file's name: Form 16 from TRACES,
// Form No. 130 that replaces it from tax year 2026-27, Form 26AS as a PDF or TRACES text
// file, Form No. 168, AIS, TIS, ITR-V and the ITR acknowledgement. Each gives only what its
// layout prints: the PAN it is for and its year as a period key ("2026" is AY 2026-27, the
// same as FY 2025-26; a tax year is the old financial year, so tax year 2026-27 is "2027").
// Anything unclear is not recognised. Sources: reference/official/income-tax/sources.json.
export type TaxPaper = { type: "Form 16" | "Form 130" | "Form 26AS" | "Form 168" | "AIS" | "TIS" | "ITR-V" | "Acknowledgement"; pan: string; period: string };
export type Line = { page: number; text: string; cells: { start: number; end: number; x0: number; x1: number }[] };

export const plain = (text: string) => text.normalize("NFKC").replace(/[“”″]/g, '"').replace(/[‘’]/g, "'").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();

// A PDF's words as printed lines, each cell with where it sits across the page, so a label
// can be paired with the value beside or under it. A password is only one a person typed.
export async function pdfLines(bytes: Uint8Array, pages = 30, password?: string) {
  const pdfjs = await import(/* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 }), lines: Line[] = [];
  try {
    const pdf = await task.promise;
    for (let number = 1; number <= Math.min(pdf.numPages, pages); number++) {
      const items = (await (await pdf.getPage(number)).getTextContent()).items.flatMap((item) =>
        "str" in item && plain(item.str) ? [{ text: plain(item.str), x: item.transform[4], y: item.transform[5], width: item.width, height: Math.abs(item.transform[3]) || 10 }] : []);
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: (typeof items)[] = [];
      for (const item of items) {
        const row = rows.at(-1);
        if (row && Math.abs(row[0].y - item.y) <= row[0].height / 2) row.push(item);
        else rows.push([item]);
      }
      for (const row of rows) {
        const line: Line = { page: number, text: "", cells: [] };
        for (const item of row.sort((a, b) => a.x - b.x)) {
          if (line.text) line.text += " ";
          line.cells.push({ start: line.text.length, end: line.text.length + item.text.length, x0: item.x, x1: item.x + item.width });
          line.text += item.text;
        }
        lines.push(line);
      }
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

// A scan's OCR text as lines for the same rules, only to suggest its type and period: with no
// cell positions a value counts only beside its label, and no figure is ever read from it.
export const textLines = (text: string): Line[] => text.split("\n").map((line) => ({ page: 1, text: plain(line), cells: [] }));

// The lines from the first one matching from (or the start) up to the next matching to.
export function region(lines: Line[], from?: RegExp, to?: RegExp) {
  const start = from ? lines.findIndex((line) => from.test(line.text)) : 0;
  if (start < 0) return [];
  const end = to ? lines.findIndex((line, at) => at > start && to.test(line.text)) : -1;
  return lines.slice(start, end < 0 ? undefined : end);
}

// Every value printed for a label: the word right after it on its line, or else the word in
// its column on the first line below that has one there. Forms print values both ways.
export function valuesFor(lines: Line[], label: RegExp, value: RegExp) {
  const found: { value: string; page: number }[] = [];
  lines.forEach((line, at) => {
    for (const match of line.text.matchAll(new RegExp(label.source, "gi"))) {
      const end = match.index + match[0].length, next = line.text.slice(end).replace(/^[\s:]+/, "").split(" ")[0];
      if (value.test(next)) {
        found.push({ value: next, page: line.page });
        continue;
      }
      const cells = line.cells.filter((cell) => cell.end > match.index && cell.start < end);
      if (!cells.length) continue;
      const x0 = Math.min(...cells.map((cell) => cell.x0)), x1 = Math.max(...cells.map((cell) => cell.x1));
      const below = lines.slice(at + 1, at + 4).find((row) => row.page === line.page && row.cells.some((cell) => cell.x0 < x1 && cell.x1 > x0));
      const cell = below?.cells.find((cell) => cell.x0 < x1 && cell.x1 > x0), word = cell && below!.text.slice(cell.start, cell.end);
      if (word && value.test(word)) found.push({ value: word, page: below!.page });
    }
  });
  return found;
}
// The one value a paper gives, wherever it repeats it; none when it gives two.
export const one = (found: { value: string; page: number }[]) => (found.length && found.every((item) => item.value === found[0].value) ? found[0] : null);

export const PAN = /^[A-Z]{5}\d{4}[A-Z]$/, TAN = /^[A-Z]{4}\d{5}[A-Z]$/;
const YEAR = /^20\d\d-(\d\d|20\d\d)$/;
// "2026-27" or "2026-2027" gives 2026, when the second year follows the first.
export function firstYear(value: string) {
  const match = /^(20\d\d)-(\d\d|20\d\d)$/.exec(value);
  return match && (match[2].length === 2 ? Number(match[2]) === (Number(match[1]) + 1) % 100 : Number(match[2]) === Number(match[1]) + 1) ? Number(match[1]) : null;
}
const AY = { label: /Assessment Year/, shift: 0 }, FY = { label: /Financial Year/, shift: 1 }, TY = { label: /Tax Year/, shift: 1 };
function yearOf(lines: Line[], kinds: { label: RegExp; shift: number }[]) {
  const keys = new Set<number>();
  for (const { label, shift } of kinds)
    for (const { value } of valuesFor(lines, label, YEAR)) {
      const year = firstYear(value);
      if (year === null) return null;
      keys.add(year + shift);
    }
  return keys.size === 1 ? String([...keys][0]) : null;
}

// tax: the paper has its summary of tax deducted; salary: its salary details.
export function recogniseTaxPdf(lines: Line[]): (TaxPaper & { tax: boolean; salary: boolean }) | null {
  const all = plain(lines.map((line) => line.text).join(" ")).toLowerCase(), has = (text: string) => all.includes(text);
  const paper = (type: TaxPaper["type"], pan: { value: string } | null, period: string | null, tax = false, salary = false) => (pan && isPan(pan.value) && period ? { type, pan: pan.value, period, tax, salary } : null);
  const summary = has("summary of amount paid/credited and tax deducted at source thereon in respect of the employee");
  // Form 16 from TRACES (Income-tax Rules 1962): Part A, Part B (Annexure), or both in one file.
  if (/form no\.\s?16(?![0-9a-z])/.test(all) && has("certificate under section 203 of the income-tax act, 1961 for tax deducted at source on salary")) {
    const salary = has("details of salary paid and any other income and tax deducted");
    return summary || salary ? paper("Form 16", one(valuesFor(lines, /PAN of (the )?Employee/, PAN)), yearOf(lines, [AY]), summary, salary) : null;
  }
  // Form No. 130 (Income-tax Rules 2026, rule 215): the employee's PAN, never the employer's.
  if (/form no\.\s?130\b/.test(all) && has("certificate under section 395 for tax deducted at source on salary"))
    return paper("Form 130", one(valuesFor(region(lines, /Details of the employee\/specified senior citizen/i, /^PART B\b/i), /Permanent Account Number/, PAN)), yearOf(region(lines, undefined, /Details of the employee/i), [TY]), summary, has("part c (annexure - i) in relation to employees"));
  // Form 26AS from TRACES, titled Annual Tax Statement, read from its header above Part I.
  if (has("annual tax statement") && has("permanent account number (pan)") && /part-?\s?(i|a)\s?-\s?details of tax deducted at source/.test(all)) {
    const head = region(lines, undefined, /^PART-?\s?[IVXA]+\b/i);
    return paper("Form 26AS", one(valuesFor(head, /Permanent Account Number \(PAN\)/, PAN)), yearOf(head, [AY, FY]));
  }
  // Form No. 168 (Income-tax Rules 2026, rule 245), as far as its official blank shows.
  if (/form no\.\s?168\b/.test(all) && /\[\s?see rule 245\s?\]/.test(all) && has("annual information statement") && has("part a: particulars of the person"))
    return paper("Form 168", one(valuesFor(region(lines, /Part A: Particulars of the Person/i, /Part B: Nature of Information/i), /\bPAN\b/, PAN)), yearOf(region(lines, undefined, /Part A: Particulars of the Person/i), [TY]));
  // AIS and TIS by the parts the official FAQ names.
  if (has("annual information statement") && has("general information") && has("tds/tcs information") && has("sft information"))
    return paper("AIS", one(valuesFor(region(lines, /General Information/i, /TDS\/TCS Information/i), /Permanent Account Number \(PAN\)|\bPAN\b/, PAN)), yearOf(region(lines, undefined, /TDS\/TCS Information/i), [AY, FY, TY]));
  if (has("taxpayer information summary") && has("information category")) {
    const head = region(lines, undefined, /Information Category/i);
    return paper("TIS", one(valuesFor(head, /Permanent Account Number \(PAN\)|\bPAN\b/, PAN)), yearOf(head, [AY, FY, TY]));
  }
  // ITR-V and the acknowledgement (Notification 51/2026): the PAN above the verification, not a signatory's.
  // The ITR-V's "e-Filing Acknowledgement Number" label wraps, so its value can sit inside it.
  if (has("indian income tax return verification") && has("e-filing acknowledgement")) {
    const head = region(lines, undefined, /^VERIFICATION$/i);
    return paper("ITR-V", one(valuesFor(head, /\bPAN\b/, PAN)), yearOf(head, [AY]));
  }
  if (has("indian income tax return acknowledgement") && has("e-filing acknowledgement")) {
    const head = region(lines, undefined, /Current Year business loss|Taxable Income and Tax details/i);
    return paper("Acknowledgement", one(valuesFor(head, /\bPAN\b/, PAN)), yearOf(head, [AY]));
  }
  return null;
}

// A PDF from the income tax portals, or null; a locked one opens only with a typed password.
export async function recognisePortalPdf(bytes: Uint8Array, password?: string): Promise<TaxPaper | null> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return null;
  try {
    const paper = recogniseTaxPdf(await pdfLines(bytes, 5, password));
    return paper && { type: paper.type, pan: paper.pan, period: paper.period };
  } catch {
    return null;
  }
}

// The Form 26AS text file from TRACES: fields separated by "^", a header line of names with
// its values on the next line, and parts titled as in the PDF.
export const title = (row: string) => plain(row.replace(/^[\s^]+|[\s^]+$/g, ""));
export const PART_ONE = /^PART[- ]?(I|A)\s?-\s?Details of Tax Deducted at Source$/i;
export function recogniseTaxText(bytes: Uint8Array): TaxPaper | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
  const rows = text.split(/\r?\n/), at = rows.findIndex((row) => row.split("^").map(plain).includes("Permanent Account Number (PAN)"));
  if (at < 0 || !rows.some((row) => title(row) === "Annual Tax Statement") || !rows.some((row) => PART_ONE.test(title(row)))) return null;
  const head = rows[at].split("^").map(plain), values = (rows[at + 1] ?? "").split("^").map(plain);
  const get = (name: string) => (head.includes(name) ? (values[head.indexOf(name)] ?? "") : "");
  const pan = get("Permanent Account Number (PAN)"), assessment = firstYear(get("Assessment Year")), financial = get("Financial Year");
  return isPan(pan) && assessment !== null && (!financial || firstYear(financial) === assessment - 1) ? { type: "Form 26AS", pan, period: String(assessment) } : null;
}
