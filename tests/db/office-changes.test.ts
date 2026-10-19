import { createHmac, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-0000000009a0";
const OWNER = "00000000-0000-4000-8000-0000000009a1";
const STAFF = "00000000-0000-4000-8000-0000000009a2";
const DEPUTY = "00000000-0000-4000-8000-0000000009a3";
const PARTNER = "00000000-0000-4000-8000-0000000009a4";
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

async function seed() {
  await asOwner(db);
  for (const person of [OWNER, STAFF, DEPUTY, PARTNER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [person, `${person}@office.test`]);
  await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Changed Office', '24', 'active', $2)", [FIRM, { office: { on: true, deputies: [DEPUTY], lines: [] } }]);
  for (const [person, role] of [[OWNER, "owner"], [STAFF, "staff"], [DEPUTY, "partner"], [PARTNER, "partner"]])
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, 'active')", [FIRM, person, role]);
  return (await db.query("insert into public.devices (firm_id, token_hash, name, kind, status) values ($1, $2, 'Reception PC', 'laptop', 'approved') returning id", [FIRM, "e".repeat(64)])).rows[0].id as string;
}
const observe = async (pc: string, line: object) => (await db.query("select public.observe_office($1, $2, $3, $4) as allowed", [FIRM, STAFF, pc, line])).rows[0].allowed;
const lines = async () => (await db.query("select settings -> 'office' -> 'lines' as lines from public.firms where id = $1", [FIRM])).rows[0].lines as Record<string, string>[];

describe("office changes", () => {
  it("only lets the owner and named deputies approve, and limits deputies to two active partners", () => rollback(db, async () => {
    const pc = await seed();
    await db.query("update public.devices set status = 'waiting', kind = null where id = $1", [pc]);
    for (const actor of [STAFF, PARTNER]) expect((await attempt(db, "select public.review_devices($1, $2, $3, 'office')", [FIRM, actor, pc])).ok).toBe(false);
    await db.query("select public.review_devices($1, $2, $3, 'office')", [FIRM, DEPUTY, pc]);
    expect((await db.query("select kind from public.devices where id = $1", [pc])).rows[0].kind).toBe("office");
    expect((await attempt(db, "select public.office_control($1, $2, 'here', connection => $3)", [FIRM, PARTNER, { ipv4: "203.0.113.10" }])).ok).toBe(false);
    await db.query("select public.office_control($1, $2, 'here', connection => $3)", [FIRM, DEPUTY, { ipv4: "203.0.113.10" }]);
    expect((await lines())[0].ipv4).toBe("203.0.113.10");
    expect((await attempt(db, "select public.office_control($1, $2, 'off')", [FIRM, DEPUTY])).ok).toBe(false);
    expect((await attempt(db, "select public.office_control($1, $2, 'deputies', deputies => $3)", [FIRM, OWNER, [STAFF]])).ok).toBe(false);
    expect((await attempt(db, "select public.office_control($1, $2, 'deputies', deputies => $3)", [FIRM, OWNER, [DEPUTY, PARTNER, OWNER]])).ok).toBe(false);
    await actAs(db, STAFF);
    expect((await attempt(db, "select public.observe_office($1, $2, $3, $4)", [FIRM, STAFF, pc, { ipv4: "203.0.113.10" }])).ok).toBe(false);
    await actAs(db, DEPUTY, "aal1");
    expect((await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role).toBeNull();
    await actAs(db, DEPUTY);
    expect((await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role).toBe("partner");
  }));

  it("keeps laptops waiting, lets office PCs learn, and withdraws their mark on refusal", () => rollback(db, async () => {
    const pc = await seed();
    const line = { ipv4: "203.0.113.10" };
    expect(await observe(pc, line)).toBe(false);
    expect(await observe(pc, line)).toBe(false);
    const [{ id: otherPc }] = (await db.query("insert into public.devices (firm_id, token_hash, name, kind, status) values ($1, $2, 'Other laptop', 'laptop', 'approved') returning id", [FIRM, "f".repeat(64)])).rows;
    expect(await observe(otherPc, line)).toBe(false);
    expect(await lines()).toEqual([]);
    expect((await db.query("select count(*)::int as n from public.activity_log where firm_id = $1 and action = 'office.refused'", [FIRM])).rows[0].n).toBe(1);
    await db.query("update public.devices set kind = 'office' where id = $1", [pc]);
    expect(await observe(pc, line)).toBe(true);
    const [{ id }] = (await db.query("select id from public.requests where firm_id = $1 and reason_code = 'office_changed'", [FIRM])).rows;
    await db.query("select public.office_control($1, $2, 'refuse', $3)", [FIRM, DEPUTY, id]);
    expect(await lines()).toEqual([]);
    expect(await observe(pc, line)).toBe(false);
    expect((await db.query("select kind from public.devices where id = $1", [pc])).rows[0].kind).toBe("laptop");
  }));

  it("learns a new half only through a confirmed half and drops unused lines after seven days", () => rollback(db, async () => {
    const pc = await seed();
    await db.query("select public.office_control($1, $2, 'here', connection => $3)", [FIRM, OWNER, { ipv4: "203.0.113.10", ipv6: "2001:db8:a:b" }]);
    expect(await observe(pc, { ipv4: "203.0.113.11", ipv6: "2001:db8:a:b" })).toBe(true);
    expect((await lines())[0].ipv4).toBe("203.0.113.11");
    expect(await observe(pc, { ipv4: "203.0.113.11", ipv6: "2001:db8:a:c" })).toBe(true);
    expect((await lines())[0].ipv6).toBe("2001:db8:a:c");
    expect(await observe(pc, { ipv4: "203.0.113.12", ipv6: "2001:db8:a:d" })).toBe(false);
    await db.query("select public.office_housekeeping($1, now() + interval '7 days')", [FIRM]);
    expect(await lines()).toEqual([]);
  }));

  it("ends today's approval at closing and keeps fixed lines during housekeeping", () => rollback(db, async () => {
    const pc = await seed();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await db.query("update public.firms set settings = settings || $2 where id = $1", [FIRM, { special_hours: [{ from: day, to: day, open: "00:00", close: "23:59" }] }]);
    expect(await observe(pc, { ipv4: "203.0.113.10" })).toBe(false);
    const [{ id }] = (await db.query("select id from public.requests where firm_id = $1", [FIRM])).rows;
    await db.query("select public.office_control($1, $2, 'today', $3)", [FIRM, DEPUTY, id]);
    const [line] = await lines();
    expect(line.until).toContain("18:29:00");
    expect(await observe(pc, { ipv4: "203.0.113.10" })).toBe(true);
    await db.query("update public.firms set settings = jsonb_set(settings, '{office,lines,0,until}', to_jsonb((now() - interval '1 minute')::text)) where id = $1", [FIRM]);
    expect(await observe(pc, { ipv4: "203.0.113.10" })).toBe(false);
    await db.query("select public.office_housekeeping($1, $2::timestamptz)", [FIRM, line.until]);
    expect(await lines()).toEqual([]);
    await db.query("select public.office_control($1, $2, 'fixed', connection => $3)", [FIRM, OWNER, { ipv4: "203.0.113.10" }]);
    await db.query("select public.office_housekeeping($1, now() + interval '8 days')", [FIRM]);
    expect(await lines()).toHaveLength(1);
  }));

  it("refuses a deputy's own PC approval and hides network requests from staff", () => rollback(db, async () => {
    const pc = await seed();
    await observe(pc, { ipv4: "203.0.113.10" });
    await db.query("select public.office_control($1, $2, 'off')", [FIRM, OWNER]);
    expect((await db.query("select status from public.requests where firm_id = $1", [FIRM])).rows).toEqual([{ status: "done" }]);
    await actAs(db, STAFF);
    expect((await db.query("select id from public.requests where firm_id = $1", [FIRM])).rows).toEqual([]);
    expect((await attempt(db, "select public.office_control($1, $2, 'here', connection => $3)", [FIRM, OWNER, { ipv4: "203.0.113.10" }])).ok).toBe(false);
    await asOwner(db);
    await db.query("update public.devices set status = 'waiting', kind = null where id = $1", [pc]);
    await db.query("insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'device.first_seen', 'device', $3)", [FIRM, DEPUTY, pc]);
    await db.query("select public.review_devices($1, $2, $3, 'office')", [FIRM, DEPUTY, pc]);
    expect((await db.query("select status from public.devices where id = $1", [pc])).rows[0].status).toBe("waiting");
    await db.query("select public.review_devices($1, $2, $3, 'office')", [FIRM, OWNER, pc]);
    expect((await db.query("select status from public.devices where id = $1", [pc])).rows[0].status).toBe("approved");
  }));

  it("keeps closed hours closed for email-only office sessions and reports the reason only with proof", () => rollback(db, async () => {
    await seed();
    await db.query("update public.firms set settings = settings || $2 where id = $1", [FIRM, { hours: {}, access: { hours_only: true } }]);
    const key = (await db.query("select public.office_proof_key() as key")).rows[0].key as string;
    const until = Math.floor(Date.now() / 1000) + 300;
    const session = randomUUID();
    await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [session, STAFF]);
    const proof = `${until}.${createHmac("sha256", key).update(`${STAFF}:${session}:${until}`).digest("hex")}`;
    await actAs(db, STAFF, "aal1", session);
    await db.query("select set_config('request.headers', '{}', true)");
    expect((await db.query("select * from public.closed_firms()")).rows).toEqual([]);
    await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-inboxca-office": proof })]);
    expect((await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role).toBeNull();
    expect((await db.query("select reason from public.closed_firms()")).rows).toEqual([{ reason: "hours" }]);
  }));
});
