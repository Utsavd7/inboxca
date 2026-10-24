import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Public sign up makes a pending firm with its active owner and logs what was accepted.
const OWNER = "00000000-0000-4000-8000-0000000002a1";
const ACCEPTED = { terms: "11 Oct 2026", privacy: "11 Oct 2026", dpa: "25 Oct 2026" };

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("sign_up_firm", () => {
  it("makes a pending firm, its owner and the acceptance record in one call", () =>
    rollback(db, async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'new-owner@firm.test')", [OWNER]);
      await db.query("set local role service_role");
      const [{ firm }] = (await db.query("select public.sign_up_firm('New Firm', '27', $1, $2) as firm", [OWNER, ACCEPTED])).rows;
      await asOwner(db);
      const [row] = (await db.query("select name, state_code, status from public.firms where id = $1", [firm])).rows;
      expect(row).toEqual({ name: "New Firm", state_code: "27", status: "pending" });
      const members = (await db.query("select user_id, role, status from public.firm_members where firm_id = $1", [firm])).rows;
      expect(members).toEqual([{ user_id: OWNER, role: "owner", status: "active" }]);
      const [log] = (await db.query("select actor_id, action, details, at from public.activity_log where firm_id = $1", [firm])).rows;
      expect(log).toMatchObject({ actor_id: OWNER, action: "firm.signed_up", details: { accepted: ACCEPTED } });
      expect(log.at).toBeInstanceOf(Date);
    }));

  it("can not be called by visitors or signed in people", () =>
    rollback(db, async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'new-owner@firm.test')", [OWNER]);
      for (const who of [null, OWNER]) {
        await actAs(db, who);
        const result = await attempt(db, "select public.sign_up_firm('Sneaky', '27', $1, '{}')", [OWNER]);
        expect(result.ok).toBe(false);
      }
    }));

  it("refuses a state code that is not two digits, and makes nothing", () =>
    rollback(db, async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'new-owner@firm.test')", [OWNER]);
      const result = await attempt(db, "select public.sign_up_firm('Bad State', 'MH', $1, '{}')", [OWNER]);
      expect(result.ok).toBe(false);
      expect((await db.query("select 1 from public.firm_members where user_id = $1", [OWNER])).rowCount).toBe(0);
    }));
});
