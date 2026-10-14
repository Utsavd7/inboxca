import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Two firms, A and B. Every check runs inside a transaction that is rolled back.
const FIRM_A = "00000000-0000-4000-8000-00000000000a";
const FIRM_B = "00000000-0000-4000-8000-00000000000b";
const OWNER_A = "00000000-0000-4000-8000-0000000000a1";
const STAFF_A = "00000000-0000-4000-8000-0000000000a2";
const LEFT_A = "00000000-0000-4000-8000-0000000000a3";
const OWNER_B = "00000000-0000-4000-8000-0000000000b1";
const NEW_PERSON = "00000000-0000-4000-8000-0000000000c1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const id of [OWNER_A, STAFF_A, LEFT_A, OWNER_B, NEW_PERSON])
    await db.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${id.slice(-2)}@example.test`,
    ]);
  await db.query(
    "insert into public.firms (id, name, gstin, status) values ($1, 'Firm A', '27ABCDE1234F1Z5', 'active')",
    [FIRM_A],
  );
  await db.query(
    "insert into public.firms (id, name, state_code, status) values ($1, 'Firm B', '24', 'active')",
    [FIRM_B],
  );
  const members: [string, string, string, string][] = [
    [FIRM_A, OWNER_A, "owner", "active"],
    [FIRM_A, STAFF_A, "staff", "active"],
    [FIRM_A, LEFT_A, "staff", "deactivated"],
    [FIRM_B, OWNER_B, "owner", "active"],
  ];
  for (const row of members)
    await db.query(
      "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, $4)",
      row,
    );
  await db.query(
    "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'GST team'), ($2, 'branch', 'Surat')",
    [FIRM_A, FIRM_B],
  );
  await db.query(
    "insert into public.activity_log (firm_id, actor_id, action) values ($1, $2, 'client.created'), ($3, $4, 'client.created')",
    [FIRM_A, OWNER_A, FIRM_B, OWNER_B],
  );
}

const ids = (rows: { id?: string; firm_id?: string }[]) =>
  rows.map((row) => row.id ?? row.firm_id).sort();

describe("one firm never sees another", () => {
  it("shows a person only their own firm's rows, in every table", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      expect(ids((await db.query("select id from public.firms")).rows)).toEqual([FIRM_A]);
      expect(ids((await db.query("select firm_id from public.groups")).rows)).toEqual([FIRM_A]);
      const people = await db.query("select distinct firm_id from public.firm_members");
      expect(ids(people.rows)).toEqual([FIRM_A]);
      const log = await db.query("select distinct firm_id from public.activity_log");
      expect(ids(log.rows)).toEqual([FIRM_A]);
    }));

  it("cannot change another firm, even by its id", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      const renamed = await attempt(db, "update public.firms set name = 'Taken' where id = $1", [FIRM_B]);
      expect(renamed).toMatchObject({ ok: true, count: 0 });
      const joined = await attempt(
        db,
        "insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'staff')",
        [FIRM_B, NEW_PERSON],
      );
      expect(joined.ok).toBe(false);
      const grouped = await attempt(
        db,
        "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'x')",
        [FIRM_B],
      );
      expect(grouped.ok).toBe(false);
    }));

  it("shows nothing to someone who has left the firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, LEFT_A);
      expect((await db.query("select id from public.firms")).rowCount).toBe(0);
      expect((await db.query("select firm_id from public.firm_members")).rowCount).toBe(0);
    }));

  it("shows nothing at all to a visitor who is not signed in", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, null);
      for (const table of ["firms", "groups", "firm_members", "activity_log"])
        expect((await attempt(db, `select 1 from public.${table}`)).ok).toBe(false);
    }));
});

describe("what each role may change", () => {
  it("lets the owner rename the firm but not change its status or GSTIN", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      expect(
        await attempt(db, "update public.firms set name = 'Firm A and Co' where id = $1", [FIRM_A]),
      ).toMatchObject({ ok: true, count: 1 });
      expect(
        (await attempt(db, "update public.firms set status = 'active' where id = $1", [FIRM_A])).ok,
      ).toBe(false);
      expect(
        (await attempt(db, "update public.firms set gstin = null where id = $1", [FIRM_A])).ok,
      ).toBe(false);
    }));

  it("does not let staff change the firm or its groups", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF_A);
      expect(
        await attempt(db, "update public.firms set name = 'Mine' where id = $1", [FIRM_A]),
      ).toMatchObject({ ok: true, count: 0 });
      expect(
        (await attempt(db, "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'x')", [FIRM_A])).ok,
      ).toBe(false);
    }));

  it("lets the owner invite people, but never a second owner", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      expect(
        (await attempt(
          db,
          "insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'manager')",
          [FIRM_A, NEW_PERSON],
        )).ok,
      ).toBe(true);
      expect(
        await attempt(db, "update public.firm_members set role = 'owner' where user_id = $1", [STAFF_A]),
      ).toMatchObject({ ok: false });
    }));

  it("stops anyone changing their own role, the owner included", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF_A);
      expect(
        await attempt(db, "update public.firm_members set role = 'manager' where user_id = $1", [STAFF_A]),
      ).toMatchObject({ ok: true, count: 0 });
      await actAs(db, OWNER_A);
      expect(
        await attempt(db, "update public.firm_members set status = 'deactivated' where user_id = $1", [OWNER_A]),
      ).toMatchObject({ ok: true, count: 0 });
    }));
});

describe("the activity log is append only", () => {
  it("is read by the owner only", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF_A);
      expect((await db.query("select 1 from public.activity_log")).rowCount).toBe(0);
    }));

  it("cannot be written, changed or removed by anyone signed in", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      const write = await attempt(
        db,
        "insert into public.activity_log (firm_id, action) values ($1, 'x')",
        [FIRM_A],
      );
      expect(write.ok).toBe(false);
      expect((await attempt(db, "update public.activity_log set action = 'x'")).ok).toBe(false);
      expect((await attempt(db, "delete from public.activity_log")).ok).toBe(false);
    }));

  it("refuses changes even from the server and the database owner", () =>
    rollback(db, async () => {
      await seed();
      await db.query("set local role service_role");
      expect(
        (await attempt(db, "insert into public.activity_log (firm_id, action) values ($1, 'x')", [FIRM_A])).ok,
      ).toBe(true);
      expect((await attempt(db, "update public.activity_log set action = 'y'")).ok).toBe(false);
      await asOwner(db);
      expect((await attempt(db, "update public.activity_log set action = 'y'")).ok).toBe(false);
      expect((await attempt(db, "delete from public.activity_log")).ok).toBe(false);
      expect((await attempt(db, "truncate public.activity_log")).ok).toBe(false);
    }));

  it("lets only the purge, marked for its own transaction, remove rows", () =>
    rollback(db, async () => {
      await seed();
      await db.query("select set_config('app.log_purge', 'on', true)");
      expect(
        await attempt(db, "delete from public.activity_log where firm_id = $1", [FIRM_B]),
      ).toMatchObject({ ok: true, count: 1 });
    }));
});

describe("nothing is stored twice", () => {
  it("reads a firm's state from its GSTIN, and stores it only when there is none", () =>
    rollback(db, async () => {
      await seed();
      const states = await db.query(
        "select id, public.firm_state(f) as state from public.firms f order by name",
      );
      expect(states.rows.map((row) => row.state)).toEqual(["27", "24"]);
      const both = await attempt(
        db,
        "insert into public.firms (name, gstin, state_code) values ('C', '24ABCDE1234F1Z5', '24')",
      );
      expect(both.ok).toBe(false);
    }));
});
