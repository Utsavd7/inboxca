import { cleanNumber, isGstin, isPan, numberKinds, panOfGstin } from "./identifiers";

// Kinds of client (PLAN.md 6), for pages and the browser form.
export const clientKinds = {
  individual: "Individual",
  business: "Business",
  tax_audit: "Business with tax audit",
  company: "Company",
  llp: "LLP",
  trust: "Trust",
} as const;

export type ClientKind = keyof typeof clientKinds;

// The example row on the client list template's How to fill sheet. An import leaves it out
// when someone copies it into their list.
export const exampleClient = { name: "Sharma Traders (example)", kind: clientKinds.business, pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z0", email: "accounts@example.com", phone: "98765 43210" };

// What each person assigned to a client does for it.
export const assignmentRoles = { partner_in_charge: "Partner in charge", manager: "Manager", staff: "Staff" } as const;

// Who may add and change clients; staff view only (PLAN.md 5.17.2).
export const canManageClients = (role: string) => ["owner", "partner", "manager"].includes(role);

export type ClientInput = { name: string; kind: string; pan: string; gstin: string; email: string; phone?: string };

// A phone number as typed or imported, kept as the country code and digits ("+919876543210")
// so a WhatsApp link can use it: 10 digits are an Indian number, a leading 0 is dropped, and
// "+" or "00" starts another country's code. Null when it is not a number.
export function cleanPhone(value: string) {
  const typed = value.replace(/[\s().-]/g, "");
  if (!typed) return "";
  const rest = typed.replace(/^(\+|00)/, "");
  if (!/^\d+$/.test(rest)) return null;
  if (rest.length !== typed.length) return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  const local = rest.replace(/^0/, "");
  return /^\d{10}$/.test(local) ? `+91${local}` : null;
}

// WhatsApp's click to chat link (wa.me): opens the chat in the person's own WhatsApp with the
// text filled in; they press send. No API, nothing sent by InboxCA.
export const whatsappLink = (phone: string, text = "") => `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// Checks a client as typed or imported, and gives it back cleaned, or why it can't be added.
// A GSTIN holds the PAN, so the PAN can be left empty when a GSTIN is given.
export function checkClient(input: ClientInput): { client: ClientInput } | { error: string } {
  const name = input.name.trim();
  const gstin = cleanNumber(input.gstin);
  const pan = cleanNumber(input.pan) || (gstin && panOfGstin(gstin));
  const email = (input.email ?? "").trim().toLowerCase();
  if (!name || name.length > 200) return { error: "Enter the client's name." };
  if (!(input.kind in clientKinds)) return { error: "Choose the client type." };
  if (gstin && !isGstin(gstin)) return { error: "That GSTIN is not valid. Check it for a typing mistake." };
  if (pan && !isPan(pan)) return { error: "That PAN is not valid. A PAN is 5 letters, 4 digits and a letter." };
  if (gstin && panOfGstin(gstin) !== pan) return { error: "The PAN does not match the GSTIN. Characters 3 to 12 of a GSTIN are the PAN. Check both, or leave the PAN empty." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address is not valid." };
  const phone = cleanPhone(input.phone ?? "");
  if (phone === null) return { error: "That phone number is not valid. Type the 10 digit number, or + and the country code for a number outside India." };
  return { client: { name, kind: input.kind, pan, gstin, email, phone } };
}

// A kind as people write it in a spreadsheet ("Pvt Ltd", "Proprietor", "LLP"). Blank means
// a business when there is a GSTIN, else an individual; anything unknown is null.
export function readKind(text: string, hasGstin: boolean): ClientKind | null {
  const kind = text.trim().toLowerCase();
  if (!kind) return hasGstin ? "business" : "individual";
  const named = Object.entries(clientKinds).find(([key, label]) => key === kind || label.toLowerCase() === kind);
  if (named) return named[0] as ClientKind;
  const guesses: [RegExp, ClientKind][] = [
    [/audit/, "tax_audit"],
    [/llp|limited liability/, "llp"],
    [/compan|pvt|private limited|ltd|limited/, "company"],
    [/trust|society/, "trust"],
    [/individual|salaried|person/, "individual"],
    [/business|proprietor|partnership|firm|trader|shop/, "business"],
  ];
  return guesses.find(([pattern]) => pattern.test(kind))?.[1] ?? null;
}

// The client list's optional Services columns. Each choice is the calendar's own services
// (compliance_types codes) on one of the client's numbers, as Change services on the client's
// page ticks them: QRMP with its monthly payment, composition with its annual return, TDS
// returns with the monthly TDS payments. Empty adds nothing; anything else is a row's problem.
export const importServices: Record<string, { number: "pan" | "gstin" | "tan"; choices: Record<string, string[]> }> = {
  "GST returns": { number: "gstin", choices: { Monthly: ["GSTR1_M", "GSTR3B_M"], "Quarterly (QRMP)": ["GSTR1_Q", "GSTR3B_Q", "PMT06"], Composition: ["CMP08", "GSTR4"], None: [] } },
  "TDS returns": { number: "tan", choices: { Yes: ["TDS_PAY", "TDS_RET"], No: [] } },
  "Income tax return": { number: "pan", choices: { "No business and no audit": ["ITR_NA"], "Business and no audit": ["ITR_BIZ"], "Audit case": ["ITR_AUDIT"], "Transfer pricing": ["ITR_TP"], None: [] } },
};
const or = (words: string[]) => words.join(", ").replace(/, ([^,]*)$/, " or $1");

// A row's services by number from what its Services columns say (any case; "Quarterly" for
// "Quarterly (QRMP)"), or why they cannot be added. fits says whether a service is for the
// row's kind of client.
export function readServices(said: Record<string, string>, numbers: Record<"pan" | "gstin" | "tan", string>, kind: ClientKind, fits: (code: string) => boolean) {
  const services: Partial<Record<"pan" | "gstin" | "tan", string[]>> = {};
  for (const [column, { number, choices }] of Object.entries(importServices)) {
    const text = (said[column] ?? "").trim();
    if (!text) continue;
    const choice = Object.keys(choices).find((name) => [name, name.split(" (")[0]].some((form) => form.toLowerCase() === text.toLowerCase()));
    if (!choice) return { error: `"${text}" is not a choice for ${column}. Use ${or(Object.keys(choices))}.` };
    if (!choices[choice].length) continue;
    if (!numbers[number]) return { error: `For ${column}, give the client's ${numberKinds[number].name}.` };
    if (!choices[choice].every(fits)) return { error: `"${choice}" in ${column} is not for a ${clientKinds[kind]} client.` };
    services[number] = choices[choice];
  }
  return { services };
}

// The services a kind of client files on a number by the calendar's own rules, suggested on a
// client with none for a person to confirm (20261028300000 and 20261031000000): a plain
// business or an LLP files the 31 August ITR, a company or a business with tax audit the audit
// one (Income-tax Act s.139(1), Explanation 2), the latter with its tax audit report; every LLP
// files Forms 8 and 11 (LLP Act s.34 and s.35); a TAN is for TDS. An individual's or a trust's
// ITR and GST monthly or quarterly depend on the client, so nothing is suggested for them.
export function usualServices(kind: string, number: string): string[] {
  if (number === "tan") return ["TDS_PAY", "TDS_RET"];
  if (number === "llpin") return ["LLP8", "LLP11"];
  if (number !== "pan") return [];
  return ({ business: ["ITR_BIZ"], llp: ["ITR_BIZ"], company: ["ITR_AUDIT"], tax_audit: ["TAX_AUDIT", "ITR_AUDIT"] } as Record<string, string[]>)[kind] ?? [];
}
