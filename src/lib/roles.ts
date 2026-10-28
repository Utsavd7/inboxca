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

// The pages each role uses. The sidebar shows the four daily places, then a small Workspace
// group with Calendar, Notices, People and Settings.
export const pagesFor = (role: string) => [
  { href: "/app", name: "Today", place: "main" },
  { href: "/app/inbox", name: "Inbox", place: "main" },
  { href: "/app/clients", name: "Clients", place: "main" },
  { href: "/app/documents", name: "Documents", place: "main" },
  { href: "/app/calendar", name: "Calendar", place: "workspace" },
  { href: "/app/notices", name: "Notices", place: "workspace" },
  ...(["owner", "partner", "manager"].includes(role) ? [{ href: "/app/people", name: "People", place: "workspace" }] : []),
  ...(role === "owner" ? [{ href: "/app/settings", name: "Settings", place: "workspace" }] : []),
];

// "Ravi" for ravi.shah@firm.in: how messages name a person. The full name Google or Microsoft
// gave at sign in (the signed in person's user metadata) comes first when there is one.
export const personName = (email?: string, full?: unknown) => {
  if (typeof full === "string" && full.trim()) return full.trim().slice(0, 80);
  const name = email?.split("@")[0].split(/[._-]/)[0] || "Someone";
  return name[0].toUpperCase() + name.slice(1);
};
