import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityDetails } from "@/src/lib/activity";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The security pass (PLAN.md 8.2, 8.5): rules that every new table, function and job must keep.
const OWNER = "00000000-0000-4000-8000-0000000000a1";

// The keys of each jsonb_build_object at the top of the details in a function's inserts into
// activity_log; nested objects inside a detail are its value, not more details.
function detailKeys(src: string) {
  // From `at` to the end of its statement or bracket, with each top level argument.
  const span = (at: number, stopAtSemicolon: boolean) => {
    const parts: string[] = [];
    let depth = 0, quoted = false, start = at;
    for (let i = at; i < src.length; i++) {
      const c = src[i];
      if (c === "'") quoted = !quoted;
      if (quoted) continue;
      if (c === "(") depth++;
      else if (c === ")" && depth-- === 0) return { parts: [...parts, src.slice(start, i)], end: i };
      else if (c === "," && depth === 0) {
        parts.push(src.slice(start, i));
        start = i + 1;
      }
      else if (c === ";" && depth === 0 && stopAtSemicolon) return { parts, end: i };
    }
    return { parts, end: src.length };
  };
  const inserts = [...src.matchAll(/insert\s+into\s+public\.activity_log/gi)].map((match) => [match.index, span(match.index, true).end]);
  const keys = new Set<string>();
  let after = -1;
  for (const match of src.matchAll(/jsonb_build_object\s*\(/g)) {
    if (match.index < after || !inserts.some(([start, end]) => match.index > start && match.index < end)) continue;
    const { parts, end } = span(match.index + match[0].length, false);
    after = end;
    parts.forEach((part, at) => {
      const key = part.trim().match(/^'([a-z_]+)'$/)?.[1];
      if (at % 2 === 0 && key) keys.add(key);
    });
  }
  return [...keys];
}

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

  it("counts sign in tries per key in a window, for the server only", () =>
    rollback(db, async () => {
      const key = `test-${Date.now()}`;
      await db.query("set local role service_role");
      const tries = [];
      for (let at = 0; at < 4; at++) tries.push((await db.query("select public.rate_limit($1, 3, 3600) ok", [key])).rows[0].ok);
      expect(tries).toEqual([true, true, true, false]);
      // A window that has passed starts again.
      await asOwner(db);
      await db.query("update private.rate_limits set since = now() - interval '2 hours' where key = $1", [key]);
      await db.query("set local role service_role");
      expect((await db.query("select public.rate_limit($1, 3, 3600) ok", [key])).rows[0].ok).toBe(true);
      for (const role of [OWNER, null]) {
        await actAs(db, role);
        expect((await attempt(db, "select public.rate_limit($1, 3, 3600)", [key])).ok).toBe(false);
        expect((await attempt(db, "select * from private.rate_limits")).ok).toBe(false);
      }
    }));

  it("writes only activity actions and details listed in src/lib/activity.ts", async () => {
    // Each database function that writes the log: the actions it names, and the keys of the
    // details built inside each of its inserts.
    const { rows } = await db.query("select n.nspname || '.' || p.proname name, p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* 'insert\\s+into\\s+public\\.activity_log'");
    expect(rows.length).toBeGreaterThan(30);
    const problems: string[] = [];
    for (const { name, src } of rows as { name: string; src: string }[]) {
      if (name === "public.log_change") continue; // its actions come from its triggers, below
      const named = [...new Set([...src.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]))].filter((word) => !/^(app|request|public|private|auth|extensions)\./.test(word));
      const prefixes = [...src.matchAll(/'([a-z_]+\.)'\s*\|\|/g)].map((match) => match[1]);
      const actions = [...named, ...Object.keys(activityDetails).filter((action) => prefixes.some((prefix) => action.startsWith(prefix)))];
      if (!actions.length) problems.push(`${name}: names no action`);
      problems.push(...named.filter((action) => !(action in activityDetails)).map((action) => `${name}: ${action} is not in src/lib/activity.ts`));
      for (const key of detailKeys(src))
        if (!actions.some((action) => activityDetails[action]?.includes(key))) problems.push(`${name}: the detail ${key} is not listed for ${actions.join(" or ")}`);
    }
    const triggers = await db.query("select tgrelid::regclass::text t, tgtype, split_part(encode(tgargs, 'escape'), '\\000', 1) thing from pg_trigger g join pg_proc p on p.oid = g.tgfoid where not g.tgisinternal and p.proname = 'log_change'");
    for (const { t, tgtype, thing } of triggers.rows)
      for (const [bit, end, key] of [[4, "added", "kind"], [8, "removed", "kind"], [16, "changed", "changed"]] as const)
        if (tgtype & bit && !activityDetails[`${thing}.${end}`]?.includes(key)) problems.push(`log_change on ${t}: ${thing}.${end} with ${key} is not in src/lib/activity.ts`);
    expect(problems).toEqual([]);
  });

  it("keeps ids and timing only in a job, never personal data or content", async () => {
    expect(await names("select column_name name from information_schema.columns where table_schema = 'public' and table_name = 'jobs' order by column_name")).toEqual([
      "attempts", "claimed_until", "entity_id", "entity_type", "firm_id", "id", "idempotency_key", "kind", "last_error_code", "run_at", "schedule_version", "state",
    ]);
  });
});
