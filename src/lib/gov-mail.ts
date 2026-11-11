import { findPeriod, findQuarter } from "./documents";
import { isGstin, isPan, numberKinds } from "./identifiers";

// Mail from the tax portals that reaches the firm's own address (product gaps S2): the
// income tax e-filing portal and CPC, the GST portal and TRACES. The sender is trusted only
// when its domain is on this list AND the mailbox's own Authentication-Results header says
// the message passed SPF or DKIM for that domain; the header's spoofed From alone proves
// nothing. The domains come from the portals' published sender addresses (donotreply@
// incometax.gov.in, intimations@cpc.incometax.gov.in, donotreply@gst.gov.in, TRACES at
// tdscpc.gov.in); every one of them is to be confirmed against real mail in the pilot, and
// mca.gov.in is left out until a firm shows one.
export const officialDomains = {
  "incometax.gov.in": "income_tax",
  "incometaxindiaefiling.gov.in": "income_tax",
  "gst.gov.in": "gst",
  "tdscpc.gov.in": "income_tax",
} as const;
export type OfficialWork = (typeof officialDomains)[keyof typeof officialDomains];

const domainOf = (address: string) => address.toLowerCase().split("@").pop()?.trim() ?? "";
const under = (domain: string, root: string) => domain === root || domain.endsWith(`.${root}`);

// The work (income tax or GST) an official sender's mail belongs to, or null for anyone else
// or for an official address that did not pass SPF or DKIM for its own domain. auth is the
// message's topmost Authentication-Results header, the one the receiving mailbox wrote; lower
// copies can be forged by the sender and are never passed in.
export function officialSender(from: string, auth: string): OfficialWork | null {
  const domain = domainOf(from);
  const root = (Object.keys(officialDomains) as (keyof typeof officialDomains)[]).find((known) => under(domain, known));
  if (!root) return null;
  return passed(auth, root, "dkim") || passed(auth, root, "spf") ? officialDomains[root] : null;
}

// Whether the receiving mailbox's result says the mail passed this check for this domain.
function passed(auth: string, root: string, method: "spf" | "dkim" | "dmarc") {
  const key = method === "spf" ? "smtp.mailfrom" : method === "dkim" ? "header.(?:d|i)" : "header.from";
  const matches = auth.toLowerCase().matchAll(new RegExp(`${method}=pass\\b[^;]*?${key}=(?:[^@\\s;]*@)?([a-z0-9.-]+)`, "g"));
  return [...matches].some((match) => under(match[1], root));
}

// A client's or contact's mail that the firm's own mailbox checked and found not to come from
// the From address's domain (no DMARC, DKIM or SPF pass for it): a forged From proves nothing,
// so its files wait for a person. With no result at all (a mailbox that writes none) it is not
// marked, as nothing can be told.
export const unverifiedSender = (from: string, auth: string) =>
  !!auth.trim() && !(["dmarc", "dkim", "spf"] as const).some((method) => passed(auth, domainOf(from), method));

// The PANs and GSTINs written in an official mail, each checked, so the client can be found by
// its blind index. A GSTIN's own PAN is not counted again: the GSTIN is the surer match.
export function taxNumbersIn(text: string) {
  const upper = text.toUpperCase();
  const gstins = [...new Set([...upper.matchAll(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g)].map((match) => match[0]).filter(isGstin))];
  const pans = [...new Set([...upper.matchAll(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g)].map((match) => match[0]).filter(isPan))];
  const tans = [...new Set([...upper.matchAll(/\b[A-Z]{4}[0-9]{5}[A-Z]\b/g)].map((match) => match[0]).filter(numberKinds.tan.valid))];
  return { gstins, pans, tans };
}

// What an official mail is about, from its words: a notice, intimation or order goes to
// Notices; a filing acknowledgement (ITR-V, ARN) or an e-verification confirmation is filed
// with the client's papers. Anything else waits for the team.
export type OfficialKind = "notice" | "verified" | "acknowledgement" | "other";
export function officialKind(subject: string, text: string): OfficialKind {
  const words = `${subject}\n${text}`.toLowerCase();
  if (/\bnotice\b|\bintimation\b|\border\b|\bdemand\b|\bdefective\b|\bscrutiny\b|\bshow cause\b|\bsummon/.test(words)) return "notice";
  if (/\be-?verif(?:ied|ication)\b[\s\S]{0,80}?\b(?:success|complete|done|received)|\b(?:success|complete)\w*\s+e-?verified\b/.test(words)) return "verified";
  if (/\backnowledg|\bitr-?v\b|\barn\b|\bapplication reference number\b|\bfiled successfully\b|\bsuccessfully (?:filed|submitted)\b/.test(words)) return "acknowledgement";
  return "other";
}

// The return a filing acknowledgement is for, read by strict rules: the forms it can be, the one
// period it names and its number. A person still marks the return filed (src/jobs/mail-poll.ts).
// Numbers follow official formats only: an income tax return's acknowledgement number is 15
// digits (the ITR schema's ReceiptNo, "Acknowledgement number of the original return",
// [0-9]{15}), and a TDS or TCS statement's token number 15 digits (Protean's file formats, as
// src/lib/tds.ts checks it). No official text gives the GST ARN's format, so it is never read and
// the person types it. A number or period is taken only when the mail names exactly one.
export function filedReturn(work: OfficialWork, subject: string, text: string) {
  // A date (filed on 12/11/2026, 31-Jul-2026) is not the period.
  const words = `${subject}\n${text}`.toLowerCase().replace(/\b\d{1,2}(?:st|nd|rd|th)?[-/. ]+(?:\d{1,2}|[a-z]{3,9})[-/. ,]+20\d\d\b|\b20\d\d-\d\d-\d\d\b/g, " ");
  const one = (found: string[]) => (new Set(found).size === 1 ? found[0] : "");
  const period = (read: (line: string) => string, length: number) => one(words.split(/[\n,;]/).map(read).filter((key) => key.length === length));
  const number = (label: string) => one([...words.matchAll(new RegExp(`\\b(?:${label})\\s*(?:no\\.?|number)\\s*(?:is)?\\s*[:-]?\\s*(\\d{15})(?!\\d)`, "g"))].map((match) => match[1]));
  const named = (pattern: RegExp) => [...new Set([...words.matchAll(pattern)].map((match) => match[1]))];
  if (work === "gst") {
    const forms = named(/\bgstr[\s-]?(1|3b)\b/g);
    return forms.length === 1 ? { form: forms[0] === "1" ? /^GSTR1$/ : /^GSTR3B$/, period: period(findPeriod, 7), number: "" } : null;
  }
  if (/\b(?:token|provisional receipt)\s*(?:no\b|number)|\b(?:tds|tcs) statement/.test(words)) return { form: /^TDS\d{3}$/, period: period(findQuarter, 7), number: number("token|provisional receipt") };
  const forms = named(/\bitr[\s-]?([1-7])\b/g);
  if (forms.length > 1 || !forms.length && !/\bitr\b|income tax return/.test(words)) return null;
  return { form: forms.length ? new RegExp(`^ITR${forms[0]}$`) : /^ITR\d$/, period: period(findPeriod, 4), number: number("acknowledge?ment|ack\\.?") };
}
