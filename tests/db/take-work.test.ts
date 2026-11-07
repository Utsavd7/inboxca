import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Taking work (20261113100000_take_work.sql): a client's desk is taken, handed back and given only
// as each role may, and one return covered for one person clears when it is filed. Invented firm,
// people and clients; everything rolls back.
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

const firm = randomUUID();
const people = { owner: randomUUID(), manager: randomUUID(), staff: randomUUID(), other: randomUUID() };
const client = { open: randomUUID(), theirs: randomUUID() };
const late = `(now() at time zone 'Asia/Kolkata')::date - 3`;

async function seed() {
  await asOwner(db);
  for (const [role, id] of Object.entries(people)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `take-${role}-${id.slice(0, 6)}@invented.test`]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Take Firm', '24', 'active')", [firm]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'manager', 'active'), ($1, $4, 'staff', 'active'), ($1, $5, 'staff', 'active')", [firm, people.owner, people.manager, people.staff, people.other]);
  for (const [name, id] of Object.entries(client)) {
    await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, $3, 'business')", [id, firm, `Invented ${name} Traders`]);
    await db.query(`insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'GSTR3B_M', '2026-09', ${late}), ($1, $2, 'compliance', 'ITR_NA', '2026-03', ${late})`, [firm, id]);
  }
  // The other staff member does all of one client's work.
  await db.query("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm, client.theirs, people.other]);
}
const as = async (person: string, sql: string, params: unknown[] = []) => {
  await actAs(db, person);
  return attempt(db, sql, params);
};
const desk = (person: string, id: string, work: string | null, who: string | null, team: string | null = null) => as(person, "select public.set_desk($1, $2, $3, $4, $5)", [firm, id, work, who, team]);
const holders = async (id: string) => {
  await asOwner(db);
  return (await db.query("select user_id, work from public.client_assignments where client_id = $1 and role = 'staff' order by work nulls first, user_id", [id])).rows;
};
const late3b = async (id: string) => {
  await asOwner(db);
  return (await db.query("select id from public.tasks where client_id = $1 and code = 'GSTR3B_M'", [id])).rows[0].id as string;
};

it("lets staff take a desk nobody holds and hand it back, never one held or for someone else", () => rollback(db, async () => {
  await seed();
  expect((await desk(people.staff, client.open, "gst", people.staff)).ok).toBe(true);
  expect(await holders(client.open)).toEqual([{ user_id: people.staff, work: "gst" }]);
  // Held now: the other staff member sees the name and cannot take it, nor give it away.
  expect((await desk(people.other, client.open, "gst", people.other)).ok).toBe(false);
  expect((await desk(people.other, client.open, "gst", null)).ok).toBe(false);
  // Nor can staff give a desk to someone else, even one nobody holds.
  expect((await desk(people.staff, client.open, "income_tax", people.other)).ok).toBe(false);
  // Taking the other desk too makes it all the client's work; handing back GST leaves income tax.
  expect((await desk(people.staff, client.open, "income_tax", people.staff)).ok).toBe(true);
  expect(await holders(client.open)).toEqual([{ user_id: people.staff, work: null }]);
  expect((await desk(people.staff, client.open, "gst", null)).ok).toBe(true);
  expect(await holders(client.open)).toEqual([{ user_id: people.staff, work: "income_tax" }]);
  // Each take and hand back is logged with who did it and for whom.
  await asOwner(db);
  const lines = (await db.query("select actor_id, action, details from public.activity_log where entity_id = $1 and action like 'assignment.%' order by at", [client.open])).rows;
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.every((line) => line.actor_id === people.staff && line.details.person === people.staff)).toBe(true);
}));

it("lets a manager give any desk to anyone, and a holder of all work keeps the other desk", () => rollback(db, async () => {
  await seed();
  expect((await desk(people.manager, client.theirs, "gst", people.staff)).ok).toBe(true);
  expect(await holders(client.theirs)).toEqual([{ user_id: people.staff, work: "gst" }, { user_id: people.other, work: "income_tax" }]);
  // Nobody for income tax: the desk is free again.
  expect((await desk(people.manager, client.theirs, "income_tax", null)).ok).toBe(true);
  expect(await holders(client.theirs)).toEqual([{ user_id: people.staff, work: "gst" }]);
  // Someone who is the client's manager stays its manager rather than being made its staff.
  await asOwner(db);
  await db.query("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'manager')", [firm, client.open, people.manager]);
  expect((await desk(people.owner, client.open, "gst", people.manager)).ok).toBe(false);
}));

it("covers one return for one person until it is filed, as each role may", () => rollback(db, async () => {
  await seed();
  const task = await late3b(client.theirs);
  const cover = (person: string, who: string | null) => as(person, "select public.cover_return($1, $2, $3)", [firm, task, who]);
  const mine = async (person: string) => (await as(person, "select client_id from public.late_clients($1, true)", [firm])).rows?.map((row) => row.client_id) ?? [];
  // Staff cover a return for themselves, never for someone else; then it is on their list.
  expect((await cover(people.staff, people.other)).ok).toBe(false);
  expect((await cover(people.staff, people.staff)).ok).toBe(true);
  expect(await mine(people.staff)).toEqual([client.theirs]);
  // Once covered, nobody else without the right to assign takes it over.
  expect((await cover(people.other, people.other)).ok).toBe(false);
  // A manager gives it to someone else; the desk's own person keeps the client's other late return.
  expect((await cover(people.manager, people.owner)).ok).toBe(true);
  expect(await mine(people.staff)).toEqual([]);
  expect(await mine(people.other)).toEqual([client.theirs]);
  await asOwner(db);
  expect((await db.query("select count(*)::int n from public.activity_log where entity_id = $1 and action = 'task.covered'", [task])).rows[0].n).toBe(2);
  // Filing clears it.
  await db.query("update public.tasks set status = 'filed', details = jsonb_build_object('filed_on', (now() at time zone 'Asia/Kolkata')::date) where id = $1", [task]);
  expect((await db.query("select doer from public.tasks where id = $1", [task])).rows[0].doer).toBeNull();
  expect((await cover(people.manager, people.staff)).ok).toBe(false);
}));

it("in a firm that shows each person only their clients, keeps taking and cover to the clients they see", () => rollback(db, async () => {
  await seed();
  await asOwner(db);
  await db.query(`update public.firms set settings = settings || '{"client_visibility": "restricted"}' where id = $1`, [firm]);
  // Staff see no client nobody gave them, so they take none of its desks.
  expect((await desk(people.staff, client.open, "gst", people.staff)).ok).toBe(false);
  // A return cannot be given to someone who cannot see its client.
  const task = await late3b(client.theirs);
  expect((await as(people.manager, "select public.cover_return($1, $2, $3)", [firm, task, people.staff])).ok).toBe(false);
  // Once the owner gives them the client's GST, they see it and can hand it back.
  expect((await desk(people.owner, client.open, "gst", people.staff)).ok).toBe(true);
  expect((await as(people.staff, "select id from public.clients where id = $1", [client.open])).rows).toHaveLength(1);
  expect((await desk(people.staff, client.open, "gst", null)).ok).toBe(true);
}));
