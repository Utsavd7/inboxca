// Output checks on everything AI writes for a client (PLAN.md 5.11 guardrails, D9), run in code
// after the AI answers and before any person sees it. A failed check throws the text away.

// Advice, estimates and promises are for the CA: telling the client what to do about tax, law
// or money, or naming a tax section, deduction or penalty.
const advice = [
  /\b(?:we|i) (?:would )?(?:recommend|advise|suggest)\b/i,
  /\b(?:you should|you must|you ought to|better to|best to|advisable|we promise|we guarantee)\b/i,
  /\b(?:invest(?:ing|ment)?|mutual funds?|ppf|fixed deposits?|insurance|stocks?|shares)\b/i,
  /\b(?:deductions?|exemptions?|rebates?|refunds?|penalt(?:y|ies)|tax[- ]saving|save tax|(?:old|new|tax) regime|section \d+\w*|u\/s|80c|80d|44ad|lawyer|court|legal(?:ly)?|appeal|liab(?:le|ility))\b/i,
];
// A sum in words is a figure too.
const money = /\b(?:lakhs?|lacs?|crores?|thousands?|hundreds?|rupees?|rs\.?|inr|per ?cent)\b|₹|%/gi;
const ids = [/\b[A-Z]{5}\d{4}[A-Z]\b/i, /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i, /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/];
const links = /\bhttps?:\/\/[^\s<>()"]+|\bwww\.[^\s<>()"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|co|io|gov|info|biz|me|app|link|ly|xyz)\b[^\s<>()"]*/gi;
const numbers = (text: string) => new Set((text.match(/\d+/g) ?? []).map((digits) => digits.replace(/^0+(?=\d)/, "")));

export type CheckFailure = "advice" | "figure" | "identifier" | "link";

// Null when the text may be shown: no advice; no figure, date or sum that is not in the records
// given; no PAN, GSTIN or Aadhaar number (the tools give none, so a masked one passes only when
// its characters are in the records); and no link but InboxCA's own.
export function checkAiText(text: string, records: string, base = process.env.APP_BASE_URL ?? ""): CheckFailure | null {
  if (advice.some((pattern) => pattern.test(text))) return "advice";
  if (ids.some((pattern) => pattern.test(text))) return "identifier";
  const own = base ? new URL(base).host : "";
  if ((text.match(links) ?? []).some((link) => !own || link.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase() !== own)) return "link";
  const known = numbers(records);
  if ([...numbers(text)].some((number) => !known.has(number))) return "figure";
  if ((text.match(money) ?? []).some((word) => !records.toLowerCase().includes(word.toLowerCase()))) return "figure";
  return null;
}
