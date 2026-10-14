import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The owner invites, the person joins. Every check runs inside a transaction that is
// rolled back.
const FIRM = "00000000-0000-4000-8000-0000000001a0";
const OTHER = "00000000-0000-4000-8000-0000000001b0";
const OWNER = "00000000-0000-4000-8000-0000000001a1";
const STAFF = "00000000-0000-4000-8000-0000000001a2";
const NEW = "00000000-0000-4000-8000-0000000001a3";
const OUTSIDER = "00000000-0000-4000-8000-0000000001b1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const [id, email] of [
    [OWNER, "owner@firm.test"],
    [STAFF, "staff@firm.test"],
    [NEW, "New@Firm.test"],
    [OUTSIDER, "owner@other.test"],
  ])
    await db.query("insert into auth.users (id, email) values ($1, lower($2))", [id, email]);
  await db.query(
    "insert into public.firms (id, name, state_code, status) values ($1, 'Mehta & Co', '27', 'active'), ($2, 'Other', '24', 'active')",
    [FIRM, OTHER],
  );
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($4, $5, 'owner', 'active')",
    [FIRM, OWNER, STAFF, OTHER, OUTSIDER],
  );
}
const invite = async (firm: string, person: string, role: string) =>
  (await db.query("select public.invite_member($1, $2, $3) as added", [firm, person, role]))
    .rows[0].added;
const accept = async (firm: string) =>
  (await db.query("select public.accept_invite($1) as joined", [firm])).rows[0].joined;
const logged = async (action: string) => {
  await asOwner(db);
  return (
    await db.query("select actor_id, entity_id from public.activity_log where firm_id = $1 and action = $2", [
      FIRM,
      action,
    ])
  ).rows;
};

describe("inviting people", () => {
  it("lets the owner invite, and logs who invited whom", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect(await invite(FIRM, NEW, "staff")).toBe(true);
      expect(await invite(FIRM, NEW, "staff")).toBe(false); // already invited
      expect(await logged("member.invited")).toEqual([{ actor_id: OWNER, entity_id: NEW }]);
    }));

  it("lets nobody else invite, and never a second owner", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF);
      expect(await invite(FIRM, NEW, "staff")).toBe(false);
      await actAs(db, OUTSIDER);
      expect(await invite(FIRM, NEW, "staff")).toBe(false);
      await actAs(db, OWNER, "aal1");
      expect(await invite(FIRM, NEW, "staff")).toBe(false);
      await actAs(db, OWNER);
      expect(await invite(FIRM, NEW, "owner")).toBe(false);
      expect(await logged("member.invited")).toEqual([]);
    }));

  it("lists the firm's people with their addresses, to the firm only", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await invite(FIRM, NEW, "manager");
      await actAs(db, STAFF);
      const people = await db.query("select email, role, status from public.firm_people($1)", [FIRM]);
      expect(people.rows).toEqual([
        { email: "owner@firm.test", role: "owner", status: "active" },
        { email: "staff@firm.test", role: "staff", status: "active" },
        { email: "new@firm.test", role: "manager", status: "invited" },
      ]);
      await actAs(db, OUTSIDER);
      expect((await db.query("select 1 from public.firm_people($1)", [FIRM])).rowCount).toBe(0);
      await actAs(db, NEW);
      expect((await db.query("select 1 from public.firm_people($1)", [FIRM])).rowCount).toBe(0);
    }));

  it("keeps the address lookup for the server only", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect((await attempt(db, "select public.user_id_for_email('new@firm.test')")).ok).toBe(false);
      await asOwner(db);
      await db.query("set local role service_role");
      const found = await db.query("select public.user_id_for_email('NEW@firm.test') as id");
      expect(found.rows[0].id).toBe(NEW);
    }));
});

