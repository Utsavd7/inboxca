import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localSupabase } from "../local-env";
import { pgJobStore } from "./pg-store";
import { MAX_ATTEMPTS, runDueJobs, type Job, type Outcome } from "@/src/jobs/runner";
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
  it("puts back a job that had not reached outside, fails one that might have or keeps stopping the worker, and tells the admins", () =>
    rollback(db, async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      await add("quiet", { state: "claimed", claimed_until: past });
      await add("sent", { state: "sending", claimed_until: past });
      await add("again", { state: "claimed", claimed_until: past, attempts: 5, last_error_code: "lease_expired" });
      await pgJobStore(db).claim(0, 120);
      expect(await states()).toEqual({ quiet: "pending", sent: "failed", again: "failed" });
      const codes = await db.query("select idempotency_key as key, last_error_code as code from public.jobs where idempotency_key like $1 order by 1", [`${PREFIX}%`]);
      expect(codes.rows.map((row) => row.code)).toEqual(["lease_expired", "lease_expired", "uncertain"]);
      expect((await db.query("select state from public.jobs where idempotency_key = 'jobs_stopped:' || (now() at time zone 'Asia/Kolkata')::date")).rows).toHaveLength(1);
    }));
});

describe("waiting until a set time", () => {
  it("uses no try, so a job that waited many times still has its tries for a failure", () =>
    rollback(db, async () => {
      await add("waits", { kind: "waits", run_at: "2000-01-01T00:00:00Z" });
      let outcome: Outcome = { retry: "quiet_hours", at: new Date("2000-01-01T00:00:00Z") };
      let tick = 0;
      const sweep = () => runDueJobs(pgJobStore(db), { waits: async () => outcome }, { concurrency: 1, maxRunMs: 2, clock: () => tick++ });
      for (let wait = 0; wait < MAX_ATTEMPTS + 2; wait++) await sweep();
      outcome = { retry: "busy" };
      await sweep();
      expect((await db.query("select state, attempts from public.jobs where idempotency_key = $1", [`${PREFIX}waits`])).rows[0]).toEqual({ state: "pending", attempts: 1 });
    }));
});

// The system mail is a fake that keeps who it emailed, and can stop the worker at a given email.
const mailed = vi.hoisted(() => ({ to: [] as string[], stopAt: 0 }));
vi.mock("@/src/lib/system-mail", () => ({
  systemMailReady: () => true,
  sendSystemMail: async (to: string) => {
    if (mailed.to.length + 1 === mailed.stopAt) throw new Error("worker stopped");
    mailed.to.push(to);
    return true;
  },
}));

describe("a send to several people that stops part way", () => {
  it("emails, when it runs again, only those who did not get it", async () => {
    const local = localSupabase();
    vi.stubEnv("SUPABASE_URL", local.url);
    vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
    const { supabaseAdmin } = await import("@/src/lib/supabase");
    const { outageEmail } = await import("@/src/jobs/outage-email");
    const tag = randomUUID().slice(0, 8);
    const owners = await Promise.all([1, 2, 3].map(async (n) => (await supabaseAdmin().auth.admin.createUser({ email: `outage-${n}-${tag}@example.test`, email_confirm: true })).data.user!.id));
    const firm = (await db.query("insert into public.firms (name, state_code, status) values ($1, '27', 'active') returning id", [`Outage Test ${tag}`])).rows[0].id;
    const incident = (await db.query("insert into public.incidents (title, parts, level) values ($1, '{mail}', 'slow') returning id", [`Invented outage ${tag}`])).rows[0].id;
    try {
      for (const owner of owners) await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [firm, owner]);
      const job = { id: 1, firm_id: firm, entity_type: "incident", entity_id: incident } as Job;
      mailed.stopAt = 3;
      await expect(outageEmail(job, { markSending: async () => {} })).rejects.toThrow("worker stopped");
      expect(mailed.to).toHaveLength(2);
      mailed.stopAt = 0;
      expect(await outageEmail(job, { markSending: async () => {} })).toEqual({ done: true });
      expect(mailed.to).toHaveLength(3);
      expect(new Set(mailed.to)).toEqual(new Set([1, 2, 3].map((n) => `outage-${n}-${tag}@example.test`)));
    } finally {
      await db.query("delete from public.incidents where id = $1", [incident]);
      await db.query("with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where id = $1 and exists (select 1 from gone)", [firm]);
      for (const owner of owners) await supabaseAdmin().auth.admin.deleteUser(owner);
      vi.unstubAllEnvs();
    }
  });
});

describe("finishing jobs", () => {
  it("records done, retry and failure through the runner", () =>
    rollback(db, async () => {
      // Due long ago and one batch of 4 only, so jobs other runs have due are not run.
      for (const kind of ["ok", "left", "again", "unknown"]) await add(kind, { kind, run_at: "2000-01-01T00:00:00Z" });
      let tick = 0;
      const summary = await runDueJobs(pgJobStore(db), {
        ok: async () => ({ done: true }),
        left: async () => ({ done: true, reason: "details" }),
        again: async () => ({ retry: "busy" }),
      }, { concurrency: 4, maxRunMs: 2, clock: () => tick++ });
      expect(summary).toEqual({ claimed: 4, done: 2, retried: 1, failed: 1 });
      expect(await states()).toEqual({ ok: "done", left: "done", again: "pending", unknown: "failed" });
      // A job done with a reason (a return left for a person) keeps it; one done without keeps none.
      const done = await db.query("select idempotency_key as key, last_error_code from public.jobs where idempotency_key = any($1) order by 1", [[`${PREFIX}left`, `${PREFIX}ok`]]);
      expect(done.rows.map((row) => row.last_error_code)).toEqual(["details", null]);
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
