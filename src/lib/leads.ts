import { z } from "zod";
import { addDays } from "./calendar";
import { clientKinds, readKind, type ClientKind } from "./clients";
import type { serverCrypto } from "./crypto";

// The lead pipeline (PLAN.md 5.12): a lead is a client at an earlier stage. The board's
// columns, in order; Won turns the lead into a client.
export const stages = { lead_new: "New", qualifying: "Qualifying", proposal: "Proposal", client: "Won", lost: "Lost", cold: "Cold" } as const;
export type Stage = keyof typeof stages;
export const openStages = ["lead_new", "qualifying", "proposal"] as const;

// Who sees and works leads (PLAN.md 3): the owner, partners and the front desk. Turning a lead
// into a client adds a client, which the owner and partners do.
export const worksLeads = (role: string) => ["owner", "partner", "front_desk"].includes(role);
export const convertsLeads = (role: string) => ["owner", "partner"].includes(role);

export const services = {
  itr: "Income tax return",
  gst: "GST registration or returns",
  books: "Bookkeeping and accounts",
  audit: "Audit",
  company: "Company or LLP setup",
  tds: "TDS returns",
  other: "Something else",
} as const;
export const urgencies = { now: "This week", month: "This month", later: "Just asking" } as const;
export const lostReasons = { price: "Fees too high", other_firm: "Chose another firm", no_reply: "Stopped replying", not_a_fit: "Not work we do", other: "Another reason" } as const;

// What a lead's details hold; the phone is encrypted with the firm's key.
export const detailsSchema = z.object({
  service: z.enum(Object.keys(services) as [keyof typeof services]).optional(),
  urgency: z.enum(Object.keys(urgencies) as [keyof typeof urgencies]).optional(),
  phone_enc: z.string().optional(),
  follow_up_on: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).optional(),
  lost_reason: z.string().optional(),
});
export type LeadDetails = z.infer<typeof detailsSchema>;
export const leadDetails = (value: unknown): LeadDetails => detailsSchema.catch({}).parse(value);

