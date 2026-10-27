import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

// The owner's two meters (PLAN.md 5.14): returns in the firm's year and InboxCA storage.
const FIRM = "00000000-0000-4000-8000-000000000e70";
const OWNER = "00000000-0000-4000-8000-000000000e71";
const CLIENT = "00000000-0000-4000-8000-000000000e72";
const LATER = "00000000-0000-4000-8000-000000000e73";
const DAY = "2026-10-25";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users (id, email) values ($1, 'owner@usage.test')", [OWNER]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Usage Firm', '24', 'active')", [FIRM]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [FIRM, OWNER]);
  await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $3, 'Mehta Traders', 'business'), ($2, $3, 'Shah Exports', 'business')", [CLIENT, LATER, FIRM]);
}
const usage = async (day = DAY) => {
  await actAs(db, OWNER);
  const [row] = (await db.query("select * from public.firm_usage($1, $2)", [FIRM, day])).rows;
  await asOwner(db);
  return row;
};
const task = (due: string, kind = "compliance", code = "GSTR1_M") =>
  db.query("insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, $3, $4, $5, $6)", [FIRM, CLIENT, kind, code, due, due]);

const paper = (id: string, at: string) =>
  db.query("insert into public.documents (id, firm_id, client_id, work_type, document_type, name, size, sha256, drive_file_id, received_at) values ($1, $2, $3, 'gst', 'Sales', 'sales.pdf', 1, 'x', 'drive', $4)", [id, FIRM, CLIENT, at]);

