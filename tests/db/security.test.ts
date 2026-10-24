import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "./db";

// The security pass (PLAN.md 8.2, 8.5): rules that every new table, function and job must keep.
let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const names = async (sql: string) => (await db.query(sql)).rows.map((row) => row.name);

describe("the database's own guards", () => {
  it("has row level security on every table the app's roles can reach", async () => {
    expect(await names("select c.relname name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")).toEqual([]);
  });

  it("pins the search path of every function that runs with its owner's rights", async () => {
    expect(await names("select p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosecdef and not coalesce(p.proconfig::text like '%search_path=%', false)")).toEqual([]);
  });

  it("keeps ids and timing only in a job, never personal data or content", async () => {
    expect(await names("select column_name name from information_schema.columns where table_schema = 'public' and table_name = 'jobs' order by column_name")).toEqual([
      "attempts", "claimed_until", "entity_id", "entity_type", "firm_id", "id", "idempotency_key", "kind", "last_error_code", "run_at", "schedule_version", "state",
    ]);
  });
});