// An enquiry as typed in the form or the Add a lead panel, cleaned, or why it can't be added.
const enquirySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Enter a name."),
  email: z.string().trim().toLowerCase().max(254, "That email address is not valid.").refine((email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "That email address is not valid."),
  phone: z.string().trim().refine((phone) => !phone || /^\+?[0-9 ()-]{7,20}$/.test(phone), "That phone number is not valid."),
  kind: z.enum(Object.keys(clientKinds) as [ClientKind], "Choose who the work is for."),
  service: z.enum(Object.keys(services) as [keyof typeof services], "Choose what help is needed."),
  urgency: z.enum(Object.keys(urgencies) as [keyof typeof urgencies], "Choose when it is needed."),
  message: z.string().trim().max(1000, "Keep the message under 1,000 letters."),
});
export type Enquiry = z.infer<typeof enquirySchema>;
export function checkEnquiry(form: FormData, needEmail: boolean): { enquiry: Enquiry } | { error: string } {
  const read = (name: string) => String(form.get(name) ?? "");
  const parsed = enquirySchema.safeParse({ name: read("name"), email: read("email"), phone: read("phone"), kind: read("kind"), service: read("service"), urgency: read("urgency") || "month", message: read("message") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (needEmail && !parsed.data.email) return { error: "Enter an email address, so we can reply." };
  return { enquiry: parsed.data };
}
// What was typed, to show again with the reason it was refused.
export const typedValues = (form: FormData) =>
  Object.fromEntries(["name", "email", "phone", "kind", "service", "urgency", "follow_up", "message"].map((name) => [name, String(form.get(name) ?? "").slice(0, 1000)]));

// A lead's fields as add_lead and add_form_lead take them: the email, phone and notes sealed
// with the firm's key for this lead's id (PLAN.md 8.4); an empty one is none.
export async function sealLead(crypto: ReturnType<typeof serverCrypto>, firm: string, id: string, enquiry: Enquiry, followUp: string | null) {
  const seal = (field: string, text: string) => (text ? crypto.encrypt(firm, `clients/${id}/${field}`, text) : "");
  const details: LeadDetails = { service: enquiry.service, urgency: enquiry.urgency, ...(followUp && { follow_up_on: followUp }), ...(enquiry.phone && { phone_enc: await seal("phone", enquiry.phone) }) };
  return {
    lead_name: enquiry.name,
    lead_kind: enquiry.kind,
    lead_email_enc: await seal("email", enquiry.email),
    lead_email_bidx: enquiry.email ? await crypto.blindIndex(firm, "email", enquiry.email) : "",
    lead_details: details,
    lead_notes_enc: await seal("notes", enquiry.message),
  };
}

// Follow-ups (PLAN.md 5.2): every 3 days, up to 4. After the 4th there is no next day; the
// team decides whether the lead goes cold.
export const FOLLOW_UPS = 4;
export const nextFollowUp = (today: string, sentBefore: number) => (sentBefore + 1 >= FOLLOW_UPS ? null : addDays(today, 3));

// The spam checks of the public form, without a paid captcha: a field people never see
// (bots fill it), and a form sent sooner than a person could, or from a page over a day old.
export const FORM_MIN_SECONDS = 3;
export function humanSent(trap: string, startedAt: number, now = Date.now()) {
  const seconds = (now - startedAt) / 1000;
  return !trap && seconds >= FORM_MIN_SECONDS && seconds <= 86_400;
}
// At most this many enquiries an hour from one address, and from everyone, for one firm.
export const FORM_LIMITS = { perSender: 5, perFirm: 50 };

// Email from someone who is not a client or contact yet, read in memory: whether it reads like
// someone asking for the firm's services (rules, no AI). Newsletters, mailers and automatic
// notices are left out.
const enquiryWords = [
  "enquiry", "inquiry", "quotation", "quote", "your fees", "your charges", "fees for", "charges for", "how much do you charge", "looking for a ca", "looking for a chartered accountant",
  "need a ca", "need a chartered accountant", "your services", "can you help", "could you help", "help me with", "want to file", "file my", "get registered", "new client",
  "kitna charge", "fees kya", "karwana hai", "करवाना", "फीस", "सेवा", "ફી", "સેવા",
];
const serviceWords: [keyof typeof services, RegExp][] = [
  ["gst", /\bgst\b|gstin|gst registration/],
  ["itr", /\bitr\b|income tax return|tax return|income tax filing/],
  ["company", /company (registration|incorporation)|incorporat|\bllp\b|private limited|pvt ltd|start a company/],
  ["audit", /\baudit\b/],
  ["books", /bookkeeping|book keeping|accounting|accounts/],
  ["tds", /\btds\b/],
];
const automated = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|bounces?|newsletter|news)[@.+-]/;

export function looksLikeEnquiry(from: string, mail: { subject: string; text: string }) {
  const text = `${mail.subject}\n${mail.text}`.toLowerCase();
  if (automated.test(from.toLowerCase()) || text.includes("unsubscribe")) return false;
  const asks = enquiryWords.filter((word) => text.includes(word)).length;
  return asks >= 2 || (asks === 1 && !!guessService(text));
}

// The service an enquiry names, if one.
export const guessService = (text: string) => serviceWords.find(([, pattern]) => pattern.test(text.toLowerCase()))?.[0];

// What InboxCA proposes for an email enquiry; staff confirm it in one click (PLAN.md 5.12).
export function proposeLead(from: string, fromName: string, mail: { subject: string; snippet: string }) {
  const text = `${mail.subject}\n${mail.snippet}`;
  return { name: fromName.trim().slice(0, 200) || nameFromAddress(from), service: guessService(text) ?? "other", kind: guessKind(text) };
}
const guessKind = (text: string): ClientKind => (/company|pvt|ltd|llp|trust|business|shop|firm|proprietor/i.test(text) ? (readKind(text, false) ?? "individual") : "individual");

// "Meera Shah" from meera.shah@example.in; the address itself when its name part says nothing.
export function nameFromAddress(address: string) {
  const words = address.split("@")[0].split(/[._-]+/).map((word) => word.replace(/\d+/g, "")).filter((word) => word.length > 1);
  return words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ").slice(0, 200) : address;
}
