import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { tdsOnly, type DocumentRequest } from "../checklists";
import { addDays, todayInIndia } from "../calendar";
import { periodName, quarterEnd, tdsRegisters } from "../documents";
import { shortReturn } from "./today";
import type { Desk, DeskWork, Holder } from "../desks";

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
  // Given to this person by name (a notice's owner): shown whoever looks after the client.
  mine?: boolean;
  // The row's words when several say the same for one client: "2 replies to Patel Textiles".
  many?: { title: string; why: string };
  // Waits for papers asked from the client: Today's "Waiting on clients".
  waits?: boolean;
  // A return's chip beside its client: who does it (src/lib/desks.ts, app/(app)/app/desk-chip.tsx).
  desk?: { desks: Desk[]; work: DeskWork; task: { id: string; doer: Holder | null }; viewer: { id: string; assign: boolean; take: boolean } };
};

const times = (count: number) => (count === 2 ? "twice" : `${count} times`);

// Papers from clients (user, 26 Oct 2026), for the clients this person looks after
// (public.paper_items: staff their own, managers their team's, owner and partners every
// client): call a client asked twice with nothing back, and check the figures once every
// paper is in. Each opens the request's own page, which has its actions.
export async function papersWorkItems(ctx: { supabase: SupabaseClient<Database>; membership: { firmId: string; settings?: Record<string, unknown> }; userId: string }): Promise<WorkItem[]> {
  const [{ data: rows }, missingTds] = await Promise.all([ctx.supabase.rpc("paper_items", { target_firm: ctx.membership.firmId }).throwOnError(), tdsMissing(ctx)]);
  const quarters = (rows ?? []).filter((row) => row.kind === "papers_in" && tdsOnly(row.details as unknown as DocumentRequest));
  const registers = quarters.length ? await tdsRegisters(ctx.supabase, ctx.membership.firmId, quarters.map((row) => row.client_id), quarters.map((row) => quarterEnd((row.details as unknown as DocumentRequest).period))) : [];
  const codes = [...new Set((rows ?? []).flatMap((row) => (row.details as unknown as DocumentRequest).returns ?? []))];
  const { data: rules } = codes.length ? await ctx.supabase.from("compliance_types").select("code, name").eq("period_key", "").in("code", codes) : { data: [] };
  const names = new Map(rules?.map((rule) => [rule.code, rule.name]));
  const today = todayInIndia();
  const items = (rows ?? []).map((row): WorkItem => {
    const details = row.details as unknown as DocumentRequest;
    const period = details.period ? ` ${periodName(details.period, ...details.items.map((item) => item.work))}` : "";
    const base = { client: { id: row.client_id, name: row.client_name }, audience: "assigned" as const };
    if (row.kind === "call") {
      const missing = details.items.filter((item) => !item.received.length).map((item) => item.type);
      return { ...base, key: `call:${row.id}`, title: `Papers${period}`, why: `Asked ${times(details.followups?.length ?? 0)}. Call about ${missing.join(", ")}`, waits: true, action: { label: "See papers", href: `/app/papers/${row.id}` } };
    }
    // Every TDS paper of a quarter in: the statement is next. Its button opens the TDS statement page.
    if (tdsOnly(details)) {
      const ready = registers.filter((paper) => paper.client_id === row.client_id && paper.period_key === quarterEnd(details.period)).length;
      return { ...base, key: `tds_in:${row.id}`, title: shortReturn("TDS_RET", quarterEnd(details.period), today), why: `All papers in${ready ? `. ${ready === 1 ? "1 register" : `${ready} registers`} to read` : ""}`, action: { label: "Prepare statement", href: `/app/papers/${row.id}` } };
    }
    const what = details.returns?.length ? details.returns.map((code) => (names.get(code) ?? code).replace(/\s*\(.*\)$/, "")).join(" and ") : details.items.map((item) => item.type).join(", ");
    return { ...base, key: `papers_in:${row.id}`, title: `Papers${period}`, why: `All in. Check the figures for ${what}`, action: { label: "See papers", href: `/app/papers/${row.id}` } };
  });
  const calls = new Set(items.map((item) => item.key.replace(/^call:/, "")));
  return [...items, ...missingTds.filter((item) => !calls.has(item.key.replace(/^tds_missing:/, "")))];
}

// TDS papers asked for a quarter and still missing when its TDS return is close (the firm's days
// before a due date that pin returns, 5 unless Settings says otherwise) or late: one card each.
// A client already to call shows only that.
async function tdsMissing({ supabase, membership }: { supabase: SupabaseClient<Database>; membership: { firmId: string; settings?: Record<string, unknown> } }): Promise<WorkItem[]> {
  const today = todayInIndia();
  const { data: asks } = await supabase.from("requests").select("id, client_id, details, clients!inner(name, archived_at)").eq("firm_id", membership.firmId).eq("kind", "documents").eq("status", "pending")
    .gt("expires_at", new Date().toISOString()).is("clients.archived_at", null).filter("details->items", "cs", JSON.stringify([{ work: "tds" }])).limit(200).throwOnError();
  if (!asks?.length) return [];
  const { data: returns } = await supabase.from("tasks").select("client_id, period_key, due_on").eq("firm_id", membership.firmId).eq("kind", "compliance").eq("code", "TDS_RET").neq("status", "filed")
    .in("client_id", [...new Set(asks.map((ask) => ask.client_id ?? ""))]).lte("due_on", addDays(today, Number(membership.settings?.pin_days ?? 5))).limit(500).throwOnError();
  return asks.flatMap((ask): WorkItem[] => {
    const details = ask.details as unknown as DocumentRequest;
    const missing = details.items.filter((item) => item.work === "tds" && !item.received.length).map((item) => item.type);
    const due = returns?.find((task) => task.client_id === ask.client_id && task.period_key === quarterEnd(details.period))?.due_on;
    if (!missing.length || !due || !ask.client_id) return [];
    return [{
      key: `tds_missing:${ask.id}`, title: shortReturn("TDS_RET", quarterEnd(details.period), today), why: `Missing ${missing.join(", ")}`,
      client: { id: ask.client_id, name: ask.clients.name }, due, urgent: due < today || undefined, waits: true, action: { label: "See papers", href: `/app/papers/${ask.id}` }, audience: "assigned",
    }];
  });
}
