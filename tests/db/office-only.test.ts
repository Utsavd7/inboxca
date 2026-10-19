import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-0000000008a0";
const OWNER = "00000000-0000-4000-8000-0000000008a1";
const STAFF = "00000000-0000-4000-8000-0000000008a2";
const PARTNER = "00000000-0000-4000-8000-0000000008a3";
const OTHER_FIRM = "00000000-0000-4000-8000-0000000008b0";
const OTHER = "00000000-0000-4000-8000-0000000008b1";

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
      for (const id of [OWNER, STAFF, PARTNER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@office.test`]);
      await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Office Firm', '24', 'active', $2)", [FIRM, { office: { on: true, lines: [] } }]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($1, $4, 'partner', 'active')", [FIRM, OWNER, STAFF, PARTNER]);
      const key = (await db.query("select public.office_proof_key() as key")).rows[0].key as string;
      const soon = Math.floor(Date.now() / 1000) + 300;

      await actAs(db, OWNER);
      expect(await role()).toBe("owner");
      await actAs(db, STAFF);
      await db.query("select set_config('request.headers', '{}', true)");
      expect(await role()).toBeNull();
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon) })).toBe("staff");
      // Someone else's proof, a made-up one, or one past its time opens nothing.
      expect(await role({ "x-inboxca-office": proof(key, OWNER, soon) })).toBeNull();
      expect(await role({ "x-inboxca-office": proof("0".repeat(64), STAFF, soon) })).toBeNull();
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon - 600) })).toBeNull();
      expect((await db.query("select reason from public.closed_firms()")).rows).toEqual([{ reason: "office" }]);

      // At aal1 the office proof replaces the phone code only for bound roles.
      await actAs(db, STAFF, "aal1");
      expect(await role()).toBeNull();
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon) })).toBe("staff");
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon - 600) })).toBeNull();

      // The firm's session limit uses the email code time for this aal1 session.
      await asOwner(db);
      await db.query("update public.firms set settings = $2 where id = $1", [FIRM, { office: { on: true, lines: [] }, access: { session_hours: 1 } }]);
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: STAFF, role: "authenticated", aal: "aal1", amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) - 7200 }] })]);
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon) })).toBeNull();
      await actAs(db, OWNER, "aal1");
      expect(await role({ "x-inboxca-office": proof(key, OWNER, soon) })).toBeNull();
      await actAs(db, PARTNER, "aal1");
      expect(await role({ "x-inboxca-office": proof(key, PARTNER, soon) })).toBeNull();

      // Switched off, the phone code is required and then staff reach the firm anywhere.
      await asOwner(db);
      await db.query("update public.firms set settings = '{}' where id = $1", [FIRM]);
      await actAs(db, STAFF, "aal1");
      expect(await role({ "x-inboxca-office": proof(key, STAFF, soon) })).toBeNull();
      await actAs(db, STAFF);
      expect(await role()).toBe("staff");
    }));
});

describe("approved PCs", () => {
  it("shows a firm's PCs only to its members and lets no signed in person write them", () =>
    rollback(db, async () => {
      await asOwner(db);
      for (const id of [STAFF, OTHER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@devices.test`]);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'First Firm', '24', 'active'), ($2, 'Other Firm', '27', 'active')", [FIRM, OTHER_FIRM]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active'), ($3, $4, 'staff', 'active')", [FIRM, STAFF, OTHER_FIRM, OTHER]);
      await db.query("insert into public.devices (firm_id, token_hash, name) values ($1, $2, 'Chrome on Windows'), ($3, $4, 'Safari on Mac')", [FIRM, "a".repeat(64), OTHER_FIRM, "b".repeat(64)]);

      await actAs(db, STAFF);
      await db.query("select set_config('request.headers', '{}', true)");
      expect((await db.query("select name from public.devices order by name")).rows).toEqual([{ name: "Chrome on Windows" }]);
      expect((await attempt(db, "insert into public.devices (firm_id, token_hash, name) values ($1, $2, 'Made up')", [FIRM, "c".repeat(64)])).ok).toBe(false);
      expect((await attempt(db, "update public.devices set status = 'refused' where firm_id = $1", [FIRM])).ok).toBe(false);
      expect((await attempt(db, "delete from public.devices where firm_id = $1", [FIRM])).ok).toBe(false);

      await actAs(db, OTHER);
      await db.query("select set_config('request.headers', '{}', true)");
      expect((await db.query("select name from public.devices")).rows).toEqual([{ name: "Safari on Mac" }]);

      // A refusal and its activity entry are one database operation.
      await asOwner(db);
      const device = (await db.query("select id from public.devices where firm_id = $1", [FIRM])).rows[0].id;
      await db.query("select public.review_devices($1, $2, $3, 'refuse')", [FIRM, STAFF, device]);
      expect((await db.query("select status, kind from public.devices where id = $1", [device])).rows).toEqual([{ status: "refused", kind: null }]);
      expect((await db.query("select actor_id, action from public.activity_log where entity_id = $1", [device])).rows).toEqual([{ actor_id: STAFF, action: "device.refused" }]);
    }));
});
