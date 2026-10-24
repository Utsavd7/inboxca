import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Thirty days after the owner closed the firm, everything InboxCA keeps for it is deleted
// (PLAN.md 5.5.1). The database checks the firm is closed and the 30 days have passed.
export const deleteFirm: Handler = async (job) => {
  const { error } = await supabaseAdmin().rpc("delete_firm", { target_firm: job.entity_id ?? "" });
  return error ? { retry: "delete_failed" } : { done: true };
};
