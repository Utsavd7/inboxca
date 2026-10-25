import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// A mailbox connected with Google, Microsoft or Zoho sign in keeps its token as an IMAP
// password is kept: members see only that it is connected, never the credentials.
const FIRM = "00000000-0000-4000-8000-0000000006b0";
const OWNER = "00000000-0000-4000-8000-0000000006b1";
const STAFF = "00000000-0000-4000-8000-0000000006b2";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

it("keeps a sign in mailbox's token from every member, and saves a new one only over the one read", () =>
  rollback(db, async () => {
    await asOwner(db);
    for (const id of [OWNER, STAFF]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@signin.test`]);
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Sign In Firm', '24', 'active')", [FIRM]);
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active')", [FIRM, OWNER, STAFF]);
    const insert = "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc) values ($1, 'mail', $2, 'a', 'token one') returning id";
    expect((await attempt(db, insert, [FIRM, "yahoo"])).ok).toBe(false);
    for (const provider of ["gmail", "outlook"]) {
      const saved = await attempt(db, insert, [FIRM, provider]);
      expect(saved.ok).toBe(true);
      await db.query("delete from public.connected_accounts where firm_id = $1", [FIRM]);
    }
    const [{ id }] = (await db.query(insert, [FIRM, "zoho"])).rows;
    for (const person of [OWNER, STAFF]) {
      await actAs(db, person);
      expect((await attempt(db, "select credentials_enc from public.connected_accounts")).ok).toBe(false);
      expect((await attempt(db, "select settings from public.connected_accounts")).ok).toBe(false);
      expect((await db.query("select provider, status from public.connected_accounts")).rows).toEqual([{ provider: "zoho", status: "connected" }]);
    }
    await asOwner(db);
    const save = "update public.connected_accounts set credentials_enc = $3 where id = $1 and credentials_enc = $2";
    expect((await db.query(save, [id, "token one", "token two"])).rowCount).toBe(1);
    expect((await db.query(save, [id, "token one", "token three"])).rowCount).toBe(0);
    expect((await db.query("select credentials_enc from public.connected_accounts where id = $1", [id])).rows).toEqual([{ credentials_enc: "token two" }]);
  }));
