import type { ClientBase } from "pg";
import type { Job, JobStore } from "@/src/jobs/runner";

// The job store on a direct Postgres connection, for tests inside a rolled back
// transaction. The app itself uses apiJobStore.
export function pgJobStore(db: ClientBase): JobStore {
  let writes = Promise.resolve();
  const write = <T>(run: () => Promise<T>) => {
    const next = writes.then(run);
    writes = next.then(() => undefined, () => undefined);
    return next;
  };
  return {
    async claim(batch, leaseSeconds) {
      const result = await db.query<Job>("select * from public.claim_jobs($1, $2)", [
        batch,
        leaseSeconds,
      ]);
      return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
    },
    async markSending(id) {
      const result = await write(() => db.query<{ marked: boolean | null }>("select public.mark_job_sending($1) as marked", [id]));
      return result.rows[0]?.marked === true;
    },
    async finish(id, outcome, errorCode, retryAt) {
      const result = await write(() => outcome === "wait"
        ? db.query<{ finished: boolean | null }>("select public.wait_job($1, $2, $3) as finished", [id, errorCode ?? null, retryAt ?? null])
        : db.query<{ finished: boolean }>("select public.finish_job($1, $2, $3, $4) as finished", [id, outcome, errorCode ?? null, retryAt ?? null]),
      );
      return result.rows[0]?.finished ?? false;
    },
  };
}
