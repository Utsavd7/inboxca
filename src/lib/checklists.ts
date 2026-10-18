import type { WorkType } from "./drive";

// What a firm usually asks a client for, by work (PLAN.md 5.3.1). The client page ticks the
// lists for the work the client's services need; a person adds anything else by name.
export const checklists: Partial<Record<WorkType, string[]>> = {
  gst: ["Sales bills", "Purchase bills", "Bank statement"],
  income_tax: ["Form 16", "Interest certificate", "Capital gains statement", "Investment proofs", "Rent receipts", "Bank statement"],
  tax_audit: ["Trial balance", "Ledger", "Bank statement", "Stock statement", "Fixed asset register"],
};

// The work a service code belongs to, from its first letters: GSTR, CMP and PMT are GST,
// ITR and ADV income tax, TAX_AUDIT the tax audit.
export function workOfService(code: string): WorkType | null {
  if (/^(GSTR|CMP|PMT)/.test(code)) return "gst";
  if (/^(ITR|ADV)/.test(code)) return code === "ITR_AUDIT" ? "tax_audit" : "income_tax";
  if (code === "TAX_AUDIT") return "tax_audit";
  return null;
}

export type RequestItem = { type: string; work: WorkType; received: string[] };
export type DocumentRequest = { period: string; items: RequestItem[]; link_hash: string };
