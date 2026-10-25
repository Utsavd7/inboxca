import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import type { Job, JobStore } from "./runner";

// The job store through Supabase's API with the server key, for the /api/jobs worker:
// the server only functions from the jobs migration, with no database password in the app.
// Each call is its own transaction, so a job marked sending stays marked if the worker dies.
export function apiJobStore(supabase: SupabaseClient<Database>): JobStore {
  return {
    async claim(batch, leaseSeconds) {
      const testRun = process.env.JOB_FIRMS_TEST;
      if (testRun) return claimTestJobs(supabase, testRun, batch, leaseSeconds);
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

// Test servers only (JOB_FIRMS_TEST, never set in a deployment): claim just the due jobs of
// firms this run's tests made, so runs sharing one database never run each other's (or the
// demo firm's) jobs. claim_jobs with a batch of 0 still frees expired leases; each claim is
// a conditional update, so two workers never take the same job.
async function claimTestJobs(supabase: SupabaseClient<Database>, testRun: string, batch: number, leaseSeconds: number) {
  await supabase.rpc("claim_jobs", { batch: 0, lease_seconds: leaseSeconds });
  const { data: firms } = await supabase.from("firms").select("id").eq("settings->>test_run", testRun);
  // "now" is Postgres's own word for the current time, so "due" is by the database's clock,
  // as in claim_jobs; this machine's clock can be a little behind the database container's.
  const { data: due, error } = await supabase.from("jobs").select("id, attempts").eq("state", "pending").lte("run_at", "now")
    .in("firm_id", (firms ?? []).map((firm) => firm.id)).order("run_at").limit(batch);
  if (error) throw new Error(`claim failed: ${error.code}`);
  const jobs: Job[] = [];
  for (const { id, attempts } of due) {
    const { data } = await supabase.from("jobs").update({ state: "claimed", claimed_until: new Date(Date.now() + leaseSeconds * 1000).toISOString(), attempts: attempts + 1 })
      .match({ id, state: "pending", attempts }).select().maybeSingle();
    if (data) jobs.push(data);
  }
  return jobs;
}
