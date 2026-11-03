// A due date extension read from an official notice's published title, by plain rules and
// nothing else (the user, 3 Nov 2026): which return InboxCA knows, which period, and the new
// date, only when every one of those is plain in the text. Anything else is "unclear" with the
// reason, for a person to decide; a title not about a due date reads as null. No date is ever
// invented, and a date is never read from anywhere but the text.
export type Extension = { codes: string[]; period: string; on: string; from?: string };
export type Reading = Extension | { unclear: string } | null;

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthWord = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const monthNumber = (word: string) => months.findIndex((month) => month.startsWith(word.toLowerCase().slice(0, 3))) + 1;
const key = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// "25th October, 2026", "25 Oct 2026", "25.10.2026" or "25/10/2026", as notices print them.
const dated = `(\\d{1,2})(?:st|nd|rd|th)?[\\s.,/-]*(${monthWord}|\\d{1,2})[\\s.,/-]*(\\d{4})`;
function isoDate([, day, month, year]: RegExpMatchArray | string[]) {
  const number = /^\d+$/.test(month) ? Number(month) : monthNumber(month);
  const date = new Date(Date.UTC(Number(year), number - 1, Number(day)));
  return number >= 1 && number <= 12 && date.getUTCMonth() === number - 1 && date.getUTCDate() === Number(day) ? date.toISOString().slice(0, 10) : null;
}

// The returns by the words notices use for them; one family a notice, or it is unclear.
const families: [RegExp, string][] = [
  [/\bGSTR[\s-]*1\b/i, "GSTR1"],
  [/\bGSTR[\s-]*3B\b/i, "GSTR3B"],
  [/\bGSTR[\s-]*4\b/i, "GSTR4"],
  [/\bGSTR[\s-]*9C?\b/i, "GSTR9"],
  [/\bCMP[\s-]*08\b/i, "CMP08"],
  [/\bPMT[\s-]*06\b/i, "PMT06"],
  [/\baudit report|report of audit|\b3C[ABD]\b|form(?: no\.?)? 26\b|section 44AB/i, "TAX_AUDIT"],
  [/\bITRs?\b|returns? of income|income[\s-]*tax returns?/i, "ITR"],
  [/\bTDS statements?|statements? of (?:tax )?deduct|form(?: no\.?)? (?:24Q|26Q|27Q|138|140)\b/i, "TDS_RET"],
  [/\badvance tax\b/i, "ADV_TAX"],
  [/\bAOC[\s-]*4\b/i, "AOC4"],
  [/\bMGT[\s-]*7\b/i, "MGT7"],
  [/\bDPT[\s-]*3\b/i, "DPT3"],
  [/\bMSME[\s-]*1\b/i, "MSME1"],
  [/\bDIR[\s-]*3[\s-]*KYC\b/i, "DIR3KYC"],
  [/\bLLP\b.*\bform[\s-]*8\b|\bform[\s-]*8\b.*\bLLP\b/i, "LLP8"],
  [/\bLLP\b.*\bform[\s-]*11\b|\bform[\s-]*11\b.*\bLLP\b/i, "LLP11"],
];
const monthly = new Set(["GSTR1", "GSTR3B", "PMT06"]);
const quarterly = new Set(["CMP08", "TDS_RET"]);
const yearly = new Set(["GSTR4", "GSTR9", "TAX_AUDIT", "ITR", "AOC4", "MGT7", "DPT3", "DIR3KYC", "LLP8", "LLP11"]);

