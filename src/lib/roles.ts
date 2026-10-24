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

// The pages each role uses. The rail shows the four daily places, with People and Settings
// at its foot; Calendar and Notices are reached from Today, each client and search.
export const pagesFor = (role: string) => [
  { href: "/app", name: "Today", place: "main" },
  { href: "/app/inbox", name: "Inbox", place: "main" },
  { href: "/app/clients", name: "Clients", place: "main" },
  { href: "/app/calendar", name: "Calendar", place: "search" },
  { href: "/app/notices", name: "Notices", place: "search" },
  ...(["owner", "partner", "manager"].includes(role) ? [{ href: "/app/people", name: "People", place: "foot" }] : []),
  ...(role === "owner" ? [{ href: "/app/settings", name: "Settings", place: "foot" }] : []),
];

// "Ravi" for ravi.shah@firm.in: how messages name a person.
export const personName = (email?: string) => {
  const name = email?.split("@")[0].split(/[._-]/)[0] || "Someone";
  return name[0].toUpperCase() + name.slice(1);
};
