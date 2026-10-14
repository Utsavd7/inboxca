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

// Who may add and change clients; staff view only (PLAN.md 5.17.2).
export const canManageClients = (role: string) => ["owner", "partner", "manager"].includes(role);