export function readExtension(title: string): Reading {
  const text = title.replace(/\s+/g, " ");
  if (!/\bexten(?:d|ds|ded|ding|sion)\b/i.test(text) || !/\b(?:due date|last date|time limit|timeline|date (?:of|for) (?:filing|furnishing)|time (?:of|for) (?:filing|furnishing))\b/i.test(text)) return null;
  const found = [...new Set(families.filter(([pattern]) => pattern.test(text)).map(([, family]) => family))];
  if (!found.length) return { unclear: "It names a return InboxCA does not keep dates for" };
  if (found.length > 1) return { unclear: "It names more than one return" };
  if (/\bstate of\b|\bstates\b|\bunion territory|principal place of business|\bdistricts?\b|\bcertain\b|\bother than\b|\bexcept\b|\bpartial/i.test(text)) return { unclear: "It is for a state or only some taxpayers" };
  const [family] = found;
  const codes = family === "ITR" ? itrCodes(text) : family === "GSTR1" || family === "GSTR3B" ? [`${family}_${/\bquarter/i.test(text) ? "Q" : "M"}`] : [family];
  if (!codes) return { unclear: "It does not say which taxpayers' returns" };
  const dates = [...text.matchAll(new RegExp(dated, "gi"))].map((match) => ({ at: match.index!, date: isoDate(match) }));
  if (dates.some((found) => !found.date)) return { unclear: "A date in it could not be read" };
  // "from 31st October 2026 to 10th December 2026", or just "till 25th October 2026".
  const to = dates.filter((found) => /\b(?:to|till|until|upto|up to)\s*(?:the\s+)?$/i.test(text.slice(Math.max(0, found.at - 12), found.at)));
  const from = dates.find((found) => /\bfrom\s*(?:the\s+)?$/i.test(text.slice(Math.max(0, found.at - 12), found.at)));
  if (to.length !== 1) return { unclear: to.length ? "It names more than one new date" : "It does not say the new date" };
  const period = periodOf(family, text, from?.date ?? undefined);
  if (!period) return { unclear: "It does not say which period" };
  return { codes, period, on: to[0].date!, ...(from ? { from: from.date! } : {}) };
}

// Which income tax returns a notice means: the audit cases, those without an audit, or those
// with a transfer pricing report; a notice that does not say waits for a person.
function itrCodes(text: string) {
  if (/transfer pricing|section 92E|form(?: no\.?)? 3CEB/i.test(text)) return ["ITR_TP"];
  if (/\bnon[\s-]?audit\b|not (?:liable|required|subject) to (?:get |have )?(?:their |its |the )?(?:accounts? |books? )?audit/i.test(text)) return ["ITR_NA", "ITR_BIZ"];
  if (/\baudit/i.test(text)) return ["ITR_AUDIT"];
  return null;
}

// The period as InboxCA keys it: the last month of the period (YYYY-MM). A year is the
// financial year's end ("FY 2025-26" and "AY 2026-27" are both 2026-03; "tax year 2026-27"
// under the Income-tax Act 2025 is 2027-03); a month is itself; a quarter or half year is its
// last named month.
function periodOf(family: string, text: string, from?: string) {
  if (yearly.has(family)) {
    const years = [...text.matchAll(/\b(FY|F\.Y\.|financial year|AY|A\.Y\.|assessment year|tax year)\s*(\d{4})\s*-\s*(\d{2,4})\b/gi)].map(([, kind, start]) => Number(start) + (/^tax/i.test(kind) ? 1 : /^a/i.test(kind) ? 0 : 1));
    return years.length && years.every((year) => year === years[0]) ? key(years[0], 3) : null;
  }
  // The months named on their own, not those inside the dates.
  const spans = [...text.replace(new RegExp(dated, "gi"), " ").matchAll(new RegExp(`\\b(${monthWord})[,\\s]+(\\d{4})\\b`, "gi"))].map(([, month, year]) => key(Number(year), monthNumber(month)));
  const distinct = [...new Set(spans)];
  if (monthly.has(family) || quarterly.has(family) || family === "MSME1") {
    const quarter = /\bquarter|half[\s-]year/i.test(text);
    // A quarter named by its months ("July to September 2026") ends with the last one.
    if (quarter) return distinct.length ? distinct.at(-1)! : null;
    return !quarterly.has(family) && family !== "MSME1" && distinct.length === 1 ? distinct[0] : null;
  }
  // An advance tax instalment is the month it was due in.
  return family === "ADV_TAX" && from ? from.slice(0, 7) : null;
}
