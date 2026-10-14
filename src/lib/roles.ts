// Role names for pages, shared by server pages and the browser form.
export const roleNames: Record<string, string> = {
  owner: "owner",
  partner: "partner",
  manager: "manager",
  staff: "staff",
  front_desk: "front desk",
};

// The roles an owner can give; there is one owner per firm.
export const invitableRoles = ["partner", "manager", "staff", "front_desk"] as const;
export const roleLabel = (role: string) => roleNames[role][0].toUpperCase() + roleNames[role].slice(1);
