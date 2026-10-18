import { reportError } from "@/src/lib/error-report";
import { log } from "@/src/lib/logger";
import type { Database } from "@/src/db/types";

// One claimed job, as the database hands it to a worker.
export type Job = Database["public"]["Tables"]["jobs"]["Row"];

// What a handler reports. Codes are short machine words, never content.
export type Outcome =
  | { done: true }
  | { retry: string; patient?: boolean; at?: Date } // try again later, with this reason code; patient when the other side is away; at a set time
  | { fail: string }; // give up, with this reason code

export type Handler = (
  job: Job,
  tools: {
    // Call right before reaching outside (email, drive, AI). If the worker dies after
    // this, the job becomes uncertain and is checked, never blindly repeated.
    markSending: () => Promise<void>;
  },
) => Promise<Outcome>;

// Where jobs live. The database version calls the claim_jobs, mark_job_sending and
// finish_job functions; tests use an in-memory one.
export interface JobStore {
  claim(batch: number, leaseSeconds: number): Promise<Job[]>;
  markSending(id: number): Promise<void>;
  finish(
    id: number,
    outcome: "done" | "retry" | "failed",
    errorCode?: string,
    retryAt?: Date,
  ): Promise<boolean>;
}

export const MAX_ATTEMPTS = 5;
// A patient job (the firm's drive is away, say) is tried every hour for 7 days.
export const PATIENT_ATTEMPTS = 7 * 24;

// 1, 2, 4, 8 minutes between tries, never more than an hour.
export function retryDelaySeconds(attempt: number) {
  return Math.min(60 * 2 ** Math.max(attempt - 1, 0), 3600);
}

export type RunSummary = { claimed: number; done: number; retried: number; failed: number };

// One sweep: claim what is due, run each job's handler, record the result.
export async function runDueJobs(
  store: JobStore,
  handlers: Record<string, Handler>,
  { batch = 20, leaseSeconds = 120, now = () => new Date() } = {},
): Promise<RunSummary> {
  const jobs = await store.claim(batch, leaseSeconds);
  const summary: RunSummary = { claimed: jobs.length, done: 0, retried: 0, failed: 0 };
  for (const job of jobs) {
    const handler = handlers[job.kind];
    let outcome: Outcome;
    if (!handler) outcome = { fail: "no_handler" };
    else {
      try {
        outcome = await handler(job, { markSending: () => store.markSending(job.id) });
      } catch (error) {
        // The message may hold client details, so only its type is kept.
        log.error("job.threw", { jobId: job.id, kind: job.kind, error: (error as Error).name });
        await reportError(error, { route: "job", kind: job.kind });
        outcome = { retry: "exception" };
      }
    }
    if ("done" in outcome) {
      await store.finish(job.id, "done");
      summary.done++;
    } else if ("retry" in outcome && (outcome.at || job.attempts < (outcome.patient ? PATIENT_ATTEMPTS : MAX_ATTEMPTS))) {
      // A set time (the end of quiet hours, say) is not a failure, so it uses no try.
      const at = outcome.at ?? new Date(now().getTime() + (outcome.patient ? 3600 : retryDelaySeconds(job.attempts)) * 1000);
      await store.finish(job.id, "retry", outcome.retry, at);
      summary.retried++;
    } else {
      const code = "retry" in outcome ? outcome.retry : outcome.fail;
      await store.finish(job.id, "failed", code);
      log.warn("job.failed", { jobId: job.id, kind: job.kind, code, attempts: job.attempts });
      summary.failed++;
    }
  }
  return summary;
}
