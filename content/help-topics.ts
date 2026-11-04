// The Help centre's groups, small enough for the header's Help menu; the articles themselves are
// in help.ts and stay on the server.
export const helpTopics = [
  { id: "start", title: "Getting started", line: "Sign up, connect your email and drive, add clients" },
  { id: "papers", title: "Papers and clients", line: "How papers arrive, To check, asking clients for papers" },
  { id: "returns", title: "Returns and notices", line: "Due dates, GST month end, ITR and notices" },
  { id: "team", title: "Your team and signing in", line: "Roles, office only access, passkeys" },
  { id: "billing", title: "Plans and billing", line: "Plans, extra people, money back" },
] as const;
