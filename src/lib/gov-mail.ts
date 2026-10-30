import { isGstin, isPan } from "./identifiers";

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
  const passed = (method: "spf" | "dkim") => {
    const key = method === "spf" ? "smtp.mailfrom" : "header.(?:d|i)";
    const matches = auth.toLowerCase().matchAll(new RegExp(`${method}=pass\\b[^;]*?${key}=(?:[^@\\s;]*@)?([a-z0-9.-]+)`, "g"));
    return [...matches].some((match) => under(match[1], root));
  };
  return passed("dkim") || passed("spf") ? officialDomains[root] : null;
}

// The PANs and GSTINs written in an official mail, each checked, so the client can be found by
// its blind index. A GSTIN's own PAN is not counted again: the GSTIN is the surer match.
export function taxNumbersIn(text: string) {
  const upper = text.toUpperCase();
  const gstins = [...new Set([...upper.matchAll(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g)].map((match) => match[0]).filter(isGstin))];
  const pans = [...new Set([...upper.matchAll(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g)].map((match) => match[0]).filter(isPan))];
  return { gstins, pans };
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
