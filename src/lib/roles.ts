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

// The pages each role uses: staff and front desk their work; managers and partners also the
// firm's people; the owner also Settings.
export const pagesFor = (role: string) => [
  { href: "/app", name: "Home" },
  { href: "/app/inbox", name: "Inbox" },
  { href: "/app/clients", name: "Clients" },
  { href: "/app/calendar", name: "Calendar" },
  { href: "/app/notices", name: "Notices" },
  ...(["owner", "partner", "manager"].includes(role) ? [{ href: "/app/people", name: "People" }] : []),
  ...(role === "owner" ? [{ href: "/app/settings", name: "Settings" }] : []),
];
