import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Supabase Cron calls the job worker once a minute through private.call_job_worker().
// pg_net only sends after a commit, so these rolled back checks never reach anything.
const URL = "https://worker.example.test/api/jobs";
const SECRET = "test-only-worker-secret";
const PERSON = "00000000-0000-4000-8000-0000000000f1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// Starts each check from a known state: no stored worker address, nothing due.
async function clean() {
  await asOwner(db);
  await db.query("delete from vault.secrets where name in ('job_worker_url', 'job_worker_secret')");
  await db.query("update public.jobs set state = 'cancelled' where state in ('pending', 'claimed', 'sending')");
}
const store = () =>
  db.query(
    "select vault.create_secret($1, 'job_worker_url'), vault.create_secret($2, 'job_worker_secret')",
    [URL, SECRET],
  );
const due = () =>
  db.query(
    "insert into public.jobs (kind, idempotency_key, run_at) values ('test', 'test-sweep-1', now() - interval '1 second')",
  );
const calls = async () => {
  await db.query("select private.call_job_worker()");
  return (
    await db.query("select headers from net.http_request_queue where url = $1", [URL])
  ).rows;
};

describe("the schedule that calls the job worker", () => {
  it("calls nothing until the worker's address and secret are stored", () =>
    rollback(db, async () => {
      await clean();
      await due();
      expect(await calls()).toHaveLength(0);
    }));

  it("calls nothing while no job is due, so an idle app is never woken", () =>
    rollback(db, async () => {
      await clean();
      await store();
      await db.query(
        "insert into public.jobs (kind, idempotency_key, run_at) values ('test', 'test-sweep-later', now() + interval '1 hour')",
      );
      expect(await calls()).toHaveLength(0);
    }));

  it("calls the worker with its secret when a job is due", () =>
    rollback(db, async () => {
      await clean();
      await store();
      await due();
      const sent = await calls();
      expect(sent).toHaveLength(1);
      expect(sent[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
    }));

  it("also calls when a claimed job's lease has run out", () =>
    rollback(db, async () => {
      await clean();
      await store();
      await db.query(
        "insert into public.jobs (kind, idempotency_key, state, claimed_until) values ('test', 'test-sweep-lease', 'claimed', now() - interval '1 second')",
      );
      expect(await calls()).toHaveLength(1);
    }));

  it("can be run by the schedule only", () =>
    rollback(db, async () => {
      await clean();
      await actAs(db, PERSON);
      expect((await attempt(db, "select private.call_job_worker()")).ok).toBe(false);
      await asOwner(db);
      await db.query("set local role service_role");
      expect((await attempt(db, "select private.call_job_worker()")).ok).toBe(false);
    }));
});
