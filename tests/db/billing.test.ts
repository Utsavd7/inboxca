import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { custom, extraPerson, plans, practices } from "@/content/plans";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Orelu's billing tables and functions (PLAN.md 5.14.1, D33): the owner alone reads the firm's
// plan and payments and nobody changes them but the server; the guarantee is once per firm by
// keyed hashes; admins only see billing, set tax details and start pilots; an unpaid firm closes
// through the same path as a firm its owner closes.
const FIRM = "00000000-0000-4000-8000-0000000b1001";
const OTHER = "00000000-0000-4000-8000-0000000b1002";
const OWNER = "00000000-0000-4000-8000-0000000b1003";
const STAFF = "00000000-0000-4000-8000-0000000b1004";
const OUTSIDER = "00000000-0000-4000-8000-0000000b1005";
const ADMIN = "00000000-0000-4000-8000-0000000b1006";
const session = (id: string) => `${id.slice(0, -3)}c${id.slice(-2)}`;

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users (id, email) values ($1, 'owner@billing.test'), ($2, 'staff@billing.test'), ($3, 'outsider@billing.test'), ($4, 'admin@billing.test')", [OWNER, STAFF, OUTSIDER, ADMIN]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Billing Test Firm', '27', 'active'), ($2, 'Other Billing Firm', '24', 'active')", [FIRM, OTHER]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($4, $5, 'owner', 'active')", [FIRM, OWNER, STAFF, OTHER, OUTSIDER]);
  await db.query("insert into public.subscriptions (firm_id, mandate, cycle, method, status, paid_until, plan) values ($1, 'ib-test-1', 'monthly', 'upi', 'active', current_date + 10, '{\"people\": 3}')", [FIRM]);
  await db.query("insert into public.payments (firm_id, kind, amount_paise, status, doc) values ($1, 'plan', 149900, 'done', '{\"no\": \"RCT/26-27/90001\"}')", [FIRM]);
}

describe("the plan and its payments", () => {
  it("are read by the firm's owner alone, and changed by nobody signed in", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect((await attempt(db, "select mandate, phone_enc from public.subscriptions")).ok).toBe(false);
      expect((await db.query("select plan from public.subscriptions")).rows).toEqual([{ plan: { people: 3 } }]);
      expect((await db.query("select amount_paise from public.payments")).rows).toEqual([{ amount_paise: 149900 }]);
      for (const sql of ["update public.subscriptions set paid_until = current_date + 400", "update public.payments set amount_paise = 1", "insert into public.payments (firm_id, kind, amount_paise) values ($1, 'topup', 1)", "delete from public.payments"])
        expect((await attempt(db, sql, sql.includes("$1") ? [FIRM] : [])).ok).toBe(false);
      expect((await attempt(db, "select fee_paise, provider_ref, details from public.payments")).ok).toBe(false);
      for (const person of [STAFF, OUTSIDER, null]) {
        await actAs(db, person);
        const plans = await attempt(db, "select plan from public.subscriptions");
        const paid = await attempt(db, "select id from public.payments");
        expect([plans.ok ? plans.count : 0, paid.ok ? paid.count : 0]).toEqual([0, 0]);
      }
    }));

  it("numbers each document once", () =>
    rollback(db, async () => {
      await seed();
      expect((await attempt(db, "insert into public.payments (firm_id, kind, amount_paise, status, doc) values ($1, 'renewal', 1, 'done', '{\"no\": \"RCT/26-27/90001\"}')", [FIRM])).ok).toBe(false);
    }));
});

describe("the pricing formula", () => {
  it("holds the business plan's figures the site shows", async () => {
    const { rows: [{ value }] } = await db.query("select value from public.platform_settings where key = 'plan_formula'");
    expect(value.plans.map(({ name, monthly, yearly, maxReturns, people }: Record<string, unknown>) => ({ name, monthly, yearly, maxReturns, people })))
      .toEqual(plans.map(({ name, monthly, yearly, maxReturns, people }) => ({ name, monthly, yearly, maxReturns, people })));
    expect(value.plans.map((plan: { aiCredits: number }) => plan.aiCredits)).toEqual(plans.map((plan) => Number(plan.ai.replace(",", ""))));
    expect(value.practices).toEqual(practices);
    expect(value.extraPerson).toBe(extraPerson);
    const { workSlabs, peopleSlabs, ...rest } = custom;
    expect(value.custom).toMatchObject(rest);
    expect([value.custom.workSlabs, value.custom.peopleSlabs]).toEqual([workSlabs, peopleSlabs].map((slabs) => slabs.map(([upTo, rate]) => [Number.isFinite(upTo) ? upTo : null, rate])));
    expect(value.fitEnforced).toBe(false);
  });
});

describe("the money-back guarantee, once per firm", () => {
  it("keeps keyed hashes only, refuses a second claim from any of them, and is for the server only", () =>
    rollback(db, async () => {
      await asOwner(db);
      await db.query("set local role service_role");
      const claim = async (identities: string[], yes: boolean) => (await db.query("select public.money_back_claim($1, $2) ok", [identities, yes])).rows[0].ok;
      expect(await claim(["email:first@billing.test", "pan:AAAFB1234C"], false)).toBe(true);
      expect(await claim(["email:first@billing.test", "pan:AAAFB1234C"], true)).toBe(true);
      expect(await claim(["email:new@billing.test", "pan:aaafb1234c "], false)).toBe(false);
      expect(await claim(["email:new@billing.test", "PAN:AAAFB1234C"], true)).toBe(false);
      expect(await claim([], true)).toBe(false);
      await asOwner(db);
      const { rows } = await db.query("select identity_hash from public.guarantee_claims where claimed_at > now() - interval '1 minute'");
      expect(rows.map((row) => row.identity_hash).join(" ")).not.toMatch(/billing|AAAFB/i);
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.identity_hash))).toBe(true);
      for (const person of [OWNER, null]) {
        await actAs(db, person);
        expect((await attempt(db, "select public.money_back_claim('{email:x@billing.test}', true)")).ok).toBe(false);
        expect((await attempt(db, "select * from public.guarantee_claims")).ok).toBe(false);
      }
    }));
});

