import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkMailbox, listMail, readThread } from "@/src/lib/mailbox";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Against the GreenMail test mail server (see CI), which makes a mailbox for every address
// it receives mail for, its password the address. Each run uses a mailbox of its own.
const local = { imap: { host: "127.0.0.1", port: 3143 }, smtp: { host: "127.0.0.1", port: 3025 } };
const office = `office-${randomUUID()}@firm.test`;
const setup = `<setup-${randomUUID()}@invented.test>`;
const FIRM = "00000000-0000-4000-8000-0000000006a0";
const OWNER = "00000000-0000-4000-8000-0000000006a1";
const STAFF = "00000000-0000-4000-8000-0000000006a2";

let db: Client;
beforeAll(async () => {
  db = await connect();
  await nodemailer.createTransport({ ...local.smtp, secure: false, ignoreTLS: true }).sendMail({ from: "setup@invented.test", to: office, subject: "Invented test setup", text: "Makes the test mailbox", messageId: setup });
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

describe("the Inbox page's live reads", () => {
  // Timeouts are faked, so a minute idle passes at once.
  beforeAll(() => void vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterAll(() => void vi.useRealTimers());
  const signIns = vi.spyOn(ImapFlow.prototype, "connect");
  beforeEach(() => void signIns.mockClear());
  const list = async (password = office) =>
    expect(await listMail(office, password, local.imap, { inbox: [setup], sent: { limit: 30 } })).toMatchObject(password === office ? { inbox: [{ messageId: setup }] } : { error: "sign_in" });
  it("signs in once and reuses the connection for the next reads", async () => {
    await list();
    expect(await readThread(office, office, local.imap, { box: "inbox", messageId: setup })).toMatchObject({ messages: [{ messageId: setup }] });
    await list();
    expect(signIns).toHaveBeenCalledOnce();
  });
  it("never reuses a session for another password", async () => {
    await list("changed");
    expect(signIns).toHaveBeenCalledOnce();
  });
  it("reads again on a new connection when a kept one has gone stale", async () => {
    vi.spyOn(ImapFlow.prototype, "mailboxOpen").mockRejectedValueOnce(new Error("Connection not available"));
    await list();
    expect(signIns).toHaveBeenCalledOnce();
  });
  it("signs out a connection left a minute idle", async () => {
    const signOuts = vi.spyOn(ImapFlow.prototype, "logout");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signOuts).toHaveBeenCalledOnce();
    await list();
    expect(signIns).toHaveBeenCalledOnce();
  });
});
