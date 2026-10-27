import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { todayInIndia } from "../calendar";
import { periodName } from "../documents";
import type { Counts } from "../purchase-register";

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

const bills = (count: number, words: string) => `${count} ${count === 1 ? "bill" : "bills"} ${words}`;

// GSTR-2B against the purchase register, for the clients this person looks after
// (public.gst_match_items, read as them): a month whose bills differ from GSTR-2B or whose
// corrected bills the books do not show yet, until its
// GSTR-3B is filed, due on the GSTR-3B's date and red in its last 3 days or once late. The CA
// decides what to claim; the button opens the lists on the client's Figures.
export async function gstMatchWorkItems(ctx: { supabase: SupabaseClient<Database>; membership: { firmId: string }; userId?: string }): Promise<WorkItem[]> {
  const { data: rows } = await ctx.supabase.rpc("gst_match_items", { target_firm: ctx.membership.firmId });
  const soon = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  return (rows ?? []).map((row): WorkItem => {
    const counts = row.counts as unknown as Counts;
    const why = [counts.missing && bills(counts.missing, "not in GSTR-2B"), counts.extra && bills(counts.extra, "in GSTR-2B but not in the books"), counts.differ && bills(counts.differ, counts.differ === 1 ? "with a different amount" : "with different amounts"), counts.changed && bills(counts.changed, "corrected by the supplier")].filter(Boolean).join(", ");
    return {
      key: `gst_match:${row.register_id}`, title: `Check GSTR-2B for ${row.client_name}`, why: `${periodName(row.period_key)}: ${why}`,
      client: { id: row.client_id, name: row.client_name }, due: row.due_on, urgent: row.due_on <= soon,
      action: { label: "See differences", href: `/app/clients/${row.client_id}?tab=extraction&purchases=${row.register_id}#gst-match` }, audience: "assigned",
    };
  });
}
