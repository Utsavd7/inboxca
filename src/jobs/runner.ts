import { reportError } from "@/src/lib/error-report";
import { log } from "@/src/lib/logger";
import type { Database } from "@/src/db/types";

// One claimed job, as the database hands it to a worker.
export type Job = Database["public"]["Tables"]["jobs"]["Row"];

// What a handler reports. Codes are short machine words, never content.
export type Outcome =
  | { done: true; reason?: string } // finished; with a reason code when it left the work for a person
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

const entityKey = (job: Job) => job.entity_type && job.entity_id ? `${job.entity_type}:${job.entity_id}` : null;

// One sweep: keep claiming due work for about 45 seconds. Five workers run different
// entities together, while jobs for one entity stay in order.
export async function runDueJobs(
  store: JobStore,
  handlers: Record<string, Handler>,
  { batch = 20, leaseSeconds = 120, concurrency = 5, maxRunMs = 45_000, now = () => new Date(), clock = Date.now } = {},
): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, done: 0, retried: 0, failed: 0 };
  const started = clock();
  const run = async (job: Job) => {
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
      await store.finish(job.id, "done", outcome.reason);
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
  };

  while (clock() - started < maxRunMs) {
    const jobs = await store.claim(batch, leaseSeconds);
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    const waiting = [...jobs];
    const active = new Set<string>();
    const worker = async () => {
      while (waiting.length) {
        const at = waiting.findIndex((job) => !entityKey(job) || !active.has(entityKey(job)!));
        if (at < 0) return;
        const [job] = waiting.splice(at, 1);
        const key = entityKey(job);
        if (key) active.add(key);
        await run(job);
        if (key) active.delete(key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  }
  return summary;
}
