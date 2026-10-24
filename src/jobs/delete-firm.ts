import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Thirty days after the owner closed the firm, its data is deleted; a year later its log
// and the firm itself (PLAN.md 5.5.1, 8.1). The database checks the dates for each step.
export const deleteFirm: Handler = async (job) => {
  const { error } = await supabaseAdmin().rpc("delete_firm", { target_firm: job.entity_id ?? "" });
  return error ? { retry: "delete_failed" } : { done: true };
};
