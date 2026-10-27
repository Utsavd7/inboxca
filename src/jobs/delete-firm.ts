import { log } from "@/src/lib/logger";
import { supabaseAdmin } from "@/src/lib/supabase";
import { workspaceStore } from "@/src/lib/workspace";
import type { Handler } from "./runner";

// Thirty days after the owner closed the firm, its data is deleted; a year later its log
// and the firm itself (PLAN.md 5.5.1, 8.1). The database checks the dates for each step.
export const deleteFirm: Handler = async (job) => {
  const admin = supabaseAdmin(), firm = job.entity_id ?? "", keys: string[] = [];
  // The text read from the firm's papers, sealed in the workspace store (D29), listed before
  // its papers go, a thousand at a time.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("documents").select("key:details->text->>key").eq("firm_id", firm).not("details->text->>key", "is", null).order("id").range(from, from + 999);
    if (error) return { retry: "delete_failed" };
    keys.push(...data.map((row) => row.key));
    if (data.length < 1000) break;
  }
  const { data: deleted, error } = await admin.rpc("delete_firm", { target_firm: firm });
  if (error) return { retry: "delete_failed" };
  // Unreadable once the firm's keys went with its data, but still stored, so removed too. Its
  // safety copies (safety/<firm>/) are locked against removal for 30 days in governance mode,
  // which InboxCA's key cannot lift: they are skipped, and the bucket's rule removes them then.
  const store = workspaceStore();
  let left = 0;
  if (deleted && store) for (const key of keys) await store.remove(key).catch(() => left++);
  if (left) log.warn("firm.text_not_removed", { left });
  return { done: true };
};
