import type { WorkItem } from "./papers";

// Today by role (PLAN.md "Today by role"): every area's work items in one list for one person,
// most urgent first, and the full list's filters. Pure, so the order and who sees what are
// tested on their own (tests/unit/work-today.test.ts).
export type Area = "papers" | "returns" | "emails" | "gov" | "firm";
export type Listed = WorkItem & { area: Area };
export type Viewer = { role: string; looked: Set<string> | null };

export const isLead = (role: string) => role === "owner" || role === "partner";

// The contract's audience, by role: the owner and partners see the whole firm; a manager also
// whatever waits for an approver; anyone else the clients they look after (looked: from
// public.looked_after; null for a lead). Front desk sees emails and papers only, and also the
// emails no one client is named in, as the team's reply queue is theirs. Government updates are
// for everyone.
export function visibleTo(item: Listed, { role, looked }: Viewer) {
  const lead = isLead(role);
  if (role === "front_desk" && item.area !== "emails" && item.area !== "papers") return false;
  if (item.audience === "firm") return lead || item.area === "gov" || (role === "front_desk" && item.area === "emails");
  if (item.audience === "approver") return lead || role === "manager";
  return lead || !item.client || !!looked?.has(item.client.id);
}

// Late or red first, then by due date; something with no date counts as today, unless it is red
// with no date to wait for, which goes first. Each area's own order stays within a day.
export function rankWork<T extends WorkItem>(items: T[], today: string) {
  const first = (item: T) => (item.urgent || (!!item.due && item.due < today) ? 0 : 1);
  const when = (item: T) => item.due ?? (item.urgent ? "" : today);
  return items.map((item, at) => ({ item, at })).sort((a, b) => first(a.item) - first(b.item) || when(a.item).localeCompare(when(b.item)) || a.at - b.at).map(({ item }) => item);
}

// The full list's filters (/app/work). Mine: the clients assigned to this person or their team
// by name, and their own permission requests.
export const workFilters = { all: "All", mine: "Mine", late: "Late", approvals: "Approvals", papers: "Papers", returns: "Returns", emails: "Emails" } as const;
export type WorkFilter = keyof typeof workFilters;
export function inFilter(item: Listed, show: WorkFilter, today: string, mine: Set<string>) {
  if (show === "mine") return item.client ? mine.has(item.client.id) : item.key === "questions";
  if (show === "late") return !!item.due && item.due < today;
  if (show === "approvals") return item.audience === "approver";
  if (show === "papers" || show === "returns" || show === "emails") return item.area === show;
  return true;
}
