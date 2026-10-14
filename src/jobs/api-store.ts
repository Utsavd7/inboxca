import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import type { JobStore } from "./runner";

// The job store through Supabase's API with the server key, for the /api/jobs worker:
// the server only functions from the jobs migration, with no database password in the app.
// Each call is its own transaction, so a job marked sending stays marked if the worker dies.
export function apiJobStore(supabase: SupabaseClient<Database>): JobStore {
  return {
    async claim(batch, leaseSeconds) {
      const { data, error } = await supabase.rpc("claim_jobs", {
        batch,
        lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`claim_jobs failed: ${error.code}`);
      return data;
    },
    async markSending(id) {
      const { error } = await supabase.rpc("mark_job_sending", { job_id: id });
      if (error) throw new Error(`mark_job_sending failed: ${error.code}`);
    },
    async finish(id, outcome, errorCode, retryAt) {
      const { data, error } = await supabase.rpc("finish_job", {
        job_id: id,
        outcome,
        error_code: errorCode,
        retry_at: retryAt?.toISOString(),
      });
      if (error) throw new Error(`finish_job failed: ${error.code}`);
      return data;
    },
  };
}