describe("joining a firm", () => {
  it("shows the invite, not the firm, until the person joins; then the firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await invite(FIRM, NEW, "staff");
      await actAs(db, NEW);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(0);
      const invites = await db.query("select firm_name, role from public.my_invites()");
      expect(invites.rows).toEqual([{ firm_name: "Mehta & Co", role: "staff" }]);
      expect(await accept(FIRM)).toBe(true);
      expect((await db.query("select name from public.firms")).rows).toEqual([{ name: "Mehta & Co" }]);
      expect((await db.query("select 1 from public.my_invites()")).rowCount).toBe(0);
      expect(await logged("member.joined")).toEqual([{ actor_id: NEW, entity_id: NEW }]);
    }));

  it("needs the second sign in step, and works only for one's own invite", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await invite(FIRM, NEW, "staff");
      await actAs(db, NEW, "aal1");
      expect((await db.query("select 1 from public.my_invites()")).rowCount).toBe(0);
      expect(await accept(FIRM)).toBe(false);
      await actAs(db, OUTSIDER);
      expect(await accept(FIRM)).toBe(false);
      expect(await logged("member.joined")).toEqual([]);
    }));

  it("does not bring back someone the owner has removed", () =>
    rollback(db, async () => {
      await seed();
      await db.query("update public.firm_members set status = 'deactivated' where user_id = $1", [STAFF]);
      await actAs(db, STAFF);
      expect(await accept(FIRM)).toBe(false);
      await actAs(db, OWNER);
      expect(await invite(FIRM, STAFF, "staff")).toBe(false);
    }));
});

describe("changing and removing people", () => {
  const call = async (sql: string, person: string) =>
    (await db.query(`select ${sql} as ok`, [FIRM, person])).rows[0].ok;
  const status = async (person: string) => {
    await asOwner(db);
    return (
      await db.query("select role, status from public.firm_members where firm_id = $1 and user_id = $2", [
        FIRM,
        person,
      ])
    ).rows[0];
  };

  it("lets the owner change a role, never to owner, and logs it", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect(await call("public.change_role($1, $2, 'manager')", STAFF)).toBe(true);
      expect(await call("public.change_role($1, $2, 'owner')", STAFF)).toBe(false);
      expect(await status(STAFF)).toEqual({ role: "manager", status: "active" });
      expect(await logged("member.role_changed")).toEqual([{ actor_id: OWNER, entity_id: STAFF }]);
    }));

  it("removes a member, who then sees nothing, and brings them back", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect(await call("public.remove_member($1, $2)", STAFF)).toBe(true);
      expect(await status(STAFF)).toEqual({ role: "staff", status: "deactivated" });
      await actAs(db, STAFF);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(0);
      await actAs(db, OWNER);
      expect(await call("public.change_role($1, $2, 'manager')", STAFF)).toBe(false);
      expect(await call("public.restore_member($1, $2)", STAFF)).toBe(true);
      expect(await status(STAFF)).toEqual({ role: "staff", status: "active" });
      expect(await logged("member.removed")).toHaveLength(1);
      expect(await logged("member.restored")).toHaveLength(1);
    }));

  it("withdraws an invite that was not yet accepted", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await invite(FIRM, NEW, "staff");
      expect(await call("public.remove_member($1, $2)", NEW)).toBe(true);
      expect(await status(NEW)).toBeUndefined();
      await actAs(db, NEW);
      expect((await db.query("select 1 from public.my_invites()")).rowCount).toBe(0);
      expect(await logged("member.invite_withdrawn")).toHaveLength(1);
    }));

  it("lets nobody but the owner do any of it, and not even the owner on their own row", () =>
    rollback(db, async () => {
      await seed();
      for (const [person, aal] of [[STAFF, "aal2"], [OUTSIDER, "aal2"], [OWNER, "aal1"]] as const) {
        await actAs(db, person, aal);
        expect(await call("public.change_role($1, $2, 'manager')", STAFF)).toBe(false);
        expect(await call("public.remove_member($1, $2)", STAFF)).toBe(false);
      }
      await actAs(db, OWNER);
      expect(await call("public.change_role($1, $2, 'staff')", OWNER)).toBe(false);
      expect(await call("public.remove_member($1, $2)", OWNER)).toBe(false);
      // Nor around the functions, where nothing would be logged.
      const direct = "update public.firm_members set role = 'owner' where user_id = $1";
      expect((await attempt(db, direct, [STAFF])).ok).toBe(false);
      expect(await status(STAFF)).toEqual({ role: "staff", status: "active" });
    }));
});
