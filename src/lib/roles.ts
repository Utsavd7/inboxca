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
// One line on what each role is in a CA firm, shown where the owner gives a role. What each may
// do exactly is the firm's own choice in Settings (src/lib/rights.ts).
export const roleAbout: Record<(typeof invitableRoles)[number], string> = {
  partner: "A CA partner of the firm. Approves returns, sees the whole firm's work and works from anywhere.",
  manager: "Leads a desk or team. Approves returns and looks after the team's clients and requests.",
  staff: "Prepares and checks returns for the clients given to them.",
  front_desk: "Handles client emails and papers: sorts mail, asks clients for papers and scans. Prepares no returns.",
};

// The pages each role uses. The sidebar shows the four daily places, then a small Workspace
// group with Calendar, Notices, People and Settings. Ctrl K also finds the others, and each
// Settings group by its words, once something is typed.
export const pagesFor = (role: string) => [
  { href: "/app", name: "Today", place: "main" },
  { href: "/app/inbox", name: "Inbox", place: "main" },
  { href: "/app/clients", name: "Clients", place: "main" },
  { href: "/app/documents", name: "Documents", place: "main" },
  { href: "/app/calendar", name: "Calendar", place: "workspace" },
  { href: "/app/notices", name: "Notices", place: "workspace" },
  ...(["owner", "partner", "manager"].includes(role) ? [{ href: "/app/people", name: "People", place: "workspace" }] : []),
  ...(role === "owner" ? [{ href: "/app/settings", name: "Settings", place: "workspace" }] : []),
  { href: "/app/government", name: "From the government", place: "find" },
  { href: "/app/settings?group=me", name: "Your sign in: passkeys", place: "find" },
  ...(role === "owner"
    ? [
        ["email", "Settings: firm email, drive and folders"],
        ["access", "Settings: office only and signing in"],
        ["hours", "Settings: office hours and holidays"],
        ["people", "Settings: permissions and who sees clients"],
        ["reminders", "Settings: reminders, due dates and replies"],
        ["data", "Settings: download your data, close the firm"],
        ["billing", "Settings: billing and plan"],
      ].map(([group, name]) => ({ href: `/app/settings?group=${group}`, name, place: "find" }))
    : []),
  ...(role === "owner" ? [{ href: "/app/import", name: "Add old files", place: "find" }] : []),
];

// A name with its possessive: "Mehta's papers", "Patel Textiles' folders".
export const whose = (name: string) => `${name}${name.endsWith("s") ? "'" : "'s"}`;

// "Ravi" for ravi.shah@firm.in: how messages name a person. The full name Google or Microsoft
// gave at sign in (the signed in person's user metadata) comes first when there is one.
export const personName = (email?: string, full?: unknown) => {
  if (typeof full === "string" && full.trim()) return full.trim().slice(0, 80);
  const name = email?.split("@")[0].split(/[._-]/)[0] || "Someone";
  return name[0].toUpperCase() + name.slice(1);
};
