import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkMailbox } from "@/src/lib/mailbox";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Against the GreenMail test mail server (see CI), which makes a mailbox for every address
// it receives mail for, its password the address. Each run uses a mailbox of its own.
const local = { imap: { host: "127.0.0.1", port: 3143 }, smtp: { host: "127.0.0.1", port: 3025 } };
const office = `office-${randomUUID()}@firm.test`;
const FIRM = "00000000-0000-4000-8000-0000000006a0";
const OWNER = "00000000-0000-4000-8000-0000000006a1";
const STAFF = "00000000-0000-4000-8000-0000000006a2";

let db: Client;
beforeAll(async () => {
  db = await connect();
  await nodemailer.createTransport({ ...local.smtp, secure: false, ignoreTLS: true }).sendMail({ from: "setup@invented.test", to: office, subject: "Invented test setup", text: "Makes the test mailbox" });
});
afterAll(async () => {
  await db.end();
});

describe("connecting the firm's mailbox", () => {
  it("signs in to both servers and starts reading from the next new message", async () => {
    expect(await checkMailbox(office, office, local)).toEqual({ cursor: expect.stringMatching(/^\d+:\d+$/) });
  });
  it("says when the password is wrong", async () => {
    expect(await checkMailbox(office, "wrong", local)).toEqual({ error: "sign_in" });
  });
  it("refuses a server on a private network", async () => {
    expect(await checkMailbox(office, office, { ...local, imap: { host: "10.0.0.5", port: 993 } })).toEqual({ error: "server" });
  });
  it("lets only the owner connect, and never lets anyone read the saved password back", () =>
    rollback(db, async () => {
      await asOwner(db);
      for (const id of [OWNER, STAFF]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@mail.test`]);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Mail Firm', '24', 'active')", [FIRM]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active')", [FIRM, OWNER, STAFF]);
      const insert = "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc) values ($1, 'mail', 'imap', 'a', 'c')";
      await actAs(db, STAFF);
      expect((await attempt(db, insert, [FIRM])).ok).toBe(false);
      await actAs(db, OWNER);
      expect((await attempt(db, insert, [FIRM])).ok).toBe(true);
      expect((await attempt(db, "select credentials_enc from public.connected_accounts")).ok).toBe(false);
      await actAs(db, STAFF);
      expect((await db.query("select status from public.connected_accounts")).rows).toEqual([{ status: "connected" }]);
    }));
});
