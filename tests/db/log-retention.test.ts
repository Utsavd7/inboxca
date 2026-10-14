import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The activity log keeps each firm's chosen months (12, 24 or 36, default 36) and no more.
// Every check runs inside a transaction that is rolled back.
const SHORT = "00000000-0000-4000-8000-0000000000d1"; // keeps 12 months
const LONG = "00000000-0000-4000-8000-0000000000d2"; // keeps the default 36
const PERSON = "00000000-0000-4000-8000-0000000000d3";
const TODAY = "2026-10-14T12:00:00Z";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query(
    `insert into public.firms (id, name, state_code, status, settings) values
       ($1, 'Short Firm', '27', 'active', '{"activity_log_months": "12"}'),
       ($2, 'Long Firm', '27', 'active', '{}')`,
    [SHORT, LONG],
  );
}

const log = (firm: string, at: string) =>
  db.query("insert into public.activity_log (firm_id, action, at) values ($1, 'x', $2)", [
    firm,
    at,
  ]);
const months = async (firm: string) =>
  (
    await db.query(
      "select to_char(at, 'YYYY-MM') as month from public.activity_log where firm_id = $1 order by at",
      [firm],
    )
  ).rows.map((row) => row.month);
const maintain = (asOf: string) => db.query("select public.maintain_activity_log($1)", [asOf]);
const exists = async (table: string) =>
  (await db.query("select to_regclass($1) is not null as found", [table])).rows[0].found;

describe("the activity log keeps each firm's chosen months", () => {
  it("removes a firm's rows older than its setting, and keeps another firm's", () =>
    rollback(db, async () => {
      await seed();
      for (const firm of [SHORT, LONG])
        for (const at of ["2023-11-15", "2025-09-15", "2025-10-15"]) await log(firm, at);
      await maintain(TODAY);
      expect(await months(SHORT)).toEqual(["2025-10"]);
      expect(await months(LONG)).toEqual(["2023-11", "2025-09", "2025-10"]);
    }));

  it("drops whole months older than the longest setting", () =>
    rollback(db, async () => {
      await seed();
      await maintain("2023-09-10T12:00:00Z"); // makes September and October 2023
      await log(LONG, "2023-10-20");
      await maintain(TODAY);
      expect(await exists("private.activity_log_y2023m09")).toBe(false);
      expect(await exists("private.activity_log_y2023m10")).toBe(true);
      expect(await months(LONG)).toEqual(["2023-10"]);
    }));

  it("makes this month's and next month's partitions, so rows never wait in the default", () =>
    rollback(db, async () => {
      await seed();
      await maintain("2027-03-05T12:00:00Z");
      await log(LONG, "2027-04-01");
      const where = await db.query(
        "select tableoid::regclass::text as part from public.activity_log where firm_id = $1",
        [LONG],
      );
      expect(where.rows[0].part).toBe("private.activity_log_y2027m04");
    }));

  it("leaves the log append only again once it has run", () =>
    rollback(db, async () => {
      await seed();
      await log(LONG, "2026-10-01");
      await maintain(TODAY);
      expect((await attempt(db, "delete from public.activity_log")).ok).toBe(false);
    }));

  it("keeps the partitions and the purge out of reach of everyone else", () =>
    rollback(db, async () => {
      await actAs(db, PERSON);
      expect((await attempt(db, "select 1 from private.activity_log_y2026m10")).ok).toBe(false);
      expect((await attempt(db, "select public.maintain_activity_log()")).ok).toBe(false);
      await asOwner(db);
      await db.query("set local role service_role");
      expect((await attempt(db, "truncate private.activity_log_default")).ok).toBe(false);
      expect((await attempt(db, "select 1 from private.activity_log_y2026m10")).ok).toBe(false);
      expect((await attempt(db, "select public.maintain_activity_log()")).ok).toBe(false);
    }));
});
