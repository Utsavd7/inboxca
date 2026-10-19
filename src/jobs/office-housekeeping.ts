import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Remove unused office connections once a day, one firm at a time.
export const officeHousekeeping: Handler = async (job) => {
  if (!job.firm_id) return { fail: "missing_firm" };
  const { error } = await supabaseAdmin().rpc("office_housekeeping", { target_firm: job.firm_id });
  return error ? { retry: "office_housekeeping_failed" } : { done: true };
};