describe("the owner's meters", () => {
  it("count the returns due April to March, and those due so far", () =>
    rollback(db, async () => {
      await seed();
      for (const due of ["2026-03-31", "2026-04-01", "2026-10-25", "2026-10-26", "2027-03-31", "2027-04-01"]) await task(due);
      await task("2026-06-15", "notice", "notice");
      expect(await usage()).toMatchObject({ returns_this_year: 4, returns_so_far: 2 });
      // January to March still belong to the year that began in April.
      expect(await usage("2027-01-15")).toMatchObject({ returns_this_year: 4, returns_so_far: 3 });
    }));

  it("count a client added during the year from that day, and keep an archived client's returns", () =>
    rollback(db, async () => {
      await seed();
      await db.query("insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code) values ($1, $2, 'gstin', 'sealed', 'later', '24')", [FIRM, LATER]);
      await db.query("update public.client_registrations set services = '{GSTR3B_M}' where client_id = $1", [LATER]);
      await db.query("delete from public.tasks where firm_id = $1", [FIRM]);
      await db.query("select public.calendar_top_up($1, $2)", [FIRM, DAY]);
      // October to February's returns, due 20 November to 20 March; nothing before the day added.
      expect(await usage()).toMatchObject({ returns_this_year: 5, returns_so_far: 0 });
      await db.query("update public.clients set archived_at = now() where id = $1", [LATER]);
      await db.query("update public.client_registrations set services = '{GSTR3B_M,GSTR1_M}' where client_id = $1", [LATER]);
      expect(await usage()).toMatchObject({ returns_this_year: 5, returns_so_far: 0 });
    }));

  it("leave the activity log out of InboxCA storage and project it at the last 30 days' pace", () =>
    rollback(db, async () => {
      await seed();
      const before = await usage();
      await db.query("insert into public.activity_log (firm_id, action) select $1, 'client.changed' from generate_series(1, 50)", [FIRM]);
      expect(await usage()).toEqual(before);
      await paper("00000000-0000-4000-8000-000000000e74", "2026-07-01");
      const old = await usage();
      expect(Number(old.workspace_bytes)).toBeGreaterThan(Number(before.workspace_bytes));
      expect(old.workspace_by_march).toBe(old.workspace_bytes);
      await paper("00000000-0000-4000-8000-000000000e75", "2026-10-20");
      const [{ size }] = (await db.query("select pg_column_size(d.*) as size from public.documents d where id = '00000000-0000-4000-8000-000000000e75'")).rows;
      const now = await usage();
      // 157 days from 25 October to 31 March, at this paper's size every 30 days.
      expect(Number(now.workspace_by_march) - Number(now.workspace_bytes)).toBe(Math.floor((size * 157) / 30));
    }));

  it("keep returns already counted when a service is removed or the client deleted, and add a new one", () =>
    rollback(db, async () => {
      await seed();
      await db.query("insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code) values ($1, $2, 'gstin', 'sealed', 'later', '24')", [FIRM, LATER]);
      await db.query("update public.client_registrations set services = '{GSTR3B_M}' where client_id = $1", [LATER]);
      await db.query("delete from public.tasks where firm_id = $1", [FIRM]);
      await db.query("select public.calendar_top_up($1, $2)", [FIRM, DAY]);
      expect(await usage()).toMatchObject({ returns_this_year: 5 });
      await db.query("update public.client_registrations set services = '{}' where client_id = $1", [LATER]);
      expect((await db.query("select count(*)::int as n from public.tasks where client_id = $1", [LATER])).rows[0].n).toBe(0);
      expect(await usage()).toMatchObject({ returns_this_year: 5 });
      await db.query("delete from public.clients where id = $1", [LATER]);
      expect(await usage()).toMatchObject({ returns_this_year: 5 });
      await task("2026-11-20");
      expect(await usage()).toMatchObject({ returns_this_year: 6 });
    }));

  it("leave the first import's papers out of InboxCA storage", () =>
    rollback(db, async () => {
      await seed();
      const before = await usage();
      const imported = "00000000-0000-4000-8000-000000000e76";
      // As the import job does: the paper is entered at 0 bytes before it arrives.
      await db.query("insert into public.usage_ledger (firm_id, due_on, bytes, ref) values ($1, $2, 0, $3)", [FIRM, DAY, imported]);
      await paper(imported, "2026-10-20");
      expect(await usage()).toEqual(before);
      await paper("00000000-0000-4000-8000-000000000e77", "2026-10-20");
      expect(Number((await usage()).workspace_bytes)).toBeGreaterThan(Number(before.workspace_bytes));
    }));

  it("keep papers, email records and client records counted in InboxCA storage after they are deleted", () =>
    rollback(db, async () => {
      await seed();
      const before = await usage();
      await paper("00000000-0000-4000-8000-000000000e78", "2026-10-20");
      const account = (await db.query("insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc) values ($1, 'mail', 'imap', 'sealed', 'sealed') returning id", [FIRM])).rows[0].id;
      await db.query("insert into public.email_events (firm_id, account_id, provider_message_id, sender_bidx, received_at) values ($1, $2, 'm1', 'x', $3)", [FIRM, account, "2026-10-20"]);
      const added = await usage();
      expect(Number(added.workspace_bytes)).toBeGreaterThan(Number(before.workspace_bytes));
      await db.query("delete from public.documents where firm_id = $1", [FIRM]);
      await db.query("delete from public.email_events where firm_id = $1", [FIRM]);
      expect(await usage()).toEqual(added);
      // A paper from last year is not this year's.
      await paper("00000000-0000-4000-8000-000000000e79", "2026-03-20");
      expect(await usage()).toEqual(added);
      // A deleted client's record stays counted on the day it went (to within the few header
      // bytes a row loses when the delete reads it back), and is not growth.
      const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const held = await usage(now);
      const { size } = (await db.query("select sum(pg_column_size(c.*))::int as size from public.clients c where firm_id = $1", [FIRM])).rows[0];
      await db.query("delete from public.clients where firm_id = $1", [FIRM]);
      const after = await usage(now);
      expect(Math.abs(Number(after.workspace_bytes) - Number(held.workspace_bytes))).toBeLessThan(size / 10);
      expect(Number(after.workspace_by_march) - Number(after.workspace_bytes)).toBe(Number(held.workspace_by_march) - Number(held.workspace_bytes));
    }));
});
