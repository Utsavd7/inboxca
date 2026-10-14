import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

// Office hours, enforced by the database. Times are UTC; India is 5:30 ahead.
const FIRM = "00000000-0000-4000-8000-0000000003a0";
const OWNER = "00000000-0000-4000-8000-0000000003a1";
const STAFF = "00000000-0000-4000-8000-0000000003a2";
const WEDNESDAY_10_30 = "2026-10-14T05:00:00Z";
const WEDNESDAY_18_30 = "2026-10-14T13:00:00Z";
const THURSDAY_10_30 = "2026-10-15T05:00:00Z";
const settings = {
  access: { hours_only: true, roles: { partner: { hours_only: false } } },
  hours: { "3": ["09:00", "18:00"], "4": ["09:00", "18:00"] },
  holidays: ["2026-10-15"],
};

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const open = async (role: string, at: string, person: object | null = null, s: object = settings) =>
  (await db.query("select public.open_to($1, $2, $3, $4) as open", [s, role, person, at])).rows[0].open;

describe("office hours", () => {
  it("open the firm only within the day's hours, and not on a holiday", async () => {
    expect(await open("staff", WEDNESDAY_10_30)).toBe(true);
    expect(await open("staff", WEDNESDAY_18_30)).toBe(false);
    expect(await open("staff", THURSDAY_10_30)).toBe(false);
    expect(await open("staff", "2026-10-18T05:00:00Z")).toBe(false); // Sunday has no hours
  });

  it("follow special hours within their dates, and still close on holidays", async () => {
    const season = { ...settings, special_hours: [{ from: "2026-10-14", to: "2026-10-18", open: "09:00", close: "21:00" }] };
    expect(await open("staff", WEDNESDAY_18_30, null, season)).toBe(true);
    expect(await open("staff", "2026-10-18T13:00:00Z", null, season)).toBe(true); // Sunday, 18:30
    expect(await open("staff", THURSDAY_10_30, null, season)).toBe(false); // a holiday
    expect(await open("staff", "2026-10-19T13:00:00Z", null, season)).toBe(false); // after the range
  });

  it("never lock out the owner, and apply only when the firm switches them on", async () => {
    expect(await open("owner", WEDNESDAY_18_30)).toBe(true);
    expect(await open("staff", WEDNESDAY_18_30, null, { hours: settings.hours })).toBe(true);
  });

  it("let a role or a person be excepted, the most specific setting winning", async () => {
    expect(await open("partner", WEDNESDAY_18_30)).toBe(true);
    expect(await open("staff", WEDNESDAY_18_30, { hours_only: false })).toBe(true);
    expect(await open("partner", WEDNESDAY_18_30, { hours_only: true })).toBe(false);
  });

  it("hide everything outside hours, and say which firm is closed", () =>
    rollback(db, async () => {
      await asOwner(db);
      for (const id of [OWNER, STAFF])
        await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@hours.test`]);
      await db.query(
        "insert into public.firms (id, name, state_code, status, settings) values ($1, 'Hours Firm', '27', 'active', $2)",
        [FIRM, { access: { hours_only: true }, hours: {} }],
      );
      await db.query(
        "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active')",
        [FIRM, OWNER, STAFF],
      );
      await actAs(db, STAFF);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(0);
      expect((await db.query("select firm_name from public.closed_firms()")).rows).toEqual([{ firm_name: "Hours Firm" }]);
      await actAs(db, OWNER);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(1);

      // Every change to the settings is logged, naming what changed.
      await db.query("update public.firms set settings = settings || '{\"holidays\": [\"2026-11-01\"]}' where id = $1", [FIRM]);
      await asOwner(db);
      const log = await db.query("select actor_id, details from public.activity_log where firm_id = $1 and action = 'firm.changed'", [FIRM]);
      expect(log.rows).toEqual([{ actor_id: OWNER, details: { name: false, settings: ["holidays"] } }]);
    }));

  it("hide everything once the 2 step code is older than the firm's session limit", () =>
    rollback(db, async () => {
      await asOwner(db);
      await db.query("insert into auth.users (id, email) values ($1, 'limit@hours.test')", [OWNER]);
      await db.query(
        "insert into public.firms (id, name, state_code, status, settings) values ($1, 'Hours Firm', '27', 'active', $2)",
        [FIRM, { access: { session_hours: 8 } }],
      );
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [FIRM, OWNER]);
      const signedIn = async (hoursAgo: number) => {
        await actAs(db, OWNER);
        const at = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: OWNER, role: "authenticated", aal: "aal2", amr: [{ method: "totp", timestamp: at }] }),
        ]);
      };
      await signedIn(2);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(1);
      await signedIn(9);
      expect((await db.query("select 1 from public.firms")).rowCount).toBe(0);
      expect((await db.query("select reason from public.closed_firms()")).rows).toEqual([{ reason: "session" }]);
    }));
});
