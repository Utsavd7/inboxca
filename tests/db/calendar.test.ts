import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The compliance calendar: services on a client's numbers make its tasks.
const FIRM = "00000000-0000-4000-8000-0000000005a0";
const OTHER = "00000000-0000-4000-8000-0000000005b0";
const OWNER = "00000000-0000-4000-8000-0000000005a1";
const STAFF = "00000000-0000-4000-8000-0000000005a2";
const OUTSIDER = "00000000-0000-4000-8000-0000000005b1";
const CLIENT = "00000000-0000-4000-8000-0000000005c1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// A client with a PAN, a Gujarat GSTIN and a TAN.
async function seed() {
  await asOwner(db);
  for (const id of [OWNER, STAFF, OUTSIDER])
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@calendar.test`]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Calendar Firm', '24', 'active'), ($2, 'Other', '27', 'active')", [FIRM, OTHER]);
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($4, $5, 'owner', 'active')",
    [FIRM, OWNER, STAFF, OTHER, OUTSIDER],
  );
  const number = (kind: string, state_code: string | null = null) => ({ kind, number_enc: "sealed", number_bidx: kind, state_code });
  await actAs(db, OWNER);
  await db.query("select public.add_clients($1, $2)", [
    FIRM,
    JSON.stringify([{ id: CLIENT, name: "Mehta Traders", kind: "business", registrations: [number("pan"), number("gstin", "24"), number("tan")] }]),
  ]);
}
const setServices = (kind: string, services: string[]) =>
  attempt(db, "update public.client_registrations set services = $1 where kind = $2", [services, kind]);
// Plans this firm's calendar as of a fixed day, so the expected tasks never move; only this
// firm, so other firms in the shared database (a large scale test firm, say) cost nothing.
async function planAsOf(day: string) {
  await asOwner(db);
  await db.query("delete from public.tasks where firm_id = $1", [FIRM]);
  await db.query("select private.plan_tasks_for(null, $2, $1)", [day, FIRM]);
}
const due = async (code: string) =>
  (await db.query("select period_key, to_char(due_on, 'YYYY-MM-DD') as due_on from public.tasks where firm_id = $2 and code = $1 order by due_on", [code, FIRM])).rows;

describe("the compliance calendar", () => {
  it("gives a client with monthly GST, TDS and a non-audit ITR the right 12 months of tasks", () =>
    rollback(db, async () => {
      await seed();
      for (const [kind, services] of [["gstin", ["GSTR1_M", "GSTR3B_M"]], ["tan", ["TDS_PAY", "TDS_RET"]], ["pan", ["ITR_NA"]]] as const)
        expect((await setServices(kind, [...services])).ok).toBe(true);
      await planAsOf("2026-04-01");
      const counts = await db.query("select code, count(*)::int as n from public.tasks where firm_id = $1 group by code order by code", [FIRM]);
      expect(counts.rows).toEqual([
        { code: "GSTR1_M", n: 12 },
        { code: "GSTR3B_M", n: 12 },
        { code: "ITR_NA", n: 1 },
        { code: "TDS_PAY", n: 12 },
        { code: "TDS_RET", n: 4 },
      ]);
      expect((await due("GSTR3B_M"))[6]).toEqual({ period_key: "2026-09", due_on: "2026-10-20" });
      expect((await due("TDS_PAY"))[0]).toEqual({ period_key: "2026-03", due_on: "2026-04-30" });
      expect(await due("TDS_RET")).toEqual([
        { period_key: "2026-03", due_on: "2026-05-31" },
        { period_key: "2026-06", due_on: "2026-07-31" },
        { period_key: "2026-09", due_on: "2026-10-31" },
        { period_key: "2026-12", due_on: "2027-01-31" },
      ]);
      expect(await due("ITR_NA")).toEqual([{ period_key: "2026-03", due_on: "2026-07-31" }]);
    }));

  it("refuses services on the wrong number or that exclude each other, and dates QRMP GSTR-3B by state", () =>
    rollback(db, async () => {
      await seed();
      expect((await setServices("pan", ["GSTR1_M"])).ok).toBe(false);
      expect((await setServices("gstin", ["GSTR1_M", "GSTR1_Q"])).ok).toBe(false);
      expect((await setServices("gstin", ["GSTR1_Q", "CMP08"])).ok).toBe(false);
      expect((await setServices("gstin", ["GSTR1_Q", "GSTR3B_Q", "PMT06"])).ok).toBe(true);
      await planAsOf("2026-10-01");
      expect((await due("GSTR3B_Q"))[0]).toEqual({ period_key: "2026-09", due_on: "2026-10-22" });
      expect((await due("PMT06")).map((task) => task.period_key)).not.toContain("2026-12");
    }));

  it("lets staff mark a task filed but not move its date; removing a service keeps filed tasks", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await setServices("gstin", ["GSTR1_M", "GSTR3B_M"]);
      await actAs(db, STAFF);
      const filed = await db.query(
        "update public.tasks set status = 'filed', details = '{\"filed_on\": \"2026-10-10\", \"ack\": \"AA2410\"}' where id = (select id from public.tasks where code = 'GSTR1_M' order by due_on limit 1) returning id",
      );
      expect(filed.rowCount).toBe(1);
      expect((await attempt(db, "update public.tasks set due_on = '2030-01-01'")).ok).toBe(false);
      await actAs(db, OWNER);
      await setServices("gstin", ["GSTR3B_M"]);
      expect((await db.query("select status from public.tasks where code = 'GSTR1_M'")).rows).toEqual([{ status: "filed" }]);
      await actAs(db, OUTSIDER);
      expect((await db.query("select 1 from public.tasks")).rowCount).toBe(0);
      await asOwner(db);
      const log = await db.query("select actor_id from public.activity_log where firm_id = $1 and action = 'task.changed'", [FIRM]);
      expect(log.rows).toEqual([{ actor_id: STAFF }]);
    }));

  it("moves a due date only for a verified extension", () =>
    rollback(db, async () => {
      await seed();
      await setServices("gstin", ["GSTR3B_M"]);
      await asOwner(db);
      await db.query("insert into public.compliance_types (code, period_key, due_rule) values ('GSTR3B_M', '2026-09', '{\"on\": \"2026-10-25\"}')");
      await planAsOf("2026-10-01");
      expect((await due("GSTR3B_M"))[0]).toEqual({ period_key: "2026-09", due_on: "2026-10-20" });
      await db.query(
        "update public.compliance_types set source_url = 'https://example.test/notification', verified_on = '2026-10-15', approved_by = 'CA Test' where period_key = '2026-09'",
      );
      await db.query("select private.plan_tasks_for(null, $1, '2026-10-01')", [FIRM]);
      expect((await due("GSTR3B_M"))[0]).toEqual({ period_key: "2026-09", due_on: "2026-10-25" });
    }));

  it("tops up one firm without touching another firm's tasks", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await setServices("gstin", ["GSTR1_M"]);
      await asOwner(db);
      const otherClient = "00000000-0000-4000-8000-0000000005c2";
      await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Other Client', 'business')", [otherClient, OTHER]);
      await db.query(
        "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, services) values ($1, $2, 'gstin', 'sealed', 'other-gstin', '27', '{GSTR1_M}')",
        [OTHER, otherClient],
      );
      await db.query("delete from public.tasks where firm_id in ($1, $2)", [FIRM, OTHER]);
      await db.query("set local role service_role");
      await db.query("select public.calendar_top_up($1, '2026-10-01')", [FIRM]);
      await asOwner(db);
      const counts = await db.query("select firm_id, count(*)::int n from public.tasks where firm_id in ($1, $2) group by firm_id", [FIRM, OTHER]);
      expect(counts.rows).toEqual([{ firm_id: FIRM, n: 12 }]);
    }));
});
