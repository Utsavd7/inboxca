import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgJobStore } from "./pg-store";
import { runDueJobs } from "@/src/jobs/runner";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Most checks roll back. The two worker check commits, because two connections must see
// the same rows, and cleans up after itself by its own key prefix.
const PREFIX = "test-jobs-";
const ENTITY = "00000000-0000-4000-8000-0000000000e1";

let db: Client;
let second: Client;
beforeAll(async () => {
  db = await connect();
  second = await connect();
});
afterEach(async () => {
  await asOwner(db);
  await db.query("delete from public.jobs where idempotency_key like $1", [`${PREFIX}%`]);
});
afterAll(async () => {
  await db.end();
  await second.end();
});

async function add(key: string, fields: Record<string, unknown> = {}) {
  const row = { kind: "test", run_at: new Date(Date.now() - 1000).toISOString(), ...fields };
  const columns = Object.keys(row);
  await db.query(
    `insert into public.jobs (idempotency_key, ${columns.join(", ")})
     values ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})
     on conflict (idempotency_key) do nothing`,
    [`${PREFIX}${key}`, ...Object.values(row)],
  );
}

const states = async () =>
  Object.fromEntries(
    (
      await db.query(
        "select idempotency_key as key, state from public.jobs where idempotency_key like $1",
        [`${PREFIX}%`],
      )
    ).rows.map((row) => [row.key.slice(PREFIX.length), row.state]),
  );

describe("claiming jobs", () => {
  it("claims only what is due, oldest first, up to the batch size", () =>
    rollback(db, async () => {
      // Due long ago, so they come before any job a local demo or another test run has due,
      // which this check leaves alone.
      await add("later", { run_at: new Date(Date.now() + 3600_000).toISOString() });
      await add("old", { run_at: "2000-01-01T00:00:00Z" });
      await add("new", { run_at: "2000-01-02T00:00:00Z" });
      const claimed = await pgJobStore(db).claim(1, 120);
      expect(claimed.map((job) => job.idempotency_key)).toEqual([`${PREFIX}old`]);
      expect(await states()).toEqual({ later: "pending", old: "claimed", new: "pending" });
    }));

  it("never hands the same job to two workers", async () => {
    // Due long ago, so these 30 come first and the two workers, 15 each, share only them,
    // never the jobs a local demo or another test run has due.
    for (let i = 0; i < 30; i++) await add(`pair-${i}`, { run_at: new Date(Date.UTC(2000, 0, 1, 0, 0, i)).toISOString() });
    await Promise.all([db.query("begin"), second.query("begin")]);
    const [a, b] = await Promise.all([
      pgJobStore(db).claim(15, 120),
      pgJobStore(second).claim(15, 120),
    ]);
    await Promise.all([db.query("commit"), second.query("commit")]);
    const ids = [...a, ...b].filter((job) => job.idempotency_key.startsWith(`${PREFIX}pair-`)).map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(30);
  });

  it("keeps one job per idempotency key", () =>
    rollback(db, async () => {
      await add("once");
      await add("once");
      expect(Object.keys(await states())).toEqual(["once"]);
    }));
});

describe("when a worker stops halfway", () => {
  it("puts back a job that had not reached outside, and holds one that might have", () =>
    rollback(db, async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      await add("quiet", { state: "claimed", claimed_until: past });
      await add("sent", { state: "sending", claimed_until: past });
      await pgJobStore(db).claim(0, 120);
      expect(await states()).toEqual({ quiet: "pending", sent: "uncertain" });
    }));
});

describe("finishing jobs", () => {
  it("records done, retry and failure through the runner", () =>
    rollback(db, async () => {
      // Due long ago and one batch of 3 only, so jobs other runs have due are not run.
      for (const kind of ["ok", "again", "unknown"]) await add(kind, { kind, run_at: "2000-01-01T00:00:00Z" });
      let tick = 0;
      const summary = await runDueJobs(pgJobStore(db), {
        ok: async () => ({ done: true }),
        again: async () => ({ retry: "busy" }),
      }, { batch: 3, maxRunMs: 2, clock: () => tick++ });
      expect(summary).toEqual({ claimed: 3, done: 1, retried: 1, failed: 1 });
      expect(await states()).toEqual({ ok: "done", again: "pending", unknown: "failed" });
      const again = await db.query(
        "select run_at > now() as later, last_error_code from public.jobs where idempotency_key = $1",
        [`${PREFIX}again`],
      );
      expect(again.rows[0]).toEqual({ later: true, last_error_code: "busy" });
    }));

  it("refuses to finish a job that is not claimed", () =>
    rollback(db, async () => {
      await add("idle");
      const id = (await db.query("select id from public.jobs where idempotency_key = $1", [`${PREFIX}idle`]))
        .rows[0].id;
      expect(await pgJobStore(db).finish(Number(id), "done")).toBe(false);
    }));
});

describe("cancelling", () => {
  it("cancels only the waiting jobs planned under an older schedule", () =>
    rollback(db, async () => {
      const entity = { entity_type: "task", entity_id: ENTITY };
      await add("v1", { ...entity, schedule_version: 1 });
      await add("v2", { ...entity, schedule_version: 2 });
      const cancelled = await db.query("select public.cancel_jobs('task', $1, 2) as n", [ENTITY]);
      expect(cancelled.rows[0].n).toBe(1);
      expect(await states()).toEqual({ v1: "cancelled", v2: "pending" });
    }));
});

describe("who can reach the jobs", () => {
  it("keeps them from anyone signed in or signed out", () =>
    rollback(db, async () => {
      await add("private");
      for (const user of ["00000000-0000-4000-8000-0000000000a1", null]) {
        await actAs(db, user);
        expect((await attempt(db, "select 1 from public.jobs")).ok).toBe(false);
        expect((await attempt(db, "select * from public.claim_jobs(1, 60)")).ok).toBe(false);
        expect((await attempt(db, "select public.cancel_jobs('task', $1)", [ENTITY])).ok).toBe(false);
      }
    }));

  it("lets the server claim them", () =>
    rollback(db, async () => {
      await add("server");
      await db.query("set local role service_role");
      expect((await attempt(db, "select * from public.claim_jobs(5, 60)")).ok).toBe(true);
    }));
});
