import { cache } from "react";
import { sources, type Area } from "@/src/jobs/forms-watch";
import { dueLabel, periodLabel } from "@/src/lib/calendar";
import type { currentMember } from "@/src/lib/member";

// What is new from the government for a firm (PLAN.md D42): items the daily check found on the
// official listing pages in the last 14 days, only in the firm's work areas (from its clients'
// services), each marked dismissed for this person or not, newest first. Titles are the
// government's own words; the admin's one line is Orelu's.
type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];
export type GovUpdate = { id: string; source: string; area: Area; title: string; date?: string; link: string; seen: string; note?: { uses?: string; keeps?: string }; dismissed: boolean; from: string; moved?: string[] };
const names = new Map(sources.map((source) => [source.key, source.name]));

// Read once a request: Today's line and its list both ask.
export const governmentUpdates = cache(async (supabase: Db, firmId: string) => {
  const [{ data, error }, { data: rules }, { data: extensions }] = await Promise.all([
    supabase.rpc("gov_updates", { target_firm: firmId }),
    supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""),
    // The due dates the Sunday check moved from a notice, named under the notice itself.
    supabase.from("compliance_types").select("code, period_key, due_rule, source_url").neq("period_key", "").not("verified_on", "is", null).not("due_rule->notice", "is", null),
  ]);
  if (error) throw new Error(`Government updates failed: ${error.code}`);
  const found = data as { areas: Area[]; failing: string[]; items: Omit<GovUpdate, "from">[] };
  const moved = (link: string) => (extensions ?? []).filter((row) => row.source_url === link).map((row) => {
    const rule = rules?.find((rule) => rule.code === row.code);
    return `${rule?.name ?? row.code} for ${periodLabel(rule?.frequency ?? null, row.period_key, row.code)} to ${dueLabel((row.due_rule as { on: string }).on)}`;
  });
  return {
    items: found.items.map((item): GovUpdate => ({ ...item, from: names.get(item.source) ?? "An official site", ...(moved(item.link).length ? { moved: moved(item.link) } : {}) })),
    // The official pages InboxCA cannot read for these areas, for people to look at themselves:
    // those that block readers, and any the check has not read for two days.
    unread: sources.filter((source) => (source.kind === "manual" || found.failing.includes(source.key)) && found.areas.includes(source.area)),
  };
});

// "12 Oct 2026" as published, or the day InboxCA first saw it.
export const govWhen = (item: GovUpdate) => (item.date ? dueLabel(item.date) : `seen on ${dueLabel(item.seen)}`);
export const govNote = (item: GovUpdate) =>
  item.moved ? `Extended by this notice: InboxCA moved ${item.moved.join(", and ")} for every firm.` : item.note?.uses ? `InboxCA uses this from ${dueLabel(item.note.uses)}.` : item.note?.keeps ? `InboxCA keeps the earlier version for ${item.note.keeps}.` : null;
// The title as published, ended with a full stop only when it has none.
export const govTitle = (item: GovUpdate) => (/[.!?]$/.test(item.title) ? item.title : `${item.title}.`);

// For Today's single list: each item this person has not dismissed, for everyone in the firm.
export type WorkItem = {
  key: string;
  title: string;
  why: string;
  client?: { id: string; name: string };
  due?: string;
  urgent?: boolean;
  action: { label: string; href: string };
  audience: "assigned" | "approver" | "firm";
};
export async function governmentWorkItems({ supabase, membership }: { supabase: Db; membership: { firmId: string } }): Promise<WorkItem[]> {
  const { items } = await governmentUpdates(supabase, membership.firmId);
  return items
    .filter((item) => !item.dismissed)
    .map((item) => ({ key: `gov:${item.id}`, title: govTitle(item), why: [`New from the government. ${item.from}, ${govWhen(item)}.`, govNote(item)].filter(Boolean).join(" "), action: { label: "Open", href: item.link }, audience: "firm" }));
}
