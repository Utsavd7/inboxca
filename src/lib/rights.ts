// Who may do what (PLAN.md 5.17.2). Everyone sees every client's documents view only; the
// filing work itself (rename, the yes/no check, marking filed, portal files) is everyone's.
// Uploading other files and sending files to clients are requests for employees and
// managers unless the owner switches them on in Settings → Permissions; removing a file is
// the owner's alone, whatever the settings. Partners follow the manager column.
export const switchable = { upload: "Upload files", send: "Send files to clients", edit_figures: "Edit figures and prepare forms" } as const;
export type Right = keyof typeof switchable | "remove";
export type Column = "employee" | "manager";
export type Permissions = Partial<Record<Column, Partial<Record<keyof typeof switchable, boolean>>>>;

export const columnOf = (role: string): Column | null => (role === "staff" || role === "front_desk" ? "employee" : role === "manager" || role === "partner" ? "manager" : null);

// Whether a role may do it without asking; `always` lists what the owner or a deputy
// always allowed this one person.
export function may(role: string, right: Right, permissions: Permissions = {}, always: string[] = []) {
  if (role === "owner") return true;
  if (right === "remove") return false;
  if (always.includes(right)) return true;
  const column = columnOf(role);
  return !!column && permissions[column]?.[right] === true;
}

// Who answers a request (5.17.2): an employee's everyday request goes to their team's
// manager; removing a file, a manager's or partner's own request, and a request from someone
// with no team manager go to the owner or a deputy.
export function routeOf(right: Right, requester: { role: string; team_id: string | null }, teamManagers: string[]) {
  if (right === "remove" || columnOf(requester.role) !== "employee" || !requester.team_id || !teamManagers.length) return "owner" as const;
  return "manager" as const;
}

// Whether this person may answer: never their own request; the owner or a deputy always;
// a team's manager only for an employee's everyday request routed to them.
export function mayDecide(decider: { id: string; role: string; team_id: string | null; deputy: boolean }, request: { by: string; route: "owner" | "manager"; team_id: string | null }) {
  if (decider.id === request.by) return false;
  if (decider.role === "owner" || decider.deputy) return true;
  return request.route === "manager" && decider.role === "manager" && !!request.team_id && decider.team_id === request.team_id;
}

export const rightWords: Record<Right, string> = { upload: "upload a file", send: "send a file to the client", remove: "remove a file", edit_figures: "edit figures and prepare forms" };
