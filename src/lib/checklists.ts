import type { ClientKind } from "./clients";
import type { WorkType } from "./drive";

// What a firm usually asks a client for, by work (PLAN.md 5.3.1). The client page ticks the
// lists for the work the client's services need; a person adds anything else by name.
export const checklists: Partial<Record<WorkType, string[]>> = {
  gst: ["Sales bills", "Purchase bills", "Bank statement"],
  income_tax: ["Form 16", "Interest certificate", "Capital gains statement", "Investment proofs", "Rent receipts", "Bank statement"],
  tax_audit: ["Trial balance", "Ledger", "Bank statement", "Stock statement", "Fixed asset register"],
};

// Practice lists: papers CA firms commonly ask each kind of client for, a place to start.
// They are not official formats or a legal requirement. A firm changes its own in the Ask
// for papers panel (firms.settings.checklists, by kind of client).
export const kindChecklists: Record<ClientKind, string[]> = {
  individual: ["Form 16", "Bank statement", "Interest certificate", "Investment proofs", "Rent receipts", "Capital gains statement", "AIS", "Form 26AS"],
  business: ["Sales bills", "Purchase bills", "Expense bills", "Bank statement", "Loan statement"],
  tax_audit: ["Trial balance", "Ledger", "Bank statement", "Stock statement", "Fixed asset register", "Loan statement"],
  company: ["Trial balance", "Ledger", "Bank statement", "Stock statement", "Fixed asset register", "Loan statement", "Board meeting minutes"],
  llp: ["Trial balance", "Ledger", "Bank statement", "Partner capital accounts", "Loan statement", "LLP agreement"],
  trust: ["Trust deed", "Bank statement", "Donation receipts", "Expense bills", "Interest certificate"],
};

// The firm's list for a kind of client: its own if it changed it, else the practice list.
export const kindChecklist = (settings: Record<string, unknown>, kind: string) =>
  (settings.checklists as Partial<Record<string, string[]>> | undefined)?.[kind] ?? kindChecklists[kind as ClientKind] ?? [];

// The work a service code belongs to, from its first letters: GSTR, CMP and PMT are GST,
// ITR and ADV income tax, TAX_AUDIT the tax audit.
export function workOfService(code: string): WorkType | null {
  if (/^(GSTR|CMP|PMT)/.test(code)) return "gst";
  if (/^(ITR|ADV)/.test(code)) return code === "ITR_AUDIT" ? "tax_audit" : "income_tax";
  if (code === "TAX_AUDIT") return "tax_audit";
  return null;
}

export type RequestItem = { type: string; work: WorkType; received: string[]; checked?: boolean };
export type DocumentRequest = { period: string; items: RequestItem[]; link_hash: string; link_enc?: string; followups?: string[]; registration?: string };
