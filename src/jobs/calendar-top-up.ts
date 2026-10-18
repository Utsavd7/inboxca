import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Top up one firm's returns after the nightly cron has queued each firm separately.
export const calendarTopUp: Handler = async (job) => {
  if (!job.firm_id) return { fail: "missing_firm" };
  const { error } = await supabaseAdmin().rpc("calendar_top_up", { target_firm: job.firm_id });
  return error ? { retry: "calendar_top_up_failed" } : { done: true };
};
