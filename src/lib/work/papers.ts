import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import type { DocumentRequest } from "../checklists";
import { periodName } from "../documents";

// One thing someone has to do, for Today's single list (the work item contract, 26 Oct 2026).
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

const times = (count: number) => (count === 2 ? "twice" : `${count} times`);

// Papers from clients (user, 26 Oct 2026), for the clients this person looks after
// (public.paper_items: staff their own, managers their team's, owner and partners every
// client): call a client asked twice with nothing back, and check the figures once every
// paper is in. Each opens the request's own page, which has its actions.
export async function papersWorkItems(ctx: { supabase: SupabaseClient<Database>; membership: { firmId: string }; userId: string }): Promise<WorkItem[]> {
  const { data: rows } = await ctx.supabase.rpc("paper_items", { target_firm: ctx.membership.firmId });
  const codes = [...new Set((rows ?? []).flatMap((row) => (row.details as unknown as DocumentRequest).returns ?? []))];
  const { data: rules } = codes.length ? await ctx.supabase.from("compliance_types").select("code, name").eq("period_key", "").in("code", codes) : { data: [] };
  const names = new Map(rules?.map((rule) => [rule.code, rule.name]));
  return (rows ?? []).map((row): WorkItem => {
    const details = row.details as unknown as DocumentRequest;
    const period = details.period ? ` for ${periodName(details.period)}` : "";
    const base = { client: { id: row.client_id, name: row.client_name }, audience: "assigned" as const };
    if (row.kind === "call") {
      const missing = details.items.filter((item) => !item.received.length).map((item) => item.type);
      return { ...base, key: `call:${row.id}`, title: `Call ${row.client_name}`, why: `Asked ${times(details.followups?.length ?? 0)}, still missing ${missing.join(", ")}${period}`, action: { label: "See papers", href: `/app/papers/${row.id}` } };
    }
    const what = details.returns?.length ? details.returns.map((code) => names.get(code) ?? code).join(" and ") : details.items.map((item) => item.type).join(", ");
    return { ...base, key: `papers_in:${row.id}`, title: `All papers in for ${row.client_name}`, why: `Check the figures for ${what}${period}`, action: { label: "See papers", href: `/app/papers/${row.id}` } };
  });
}
