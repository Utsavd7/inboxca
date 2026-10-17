// Email triage by rules first (PLAN.md 5.5): words in the subject, the text and the
// attachment names, in English, Hindi, Gujarati and Hinglish. A clear match costs no AI
// credits; anything unclear is "other", which goes to the team. Runs in memory only: the
// email itself is never stored.
export const labels = {
  records_past: "Asks for past records",
  records_current: "Asks for this year's records",
  notice_received: "Notice received",
  data_gst: "GST data",
  data_income_tax: "Income tax data",
  data_tax_audit: "Tax audit data",
  other: "Needs team reply",
} as const;
export type Label = keyof typeof labels;
export type Email = { subject: string; text: string; attachments: string[] };

const words = {
  notice: ["notice", "intimation", "show cause", "143(1)", "u/s 148", "section 148", "drc-01", "drc 01", "asmt-10", "asmt 10", "demand order", "summons", "नोटिस", "નોટિસ"],
  ask: ["send", "share", "forward", "need a copy", "copy of", "please provide", "can you provide", "bhej*", "chahiye", "भेज*", "चाहिए", "મોકલ*", "જોઈએ"],
  record: ["itr", "acknowledg*", "computation", "financial statement", "balance sheet", "audit report", "filed return", "return copy", "challan", "certificate", "रिटर्न", "રિટર્ન"],
  past: ["last year", "previous year", "old return", "earlier year", "pichhle saal", "pichle saal", "पिछले साल", "ગયા વર્ષ"],
  data_gst: ["gst data", "sales", "purchase", "invoice", "bills", "b2b", "gstr-1 data", "gstr 1 data", "e-way", "बिल", "बिक्री", "खरीद", "વેચાણ", "ખરીદી", "બિલ"],
  data_income_tax: ["form 16", "form16", "salary", "interest certificate", "capital gain", "80c", "investment proof", "rent receipt", "home loan", "itr data", "income details", "pension", "वेतन", "પગાર"],
  data_tax_audit: ["tax audit", "3cd", "3cb", "trial balance", "ledger", "tally backup", "stock statement", "audit data", "fixed asset"],
};
// Whole words, with plurals; a word ending in "*" also matches longer words it starts.
const patterns = Object.fromEntries(
  Object.entries(words).map(([key, list]) => [
    key,
    list.map((word) => {
      const stem = word.replace(/\*$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![\\p{L}\\p{N}])${stem}${word.endsWith("*") ? "" : "(?:e?s)?(?![\\p{L}\\p{N}])"}`, "u");
    }),
  ]),
) as Record<keyof typeof words, RegExp[]>;
const count = (text: string, key: keyof typeof words) => patterns[key].filter((pattern) => pattern.test(text)).length;

// The financial year that today falls in starts in April: on 17 Oct 2026 it is 2026-27.
const yearStart = (today: string) => Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);

export function classify(email: Email, today: string): { label: Label; reason: string } {
  const text = `${email.subject}\n${email.text}`.toLowerCase();
  const files = email.attachments.join(" ").toLowerCase();
  const everything = `${text} ${files}`;
  if (count(everything, "notice")) return { label: "notice_received", reason: "notice_words" };

  const data = (["data_gst", "data_income_tax", "data_tax_audit"] as const)
    .map((label) => ({ label, score: count(everything, label) }))
    .sort((a, b) => b.score - a.score);
  const asks = count(text, "ask") > 0 && count(text, "record") > 0;
  if (email.attachments.length && data[0].score && !asks) {
    if (data[0].score === data[1].score) return { label: "other", reason: "data_unclear" };
    return { label: data[0].label, reason: "data_words_with_files" };
  }
  if (asks && !email.attachments.length) {
    // A year range mentioned, as FY or AY: an AY names the year after its FY.
    const years = [...text.matchAll(/\b(a\.?y\.?|f\.?y\.?)?\s*(20\d\d)\s*[-/]\s*\d{2}\b/g)].map((match) =>
      Number(match[2]) - (match[1]?.startsWith("a") ? 1 : 0),
    );
    const past = count(text, "past") > 0 || years.some((year) => year < yearStart(today) - 1);
    return { label: past ? "records_past" : "records_current", reason: "record_request" };
  }
  return { label: "other", reason: "no_rule" };
}
