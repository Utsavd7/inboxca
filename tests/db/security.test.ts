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

  it("shows nothing of the firm to a sign in session that has ended, in any role, before its token runs out", () =>
    rollback(db, async () => {
      const firm = "00000000-0000-4000-8000-0000000000f1", session = "00000000-0000-4000-8000-0000000000e1";
      await db.query("insert into auth.users (id, email) values ($1, 'ended-session@example.test')", [OWNER]);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Session Firm', '27', 'active')", [firm]);
      await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Invented Session Client', 'business')", [firm]);
      await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [session, OWNER]);
      const sees = async (role: string) => {
        await asOwner(db);
        await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, 'active') on conflict (firm_id, user_id) do update set role = excluded.role", [firm, OWNER, role]);
        await actAs(db, OWNER, "aal2", session);
        return (await db.query("select count(*)::int n from public.clients")).rows[0].n;
      };
      for (const role of ["owner", "partner", "manager", "staff", "front_desk"]) expect(await sees(role)).toBe(1);
      await asOwner(db);
      await db.query("delete from auth.sessions where id = $1", [session]);
      for (const role of ["owner", "partner", "manager", "staff", "front_desk"]) expect(await sees(role)).toBe(0);
    }));

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

  // S7: two requests at the same moment with one recovery code; the second waits for the first.
  it("spends a recovery code once, for the server only, even when two tries come at the same moment", async () => {
    const other = await connect();
    const person = "00000000-0000-4000-8000-0000000000a7";
    const spend = (client: Client) => client.query("select public.spend_recovery_code($1, $2) n", [person, ["code-a"]]);
    try {
      await db.query("insert into auth.users(id, email, raw_app_meta_data) values ($1, 'recovery@security.test', $2)", [person, { recovery: ["code-a", "code-b"] }]);
      await db.query("begin");
      await db.query("set local role service_role");
      const first = await spend(db);
      await other.query("set role service_role");
      const second = spend(other);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await db.query("commit");
      expect([first.rows[0].n, (await second).rows[0].n]).toEqual([1, null]);
      for (const role of [OWNER, person, null])
        await rollback(db, async () => {
          await actAs(db, role);
          expect((await attempt(db, "select public.spend_recovery_code($1, $2)", [person, ["code-b"]])).ok).toBe(false);
        });
    } finally {
      await asOwner(db);
      await db.query("delete from auth.users where id = $1", [person]);
      await other.end();
    }
  });

  it("refuses a raw IP address in the activity log; only a keyed digest is kept", () =>
    rollback(db, async () => {
      const firm = "00000000-0000-4000-8000-0000000009a0";
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Address Firm', '24', 'active')", [firm]);
      for (const address of ["203.0.113.7", "2001:db8::1", "::ffff:198.51.100.4"])
        expect((await attempt(db, "insert into public.activity_log (firm_id, action, details) values ($1, 'office.refused', $2)", [firm, { ip: address }])).ok).toBe(false);
      expect((await attempt(db, "insert into public.activity_log (firm_id, action, details) values ($1, 'office.refused', $2)", [firm, { ip: "Qm9yaW5nLWtleWVkLWRpZw" }])).ok).toBe(true);
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
