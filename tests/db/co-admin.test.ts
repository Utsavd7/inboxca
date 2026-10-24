import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-000000000ca0";
const OWNER = "00000000-0000-4000-8000-000000000ca1";
const CO_ADMIN = "00000000-0000-4000-8000-000000000ca2";
const DEPUTY = "00000000-0000-4000-8000-000000000ca3";
const STAFF = "00000000-0000-4000-8000-000000000ca4";
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

async function seed(office: object) {
  await asOwner(db);
  for (const person of [OWNER, CO_ADMIN, DEPUTY, STAFF]) await db.query("insert into auth.users (id, email) values ($1, $2)", [person, `${person}@co-admin.test`]);
  await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Two Owners', '27', 'active', $2)", [FIRM, { office, mail_limit: 500 }]);
  for (const [person, role] of [[OWNER, "owner"], [CO_ADMIN, "partner"], [DEPUTY, "partner"], [STAFF, "staff"]])
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, 'active')", [FIRM, person, role]);
}
const admin = async (person: string) => (await db.query("select private.firm_admin($1, $2) as ok", [FIRM, person])).rows[0].ok;
const office = async () => (await db.query("select settings -> 'office' as office from public.firms where id = $1", [FIRM])).rows[0].office;
// A change through the API as a signed in person: the rows it changed, or its refusal.
const change = async (person: string, sql: string) => {
  await actAs(db, person);
  const result = await attempt(db, sql, [FIRM]);
  await asOwner(db);
  return result.ok ? result.count : result.error;
};

describe("co-admin (5.17.4 #22)", () => {
  it("is the owner, or the one deputy the owner named, while still a deputy", () => rollback(db, async () => {
    await seed({ deputies: [CO_ADMIN, DEPUTY], co_admin: CO_ADMIN });
    expect([await admin(OWNER), await admin(CO_ADMIN), await admin(DEPUTY), await admin(STAFF)]).toEqual([true, true, false, false]);
    await db.query("update public.firms set settings = jsonb_set(settings, '{office,deputies}', $2) where id = $1", [FIRM, JSON.stringify([DEPUTY])]);
    expect(await admin(CO_ADMIN)).toBe(false);
  }));

  it("lets only the owner name the co-admin, among the deputies, and logs it", () => rollback(db, async () => {
    await seed({ deputies: [] });
    expect((await attempt(db, "select public.office_control($1, $2, 'deputies', deputies => $3, co_admin => $4)", [FIRM, OWNER, [DEPUTY], CO_ADMIN])).ok).toBe(false);
    await db.query("select public.office_control($1, $2, 'deputies', deputies => $3, co_admin => $4)", [FIRM, OWNER, [CO_ADMIN, DEPUTY], CO_ADMIN]);
    expect((await office()).co_admin).toBe(CO_ADMIN);
    expect((await db.query("select details from public.activity_log where firm_id = $1 and action = 'office.deputies'", [FIRM])).rows[0].details).toEqual({ deputies: [CO_ADMIN, DEPUTY], co_admin: CO_ADMIN });
    expect((await attempt(db, "select public.office_control($1, $2, 'deputies', deputies => $3)", [FIRM, CO_ADMIN, [CO_ADMIN]])).ok).toBe(false);
    await db.query("select public.office_control($1, $2, 'deputies', deputies => $3)", [FIRM, OWNER, [DEPUTY]]);
    expect((await office()).co_admin).toBeNull();
  }));

  it("lets the co-admin turn Office only on and off, never a plain deputy", () => rollback(db, async () => {
    await seed({ deputies: [CO_ADMIN, DEPUTY], co_admin: CO_ADMIN });
    expect((await attempt(db, "select public.office_control($1, $2, 'on')", [FIRM, DEPUTY])).ok).toBe(false);
    await db.query("select public.office_control($1, $2, 'on', connection => $3)", [FIRM, CO_ADMIN, { ipv4: "203.0.113.20" }]);
    expect((await office()).on).toBe(true);
    await db.query("select public.office_control($1, $2, 'off')", [FIRM, CO_ADMIN]);
    expect((await office()).on).toBe(false);
  }));

  it("lets the co-admin save the access settings, and nothing that stays the owner's", () => rollback(db, async () => {
    await seed({ deputies: [CO_ADMIN, DEPUTY], co_admin: CO_ADMIN });
    const set = (path: string, value: string) => `update public.firms set settings = jsonb_set(settings, '${path}', '${value}') where id = $1`;
    expect(await change(CO_ADMIN, set("{access}", '{"idle_minutes":15}'))).toBe(1);
    expect(await change(CO_ADMIN, set("{office,on}", "true"))).toBe(1);
    expect(await change(DEPUTY, set("{access}", "{}"))).toBe(0);
    expect(await change(STAFF, set("{access}", "{}"))).toBe(0);
    for (const sql of [set("{mail_limit}", "10"), set("{office,co_admin}", `"${DEPUTY}"`), set("{office,deputies}", `["${CO_ADMIN}"]`), "update public.firms set name = 'Mine' where id = $1"])
      expect(await change(CO_ADMIN, sql)).toMatch(/Only the owner/);
    expect(await change(OWNER, set("{office,co_admin}", "null"))).toBe(1);
    expect(await change(CO_ADMIN, set("{access}", "{}"))).toBe(0);
    expect((await db.query("select settings -> 'access' as access from public.firms where id = $1", [FIRM])).rows[0].access).toEqual({ idle_minutes: 15 });
  }));
});
