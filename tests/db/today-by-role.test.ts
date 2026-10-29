import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

// Today by role (20261101100000_today_by_role.sql): a person's own late clients, which of a list
// of clients they look after, this week's numbers and a manager's busiest people, each read as
// the signed in person. Invented firm, people and clients; everything rolls back.
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

const firm = randomUUID(), team = randomUUID();
const people = { owner: randomUUID(), manager: randomUUID(), staff: randomUUID(), other: randomUUID(), outside: randomUUID(), stranger: randomUUID() };
const client = { mine: randomUUID(), team: randomUUID(), other: randomUUID() };
const day = (days: number) => `(now() at time zone 'Asia/Kolkata')::date + ${days}`;

async function seed() {
  await asOwner(db);
  for (const [role, id] of Object.entries(people)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `today-${role}-${id.slice(0, 6)}@invented.test`]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Today Firm', '24', 'active')", [firm]);
  await db.query("insert into public.groups (id, firm_id, kind, name) values ($1, $2, 'team', 'Invented team')", [team, firm]);
  // The manager and the staff member share a team; the other staff member has no team.
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status, team_id) values ($1, $2, 'owner', 'active', null), ($1, $3, 'manager', 'active', $6), ($1, $4, 'staff', 'active', $6), ($1, $5, 'staff', 'active', null), ($1, $7, 'staff', 'active', $6)",
    [firm, people.owner, people.manager, people.staff, people.other, team, people.outside],
  );
  for (const [name, id] of Object.entries(client)) await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, $3, 'business')", [id, firm, `Invented ${name} Traders`]);
  // The staff member's own client, a client of the team's other person, and one of someone else.
  await db.query("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff'), ($1, $4, $5, 'staff'), ($1, $6, $7, 'staff')", [firm, client.mine, people.staff, client.team, people.outside, client.other, people.other]);
  // Each client: a return 5 days late, one due today; the staff member's client one filed too.
  for (const id of Object.values(client))
    await db.query(`insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'GSTR1_M', '2026-08', ${day(-5)}), ($1, $2, 'compliance', 'GSTR3B_M', '2026-09', ${day(0)})`, [firm, id]);
  await db.query(`insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on, status, details) values ($1, $2, 'compliance', 'GSTR1_M', '2026-09', ${day(0)}, 'filed', jsonb_build_object('filed_on', ${day(0)}))`, [firm, client.mine]);
  // Papers asked of two clients, twice of one.
  for (const id of [client.mine, client.mine, client.other])
    await db.query("insert into public.requests (firm_id, client_id, kind, entity_type, entity_id, expires_at) values ($1, $2, 'documents', 'checklist', gen_random_uuid(), now() + interval '7 days')", [firm, id]);
}
const as = async (person: string, sql: string, params: unknown[] = []) => {
  await actAs(db, person);
  return (await db.query(sql, params)).rows;
};

it("lists a person's own late clients when asked, and every one they can see otherwise", () => rollback(db, async () => {
  await seed();
  const late = (person: string, mine: boolean) => as(person, "select client_id from public.late_clients($1, $2) order by client_id", [firm, mine]).then((rows) => rows.map((row) => row.client_id));
  const every = Object.values(client).sort();
  expect(await late(people.owner, true)).toEqual(every);
  expect(await late(people.staff, false)).toEqual(every);
  expect(await late(people.staff, true)).toEqual([client.mine]);
  // A manager looks after their team's clients and those of their team's people.
  expect(await late(people.manager, true)).toEqual([client.mine, client.team].sort());
  expect(await late(people.other, true)).toEqual([client.other]);
  expect((await as(people.staff, "select returns from public.late_clients($1)", [firm])).every((row) => row.returns === 1)).toBe(true);
}));

it("keeps the clients a person looks after out of a list of them", () => rollback(db, async () => {
  await seed();
  const looked = (person: string) => as(person, "select id from public.looked_after($1, $2) id order by 1", [firm, Object.values(client)]).then((rows) => rows.map((row) => row.id));
  expect(await looked(people.owner)).toEqual(Object.values(client).sort());
  expect(await looked(people.staff)).toEqual([client.mine]);
  expect(await looked(people.manager)).toEqual([client.mine, client.team].sort());
  // Someone outside the firm looks after none of them, and has no late clients or numbers of its own.
  expect(await looked(people.stranger)).toEqual([]);
  expect(await as(people.stranger, "select client_id from public.late_clients($1, true)", [firm])).toEqual([]);
}));

it("counts the returns due in a range, how many are filed, and the clients still asked for papers", () => rollback(db, async () => {
  await seed();
  const numbers = (person: string, mine: boolean) => as(person, `select due, filed, waiting from public.work_numbers($1, ${day(-1)}, ${day(6)}, $2)`, [firm, mine]).then((rows) => rows[0]);
  expect(await numbers(people.owner, false)).toEqual({ due: 4, filed: 1, waiting: 2 });
  expect(await numbers(people.staff, true)).toEqual({ due: 2, filed: 1, waiting: 1 });
  expect(await numbers(people.manager, true)).toEqual({ due: 3, filed: 1, waiting: 1 });
  expect(await numbers(people.other, true)).toEqual({ due: 1, filed: 0, waiting: 1 });
}));

it("ranks a manager's team by their open returns, and has none for someone with no team", () => rollback(db, async () => {
  await seed();
  await asOwner(db);
  await db.query(`insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'ITR_NA', '2026', ${day(3)})`, [firm, client.team]);
  const load = (person: string) => as(person, `select user_id, returns from public.team_load($1, ${day(6)})`, [firm]);
  expect(await load(people.manager)).toEqual([{ user_id: people.outside, returns: 3 }, { user_id: people.staff, returns: 2 }]);
  expect(await load(people.other)).toEqual([]);
  // Read past the row rules, it still keeps them: nothing for someone outside the firm, and in a
  // firm that shows each person only their clients, only the clients given to the manager's team.
  expect(await load(people.stranger)).toEqual([]);
  await asOwner(db);
  await db.query(`update public.firms set settings = settings || '{"client_visibility": "restricted"}' where id = $1`, [firm]);
  expect(await load(people.manager)).toEqual([]);
  await asOwner(db);
  await db.query("insert into public.client_assignments (firm_id, client_id, team_id, role) values ($1, $2, $3, 'staff')", [firm, client.team, team]);
  expect(await load(people.manager)).toEqual([{ user_id: people.outside, returns: 3 }]);
}));