describe("closing an unpaid firm", () => {
  it("closes it as its owner would, keeps the owner, and schedules the deletion 30 days on", () =>
    rollback(db, async () => {
      await seed();
      await asOwner(db);
      await db.query("set local role service_role");
      expect((await db.query("select public.close_unpaid($1, 'unpaid') ok", [FIRM])).rows[0].ok).toBe(false);
      await asOwner(db);
      await db.query("update public.firms set status = 'read_only' where id = $1", [FIRM]);
      await db.query("set local role service_role");
      expect((await attempt(db, "select public.close_unpaid($1, 'because')", [FIRM])).ok).toBe(false);
      expect((await db.query("select public.close_unpaid($1, 'unpaid') ok", [FIRM])).rows[0].ok).toBe(true);
      await asOwner(db);
      expect((await db.query("select status from public.firms where id = $1", [FIRM])).rows[0].status).toBe("closed");
      expect((await db.query("select user_id, status from public.firm_members where firm_id = $1 order by role", [FIRM])).rows).toEqual([{ user_id: OWNER, status: "active" }, { user_id: STAFF, status: "deactivated" }]);
      expect((await db.query("select details from public.activity_log where firm_id = $1 and action = 'firm.closed'", [FIRM])).rows).toEqual([{ details: { reason: "unpaid" } }]);
      expect((await db.query("select run_at > now() + interval '29 days' later from public.jobs where idempotency_key = $1", [`delete_firm:${FIRM}`])).rows).toEqual([{ later: true }]);
      await actAs(db, OWNER);
      expect((await attempt(db, "select public.close_unpaid($1, 'unpaid')", [OTHER])).ok).toBe(false);
    }));
});

describe("Orelu's admins", () => {
  async function asAdmin() {
    await asOwner(db);
    await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [session(ADMIN), ADMIN]);
    await db.query("insert into public.orelu_admins (user_id) values ($1)", [ADMIN]);
    const key = (await db.query("select public.office_proof_key() as key")).rows[0].key;
    const until = Math.floor(Date.now() / 1000) + 600;
    await actAs(db, ADMIN, "aal2", session(ADMIN));
    await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-orelu-admin": `${until}.${createHmac("sha256", key).update(`admin:${ADMIN}:${session(ADMIN)}:${until}`).digest("hex")}` })]);
  }

  it("see payments and refunds by month, save tax details and start a pilot, each logged", () =>
    rollback(db, async () => {
      await seed();
      await db.query("insert into public.payments (firm_id, kind, amount_paise, status, refund_of, reason) select firm_id, 'refund', amount_paise, 'done', id, 'money_back' from public.payments where firm_id = $1", [FIRM]);
      await db.query("update public.firms set status = 'pending' where id = $1", [OTHER]);
      await asAdmin();
      const { rows: [{ billing }] } = await db.query("select public.admin_billing() billing");
      expect(billing.payments.filter((payment: { firm: string }) => payment.firm === "Billing Test Firm")).toHaveLength(2);
      const month = billing.months.find((row: { month: string }) => row.month === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7));
      expect(month.money_back).toBeGreaterThanOrEqual(1);
      expect(billing.payments.find((payment: { kind: string; firm: string }) => payment.firm === "Billing Test Firm" && payment.kind === "plan").refundable).toBe(false);
      expect((await db.query("select public.admin_set_tax($1) ok", [{ legalName: "Invented Orelu", address: "Pune", pan: "AAAFI1234B" }])).rows[0].ok).toBe(true);
      expect((await db.query("select public.admin_pilot($1) ok", [OTHER])).rows[0].ok).toBe(true);
      expect((await db.query("select public.admin_pilot($1) ok", [OTHER])).rows[0].ok).toBe(false);
      await asOwner(db);
      expect((await db.query("select status from public.firms where id = $1", [OTHER])).rows[0].status).toBe("active");
      expect((await db.query("select action, actor_id from public.activity_log where actor_id = $1 order by action", [ADMIN])).rows).toEqual([{ action: "admin.tax_saved", actor_id: ADMIN }, { action: "billing.pilot", actor_id: ADMIN }]);
    }));
});

describe("the daily billing run", () => {
  it("is queued once a day for each firm with a plan or behind on one, and once for Orelu", () =>
    rollback(db, async () => {
      await seed();
      await db.query("select private.queue_billing()");
      await db.query("select private.queue_billing()");
      const { rows } = await db.query("select kind, firm_id from public.jobs where kind in ('billing', 'billing_reconcile') and run_at > now() - interval '1 minute' and (firm_id = any($1) or firm_id is null)", [[FIRM, OTHER]]);
      expect(rows.filter((row) => row.firm_id === FIRM)).toHaveLength(1);
      expect(rows.filter((row) => row.firm_id === OTHER)).toHaveLength(0);
      expect(rows.filter((row) => row.kind === "billing_reconcile").length).toBeLessThanOrEqual(1);
    }));
});
