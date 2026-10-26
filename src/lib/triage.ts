// Email triage by rules first (PLAN.md 5.5): words in the subject, the text and the
// attachment names, in English, Hindi, Gujarati and Hinglish. A clear match costs no AI
// credits; anything unclear is "other", which goes to the team. Runs in memory only: the
// email itself is never stored.
export const labels = {
  records_past: "Asks for papers of past years",
  records_current: "Asks for this year's papers",
  notice_received: "Notice received",
  data_gst: "GST data",
  data_income_tax: "Income tax data",
  data_tax_audit: "Tax audit data",
  ask_filed: "Asks if a return is filed",
  ask_papers: "Asks which papers are still needed",
  ask_due: "Asks what is due",
  other: "Other",
} as const;
export type Label = keyof typeof labels;
// Questions about where things stand, which InboxCA can answer from its own records.
export const statusLabels: Label[] = ["ask_filed", "ask_papers", "ask_due"];
// Why an email waits for the team, in words for people.
export const replyReasons: Record<string, string> = {
  no_rule: "Asks something InboxCA could not answer",
  notice_question: "Sent a notice and asks what to do",
  record_internal: "Asks for a paper kept inside your firm",
  record_not_found: "Asks for a paper that is not in the drive",
  record_unclear: "Asks for a paper, but more than one paper matches",
  not_allowed: "Asks for a paper this sender may not receive",
  data_unclear: "Sent papers, but InboxCA could not tell if they are for GST, income tax or tax audit",
  client_unclear: "Writes for several clients. Pick which one",
  asks_several: "Asks more than one thing",
  ask_filed: "Asks if a return is filed",
  ask_papers: "Asks which papers are still needed",
  ask_due: "Asks what is due",
  status_not_filed: "Asks if a return is filed. It is not marked filed yet",
  status_unclear: "Asks if a return is filed. InboxCA could not tell which one",
  papers_none: "Asks which papers are still needed. None are asked for in InboxCA",
  due_unchecked: "Asks what is due. Some of its due dates are not checked yet",
  due_late: "Asks what is due. A return looks late",
  due_none: "Asks what is due. Nothing is due in the next 30 days in InboxCA",
  answer_not_allowed: "Asks about the client's returns but may not receive its papers",
};
// A Needs reply email snoozed to a later day stays out of Needs reply until that day (India
// time), as a PostgREST filter on the request's details.
export const awake = (today: string) => `details->>snooze.is.null,details->>snooze.lte.${today}`;
export type Email = { subject: string; text: string; attachments: string[] };

const words = {
  notice: ["notice", "intimation", "show cause", "143(1)", "u/s 148", "section 148", "drc-01", "drc 01", "asmt-10", "asmt 10", "demand order", "summons", "नोटिस", "નોટિસ"],
  ask: ["send", "share", "forward", "need a copy", "copy of", "please provide", "can you provide", "bhej*", "chahiye", "भेज*", "चाहिए", "મોકલ*", "જોઈએ"],
  record: ["itr", "acknowledg*", "computation", "financial statement", "balance sheet", "profit and loss", "audit report", "filed return", "return copy", "gst return", "gstr-1", "gstr 1", "gstr1", "gstr-3b", "gstr 3b", "gstr3b", "challan", "certificate", "रिटर्न", "રિટર્ન", "चालान", "ચલણ", "बैलेंस शीट", "બેલેન્સ શીટ", "ऑडिट रिपोर्ट", "ઓડિટ રિપોર્ટ"],
  past: ["last year", "previous year", "old return", "earlier year", "pichhle saal", "pichle saal", "पिछले साल", "ગયા વર્ષ"],
  data_gst: ["gst data", "sales", "purchase", "invoice", "bills", "b2b", "gstr-1 data", "gstr 1 data", "e-way", "बिल", "बिक्री", "खरीद", "વેચાણ", "ખરીદી", "બિલ"],
  data_income_tax: ["form 16", "form16", "salary", "interest certificate", "capital gain", "80c", "investment proof", "rent receipt", "home loan", "itr data", "income details", "pension", "वेतन", "પગાર"],
  call: ["call", "phone", "फोन", "ફોન"],
  data_tax_audit: ["tax audit", "3cd", "3cb", "trial balance", "ledger", "tally backup", "stock statement", "audit data", "fixed asset"],
  // Questions about where things stand ("Inbox, answered" B): a return filed, papers still
  // needed, what is due. Each needs a question, and none may ask advice, fees or why.
  filed: ["filed", "submitted", "file ho gaya", "file hogaya", "file ho gayi", "file hua", "file kiya", "file kar diya", "file kar di", "bhar diya", "bhar di", "bhara gaya", "फाइल हो गया", "फाइल हो गई", "फाइल हुआ", "फाइल कर दिया", "भर दिया", "भरा गया", "ફાઇલ થઈ ગયું", "ફાઇલ થયું", "ફાઇલ કર્યું", "ભરાઈ ગયું", "ભરી દીધું", "ભર્યું"],
  returns: ["return", "itr", "gst", "gstr*", "tds", "रिटर्न", "રિટર્ન"],
  pending: ["pending", "still need*", "still required", "remaining", "missing", "do you need", "you still need", "anything else", "baki", "baaki", "kya bhej*", "kya chahiye", "बाकी", "क्या भेज*", "क्या चाहिए", "બાકી", "શું મોકલ*", "શું જોઈએ"],
  papers: ["papers", "paper", "documents", "document", "docs", "kagaz", "kaagaz", "from my side", "from our side", "from me", "from us", "meri taraf se", "कागज", "कागजात", "दस्तावेज", "मेरी तरफ से", "કાગળ", "દસ્તાવેજ", "મારી તરફથી"],
  due: ["due", "due date", "last date", "deadline", "kab tak", "कब तक", "आखिरी तारीख", "अंतिम तारीख", "ક્યાં સુધી", "છેલ્લી તારીખ"],
  question: ["whether", "status", "please confirm", "confirm if", "let me know if", "kya", "kab", "क्या", "कब", "શું", "ક્યારે"],
  advice: ["advice", "advise", "suggest*", "recommend*", "should i", "should we", "opinion", "why", "mean", "meaning", "fee", "fees", "dues", "charges", "your bill", "pay you", "penalty", "refund", "complain*", "salah", "सलाह", "फीस", "સલાહ", "ફી"],
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
  // A notice that asks something (a question, or to call) also waits for the team.
  if (count(everything, "notice")) return { label: "notice_received", reason: text.includes("?") || count(text, "call") ? "notice_question" : "notice_words" };

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
  // A question about where things stand, answered from InboxCA's records. "Due to" is not a date.
  const asking = !email.attachments.length && (text.includes("?") || count(text, "question") > 0) && !count(text, "advice");
  const kinds = asking ? statusLabels.filter((label) =>
    label === "ask_filed" ? count(text, "filed") && count(text, "returns")
      : label === "ask_papers" ? count(text, "pending") && count(text, "papers")
        : count(text.replace(/\bdue to\b/g, ""), "due")) : [];
  if (kinds.length > 1) return { label: "other", reason: "asks_several" };
  if (kinds.length) return { label: kinds[0], reason: "status_question" };
  return { label: "other", reason: "no_rule" };
}
