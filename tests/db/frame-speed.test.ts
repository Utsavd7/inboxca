import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

// The frame's speed (20261101900000_frame_speed.sql): the bell and the owner's log reads check
// the person once a read, not once a line, with the same rules. Invented firms and people;
// everything rolls back.
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

const firm = randomUUID(), other = randomUUID();
const people = { owner: randomUUID(), partner: randomUUID(), manager: randomUUID(), staff: randomUUID(), front_desk: randomUUID(), otherOwner: randomUUID() };

async function seed() {
  await asOwner(db);
  for (const [role, id] of Object.entries(people)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `frame-${role}-${id.slice(0, 6)}@invented.test`]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Frame Firm', '24', 'active'), ($2, 'Invented Other Firm', '24', 'active')", [firm, other]);
  for (const role of ["owner", "partner", "manager", "staff", "front_desk"] as const)
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, 'active')", [firm, people[role], role]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [other, people.otherOwner]);
  // 300 clients and 3,000 lines of InboxCA's own work on them, newest last, and a line in the other firm.
  await db.query("insert into public.clients (firm_id, name, kind) select $1, 'Invented Frame Client ' || n, 'business' from generate_series(1, 300) n", [firm]);
  await db.query("insert into public.activity_log (firm_id, action, entity_type, entity_id, at) select $1, 'reminder.sent', 'client', c.id, now() - make_interval(secs => n) from generate_series(1, 3000) n join lateral (select id from public.clients where firm_id = $1 order by name offset n % 300 limit 1) c on true", [firm]);
  await db.query("insert into public.activity_log (firm_id, action) values ($1, 'client.added')", [other]);
}
const as = async (person: string, sql: string, params: unknown[] = []) => {
  await actAs(db, person);
  return (await db.query(sql, params)).rows;
};

it("keeps the activity log the owner's alone, checked once a read", () => rollback(db, async () => {
  await seed();
  expect((await as(people.owner, "select count(*) filter (where action = 'reminder.sent')::int n, count(distinct firm_id)::int firms from public.activity_log"))[0]).toEqual({ n: 3000, firms: 1 });
  for (const role of ["partner", "manager", "staff", "front_desk"] as const)
    expect((await as(people[role], "select count(*)::int n from public.activity_log"))[0].n).toBe(0);
  expect((await as(people.otherOwner, "select count(*)::int n from public.activity_log where firm_id = $1", [firm]))[0].n).toBe(0);
  await actAs(db, people.owner, "aal1");
  expect((await db.query("select count(*)::int n from public.activity_log")).rows[0].n).toBe(0);
  await asOwner(db);
  // The rule names the person's firms once, never member_role for each line.
  const [{ qual }] = (await db.query("select qual from pg_policies where tablename = 'activity_log' and policyname = 'activity_select'")).rows;
  expect(qual).not.toMatch(/member_role\(activity_log\.firm_id\)|member_role\(firm_id\)/);
}));

it("gives the bell the newest 20 lines on clients the person can open, checking the person once", () => rollback(db, async () => {
  await seed();
  const feed = (person: string) => as(person, "select at, client_name from public.activity_feed($1, now() - interval '1 day', false)", [firm]);
  const lines = await feed(people.staff);
  expect(lines).toHaveLength(20);
  expect(lines.map((line) => +line.at)).toEqual(lines.map((line) => +line.at).sort((a, b) => b - a));
  expect(await feed(people.owner)).toEqual(lines);
  expect(await feed(people.otherOwner)).toEqual([]);
  await asOwner(db);
  const [{ prosrc }] = (await db.query("select prosrc from pg_proc where oid = 'public.activity_feed(uuid, timestamptz, boolean)'::regprocedure")).rows;
  expect(prosrc).not.toMatch(/can_access_client\(/);
}));
