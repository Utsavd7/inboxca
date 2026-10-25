import { cache } from "react";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// What the frame and Today both read, once a request: the firm's mailbox and drive.
export const firmAccounts = cache(async () => {
  const { supabase, membership } = await currentMember();
  if (!membership) return [];
  const { data } = await supabase.from("connected_accounts").select("kind, status").eq("firm_id", membership.firmId);
  return data ?? [];
});

// The owner's returns this financial year (April to March), from the usage ledger: all of
// them, and those due so far. Two counts on the ledger's (firm, due date) index.
export const returnsThisYear = cache(async (firm: string, today: string) => {
  const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  const ledger = () => supabaseAdmin().from("usage_ledger").select("due_on", { count: "exact", head: true }).eq("firm_id", firm).is("bytes", null).gte("due_on", `${year}-04-01`);
  const [all, due] = await Promise.all([ledger().lt("due_on", `${year + 1}-04-01`), ledger().lte("due_on", today)]);
  return { all: all.count ?? 0, due: due.count ?? 0 };
});
