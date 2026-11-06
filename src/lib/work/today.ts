import { addDays, periodLabel, yearName } from "../calendar";
import { returnOf } from "../return-work";
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
  if (item.mine) return true;
  if (role === "front_desk" && item.area !== "emails" && item.area !== "papers") return false;
  if (item.audience === "firm") return lead || item.area === "gov" || (role === "front_desk" && item.area === "emails");
  if (item.audience === "approver") return lead || role === "manager";
  return lead || !item.client || !!looked?.has(item.client.id);
}

// Rows that say the same for one client become one ("2 replies to Patel Textiles"): the first
// row's key and link, red if any is, and the soonest date.
export function groupRepeats<T extends WorkItem>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.many ? `${item.client?.id}:${item.many.title}:${item.action.label}` : item.key;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((group): T => {
    const [first] = group;
    if (group.length === 1 || !first.many) return first;
    const due = group.flatMap((item) => (item.due ? [item.due] : [])).sort()[0];
    return { ...first, title: `${group.length} ${first.many.title}`, why: first.many.why, urgent: group.some((item) => item.urgent) || undefined, due };
  });
}

// Late or red first, then by due date; something with no date counts as today, unless it is red
// with no date to wait for, which goes first. Each area's own order stays within a day.
export function rankWork<T extends WorkItem>(items: T[], today: string) {
  const first = (item: T) => (item.urgent || (!!item.due && item.due < today) ? 0 : 1);
  const when = (item: T) => item.due ?? (item.urgent ? "" : today);
  return items.map((item, at) => ({ item, at })).sort((a, b) => first(a.item) - first(b.item) || when(a.item).localeCompare(when(b.item)) || a.at - b.at).map(({ item }) => item);
}

// Today's list in four groups, each most urgent first (rankWork): late, due in the next 7 days,
// papers asked from the client and not in, and the rest (emails, approvals, alerts).
export const todayGroups = { late: "Late", week: "Due this week", waits: "Waiting on clients", other: "Other" } as const;
export type TodayGroup = keyof typeof todayGroups;
export const groupOf = (item: WorkItem, today: string): TodayGroup =>
  item.due && item.due < today ? "late" : item.waits ? "waits" : item.due && item.due <= addDays(today, 6) ? "week" : "other";

// Which of a ranked list fit on one screen (most rows in all): one from each group first, then
// the rest in group order.
export function pickShown<T extends WorkItem>(items: T[], today: string, most: number) {
  const groups = (Object.keys(todayGroups) as TodayGroup[]).map((group) => ({ group, items: items.filter((item) => groupOf(item, today) === group) }));
  const take = groups.map(({ items }) => Math.min(items.length, 1));
  for (let room = most - take.reduce((sum, n) => sum + n, 0), at = 0; room > 0 && at < groups.length; at++) {
    const more = Math.min(room, groups[at].items.length - take[at]);
    take[at] += more;
    room -= more;
  }
  return groups.map(({ group, items }, at) => ({ group, count: items.length, items: items.slice(0, take[at]) }));
}

// A return's short name in a row, its client named apart: "GSTR-1 Oct", "TDS Q2", "ITR AY 2026-27"
// (yearName without its FY), the year only when it is not this one. rule: the calendar rule's
// name and frequency, for codes without a short name of their own.
export function shortReturn(code: string, period: string, today: string, rule?: { name: string | null; frequency: string | null }) {
  const tds = /^(TDS|TCS)_RET$/.test(code);
  const name = tds ? code.slice(0, 3) : (returnOf(code) ?? rule?.name?.replace(/\s*\(.*\)$/, "") ?? code);
  const often = rule?.frequency ?? (/_(Q|RET)$/.test(code) ? "quarterly" : /^ITR_/.test(code) ? "yearly" : "monthly");
  if (often === "yearly" || period.length === 4) return `${name} ${yearName(period, /^(ITR|ADV|TAX_AUDIT)/.test(code)).replace(/ \(FY .*\)$/, "")}`;
  // A TDS or TCS quarter of the financial year: Apr to Jun is Q1.
  const fy = (key: string) => Number(key.slice(0, 4)) + (Number(key.slice(5, 7)) > 3 ? 1 : 0);
  if (tds) return `${name} Q${(Number(period.slice(5, 7)) + 9) % 12 / 3 || 4}${fy(period) === fy(today) ? "" : ` ${yearName(String(fy(period)))}`}`;
  const label = periodLabel(often, period, code);
  return `${name} ${period.slice(0, 4) === today.slice(0, 4) ? label.replace(/ \d{4}$/, "") : label}`;
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
