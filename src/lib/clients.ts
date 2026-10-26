import { cleanNumber, isGstin, isPan, panOfGstin } from "./identifiers";

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

// What each person assigned to a client does for it.
export const assignmentRoles = { partner_in_charge: "Partner in charge", manager: "Manager", staff: "Staff" } as const;

// Who may add and change clients; staff view only (PLAN.md 5.17.2).
export const canManageClients = (role: string) => ["owner", "partner", "manager"].includes(role);

export type ClientInput = { name: string; kind: string; pan: string; gstin: string; email: string };

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
  return { client: { name, kind: input.kind, pan, gstin, email } };
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
    [/llp/, "llp"],
    [/compan|pvt|private limited|ltd|limited/, "company"],
    [/trust|society/, "trust"],
    [/individual|salaried|person/, "individual"],
    [/business|proprietor|partnership|firm|trader|shop/, "business"],
  ];
  return guesses.find(([pattern]) => pattern.test(kind))?.[1] ?? null;
}
