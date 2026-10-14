import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The client register. Numbers arrive already encrypted by the app; here they are stand-ins.
const FIRM = "00000000-0000-4000-8000-0000000004a0";
const OTHER = "00000000-0000-4000-8000-0000000004b0";
const OWNER = "00000000-0000-4000-8000-0000000004a1";
const STAFF = "00000000-0000-4000-8000-0000000004a2";
const OUTSIDER = "00000000-0000-4000-8000-0000000004b1";
const CLIENT = "00000000-0000-4000-8000-0000000004c1";
const pan = (index: string) => [{ kind: "pan", number_enc: "sealed", number_bidx: index, state_code: null }];

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const id of [OWNER, STAFF, OUTSIDER])
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@clients.test`]);
  await db.query(
    "insert into public.firms (id, name, state_code, status) values ($1, 'Client Firm', '27', 'active'), ($2, 'Other', '24', 'active')",
    [FIRM, OTHER],
  );
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($4, $5, 'owner', 'active')",
    [FIRM, OWNER, STAFF, OTHER, OUTSIDER],
  );
}
const add = async (firm: string, client: string, registrations: object[]) =>
  (await db.query("select public.add_client($1, $2, 'Patel Textiles', 'business', $3) as added", [firm, client, JSON.stringify(registrations)]))
    .rows[0].added;

describe("the client register", () => {
  it("lets the owner add a client with its numbers, logged; staff only view", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF);
      expect(await add(FIRM, CLIENT, pan("i1"))).toBe(false);
      await actAs(db, OWNER);
      expect(await add(FIRM, CLIENT, pan("i1"))).toBe(true);
      await actAs(db, STAFF);
      expect((await db.query("select name from public.clients")).rows).toEqual([{ name: "Patel Textiles" }]);
      expect((await db.query("select kind from public.client_registrations")).rows).toEqual([{ kind: "pan" }]);
      expect((await attempt(db, "insert into public.clients (firm_id, name, kind) values ($1, 'x', 'individual')", [FIRM])).ok).toBe(false);
      await asOwner(db);
      const log = await db.query("select actor_id from public.activity_log where firm_id = $1 and action = 'client.added'", [FIRM]);
      expect(log.rows).toEqual([{ actor_id: OWNER }]);
    }));

  it("keeps each firm's clients to itself, and adds nothing to another firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      expect(await add(OTHER, "00000000-0000-4000-8000-0000000004c2", pan("i2"))).toBe(false);
      await actAs(db, OUTSIDER);
      expect((await db.query("select 1 from public.clients")).rowCount).toBe(0);
      expect((await db.query("select 1 from public.client_registrations")).rowCount).toBe(0);
    }));

  it("refuses the same number twice in one firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("same"));
      const again = await attempt(db, "select public.add_client($1, $2, 'Copy', 'individual', $3)", [
        FIRM,
        "00000000-0000-4000-8000-0000000004c3",
        JSON.stringify(pan("same")),
      ]);
      expect(again).toMatchObject({ ok: false });
    }));
});
