import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-0000000008a0";
const OWNER = "00000000-0000-4000-8000-0000000008a1";
const STAFF = "00000000-0000-4000-8000-0000000008a2";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// The proof the app server sends with a request from a confirmed office line.
const proof = (key: string, userId: string, until: number) => `${until}.${createHmac("sha256", key).update(`${userId}::${until}`).digest("hex")}`;
const role = async (headers: Record<string, string> = {}) => {
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
  return (await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role;
};

describe("Office only for staff", () => {
  it("lets staff reach the firm only with the server's proof from the office; the owner is not bound", () =>
    rollback(db, async () => {
      await asOwner(db);
      for (const id of [OWNER, STAFF]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@office.test`]);
      await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Office Firm', '24', 'active', $2)", [FIRM, { office: { on: true, lines: [] } }]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active')", [FIRM, OWNER, STAFF]);
      const key = (await db.query("select public.office_proof_key() as key")).rows[0].key as string;
      const soon = Math.floor(Date.now() / 1000) + 300;

      await actAs(db, OWNER);
      expect(await role()).toBe("owner");
      await actAs(db, STAFF);
      expect(await role()).toBeNull();
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon) })).toBe("staff");
      // Someone else's proof, a made-up one, or one past its time opens nothing.
      expect(await role({ "x-inboxca-office": proof(key, OWNER, soon) })).toBeNull();
      expect(await role({ "x-inboxca-office": proof("0".repeat(64), STAFF, soon) })).toBeNull();
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon - 600) })).toBeNull();
      expect((await db.query("select reason from public.closed_firms()")).rows).toEqual([{ reason: "office" }]);

      // Switched off, staff reach the firm from anywhere again.
      await asOwner(db);
      await db.query("update public.firms set settings = '{}' where id = $1", [FIRM]);
      await actAs(db, STAFF);
      expect(await role()).toBe("staff");
    }));
});
