// Who may do what (PLAN.md 5.17.2). Everyone sees every client's documents view only; the
// filing work itself (rename, the yes/no check, marking filed, portal files) is everyone's.
// Uploading other files and sending files to clients are requests for employees and
// managers unless the owner switches them on in Settings → Permissions; removing a file is
// the owner's alone, whatever the settings. Partners follow the manager column.
export const switchable = { upload: "Upload papers", send: "Send papers to clients", edit_figures: "Edit figures and prepare returns", download: "Download papers one at a time, with their email on each page", rename: "Correct a paper's type or period", portal_files: "Add portal files", check_figures: "Check extracted figures", mark_filed: "Mark returns filed", approve_requests: "Approve the team's permission requests" } as const;
export type Right = keyof typeof switchable | "remove";
export type Column = "employee" | "manager";
export type Scope = {clients?: string[]; until?: string};
export type Standing = string | (Scope & {right: keyof typeof switchable});
export type Permissions = Partial<Record<Column, Partial<Record<keyof typeof switchable, boolean>> & {scope?:Scope}>>;
export const defaults = {rename:true,portal_files:true,check_figures:true,mark_filed:true};
export const todayInIndia = (at = Date.now()) => new Date(at + 330 * 60_000).toISOString().slice(0,10);

export function inScope(scope:Scope,client?:string,today=todayInIndia()) {
  return (!scope.until || /^20\d{2}-\d{2}-\d{2}$/.test(scope.until) && scope.until>=today) && (!scope.clients || scope.clients.length>0 && !!client && scope.clients.includes(client));
}

export const columnOf = (role: string): Column | null => (role === "staff" || role === "front_desk" ? "employee" : role === "manager" || role === "partner" ? "manager" : null);

// Whether a role may do it without asking; `always` lists what the owner or a deputy
// always allowed this one person.
export function may(role: string, right: Right, permissions: Permissions = {}, always: Standing[] = [], client?:string, today=todayInIndia()) {
  if (role === "owner") return true;
  if (right === "remove") return false;
  const column = columnOf(role);
  if(right==="approve_requests" && column!=="manager") return false;
  if (always.some(grant=>typeof grant==="string" ? grant===right : grant && grant.right===right && inScope(grant,client,today))) return true;
  if(!column) return false;
  const value=permissions[column]?.[right] ?? (right in defaults || right==="approve_requests");
  return value && inScope(permissions[column]?.scope ?? {},client,today);
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
  return request.route === "manager" && ["manager","partner"].includes(decider.role) && !!request.team_id && decider.team_id === request.team_id;
}

export const rightWords: Record<Right, string> = { upload: "upload a paper", send: "send a paper to the client", remove: "remove a paper", edit_figures: "edit figures and prepare returns", download:"download a paper", rename:"correct a paper's type or period", portal_files:"add portal files", check_figures:"check extracted figures", mark_filed:"mark returns filed", approve_requests:"approve the team's permission requests" };
