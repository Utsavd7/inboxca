import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-000000000ba0";
const STAFF = "00000000-0000-4000-8000-000000000ba1";
const CLIENT = "00000000-0000-4000-8000-000000000ba2";
const ASK = "00000000-0000-4000-8000-000000000ba3";
const REPLY = "00000000-0000-4000-8000-000000000ba4";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("permission requests", () => {
  it("can be answered only by the server: nobody signed in approves their own, while Done on a team reply still works", () =>
    rollback(db, async () => {
      await asOwner(db);
      await db.query("insert into auth.users (id, email) values ($1, 'staff@permissions.test')", [STAFF]);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Permission Firm', '24', 'active')", [FIRM]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [FIRM, STAFF]);
      await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Patel Textiles', 'company')", [CLIENT, FIRM]);
      await db.query(
        `insert into public.requests (id, firm_id, kind, client_id, entity_type, entity_id, reason_code, status, expires_at, details) values
         ($1, $3, 'permission', $4, 'permission', $1, 'upload', 'pending', now() + interval '4 hours', jsonb_build_object('by', $5::text)),
         ($2, $3, 'team_reply', $4, 'email', $2, 'no_rule', 'pending', null, '{}')`,
        [ASK, REPLY, FIRM, CLIENT, STAFF],
      );
      await actAs(db, STAFF);
      // The staff member sees their question, but cannot approve it.
      expect((await db.query("select status from public.requests where id = $1", [ASK])).rows).toEqual([{ status: "pending" }]);
      const approve = await attempt(db, "update public.requests set status = 'approved' where id = $1", [ASK]);
      expect(approve.ok && approve.count).toBe(0);
      const done = await attempt(db, "update public.requests set status = 'done' where id = $1", [REPLY]);
      expect(done.ok && done.count).toBe(1);
    }));
});
