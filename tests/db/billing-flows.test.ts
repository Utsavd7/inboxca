import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeCashfree } from "../fake-cashfree";
import { connect } from "./db";

// Orelu's billing end to end against a fake Cashfree on this machine (PLAN.md 5.14.1, D33): sign
// up to activation, the renewal with its 25 hour notice, a failed eNACH debit retried by Orelu,
// a cancel from the UPI app, an upgrade order, add-ons only after capture, the money back with
// its refund receipt or credit note, an admin's refund and the reconciliation. The app's own
// code runs through local Supabase's API, as on the server; each firm is made here and removed.
const env = Object.fromEntries((existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const ready = !!env.SUPABASE_URL && !!env.SUPABASE_SECRET_KEY && !!env.LOCAL_KEK;
const keys = { CASHFREE_APP_ID: randomBytes(12).toString("base64url"), CASHFREE_SECRET_KEY: randomBytes(24).toString("base64url") };
Object.assign(process.env, { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY, LOCAL_KEK: env.LOCAL_KEK, APP_BASE_URL: "http://127.0.0.1:9600", CASHFREE_ENV: "sandbox", ...keys });
delete process.env.SYSTEM_MAIL_URL;

const billing = await import("@/src/lib/billing/billing");
const money = await import("@/src/lib/billing/money");
const { POST } = await import("@/app/api/webhooks/cashfree/route");
const { supabaseAdmin } = await import("@/src/lib/supabase");

let last: { raw: string; headers: Record<string, string> } | null = null;
const hook = (raw: string, headers: Record<string, string>) => POST(new NextRequest("http://127.0.0.1:9600/api/webhooks/cashfree", { method: "POST", body: raw, headers }));
const fake = fakeCashfree(keys, async (raw, headers) => {
  last = { raw, headers };
  const answer = await hook(raw, headers);
  if (answer.status !== 200) throw new Error(`webhook ${answer.status}`);
});

const run = randomUUID().slice(0, 8);
const made: { id: string; owner: string }[] = [];
let db: Client;
let saved: { key: string; value: unknown }[] = [];
const today = () => money.indiaDay(new Date());
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const returnUrl = "http://127.0.0.1:9600/api/billing/return";
const tax = { legalName: "Invented Orelu Partners", address: "1 Invented Road, Pune", pan: "AAAFI1234B", turnover: {} };
const pan = () => `${randomBytes(5).toString("hex").replace(/[^a-f]/g, "").padEnd(5, "q").slice(0, 5).toUpperCase()}${String(Math.floor(1000 + Math.random() * 9000))}Q`;

beforeAll(async () => {
  if (!ready) return;
  db = await connect();
  saved = (await db.query("select key, value from public.platform_settings where key in ('tax', 'billing')")).rows;
  await db.query("insert into public.platform_settings (key, value) values ('tax', $1) on conflict (key) do update set value = excluded.value", [tax]);
  await fake.listen();
  process.env.CASHFREE_TEST_URL = fake.url;
});
afterAll(async () => {
  if (!ready) return;
  for (const { id, owner } of made) {
    await db.query("delete from public.payments where firm_id = $1", [id]);
    await db.query("with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where id = $1 and exists (select 1 from gone)", [id]);
    await supabaseAdmin().auth.admin.deleteUser(owner);
  }
  await db.query("delete from public.platform_settings where key in ('tax', 'billing')");
  for (const { key, value } of saved) await db.query("insert into public.platform_settings (key, value) values ($1, $2)", [key, value]);
  await db.end();
  await fake.close();
});

async function newFirm(tag: string, { state = "27", gstin }: { state?: string; gstin?: string } = {}) {
  const { data } = await supabaseAdmin().auth.admin.createUser({ email: `billing-${tag}-${run}@example.test`, email_confirm: true });
  const owner = data.user!.id;
  const { id } = await one("insert into public.firms (name, state_code, gstin, status) values ($1, $2, $3, 'pending') returning id", [`Billing Flow ${tag} ${run}`, gstin ? null : state, gstin ?? null]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [id, owner]);
  made.push({ id, owner });
  return { id: id as string, owner };
}
const solo = { clients: 60, practice: "mixed" as const, people: 1, aiBlocks: 0 };
const subOf = (firm: string) => one("select mandate, cycle, method, status, plan, paid_until::text from public.subscriptions where firm_id = $1", [firm]);
const paymentsOf = (firm: string, kind?: string) => db.query(`select * from public.payments where firm_id = $1 ${kind ? "and kind = $2" : ""} order by created_at`, kind ? [firm, kind] : [firm]).then((result) => result.rows);
const statusOf = async (firm: string) => (await one("select status from public.firms where id = $1", [firm])).status;
async function activeFirm(tag: string, plan = solo, method: "upi" | "card" | "enach" = "upi", place?: { state?: string; gstin?: string }) {
  const firm = await newFirm(tag, place);
  const checkout = await billing.startAutoPay(firm.id, firm.owner, { plan, cycle: "monthly", method, phone: "9876543210", address: "2 Invented Lane, Pune", returnUrl });
  expect(checkout).toMatchObject({ kind: "mandate" });
  const { mandate } = await subOf(firm.id);
  await fake.authorise(mandate, method);
  if (method === "enach") await fake.charge((await paymentsOf(firm.id, "plan"))[0].id, "SUCCESS");
  return { ...firm, mandate: mandate as string };
}

describe.skipIf(!ready)("billing against a fake Cashfree", () => {
  it("signs a firm up: AutoPay with the price from the formula, and the signed webhook alone activates it, once", async () => {
    const firm = await newFirm("upi");
    const checkout = await billing.startAutoPay(firm.id, firm.owner, { plan: solo, cycle: "monthly", method: "upi", phone: "9876543210", address: "2 Invented Lane, Pune", returnUrl });
    expect(checkout).toMatchObject({ kind: "mandate", session: expect.stringContaining("session-") });
    const sub = await subOf(firm.id);
    expect(fake.subscriptions.get(sub.mandate)).toMatchObject({ authorization_details: { authorization_amount: 1499, authorization_amount_refund: false, payment_methods: ["upi"] }, customer_details: { customer_phone: "9876543210" } });
    expect(fake.calls.find((call) => call.path === "/pg/plans" && call.body.plan_id === `plan-${sub.mandate}`)?.body).toMatchObject({ plan_type: "ON_DEMAND", plan_max_amount: 2998 });
    expect(await statusOf(firm.id)).toBe("pending");
    // A method the amount does not allow, and a webhook nobody signed, change nothing.
    expect(await billing.startAutoPay(firm.id, firm.owner, { plan: { ...solo, clients: 700, people: 40 }, cycle: "yearly", method: "upi", phone: "9876543210", address: "x x x x x", returnUrl })).toEqual({ error: "Choose one of the ways to pay shown." });
    const forged = await hook(JSON.stringify({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: sub.mandate, subscription_status: "ACTIVE" } } }), { "x-webhook-timestamp": "1", "x-webhook-signature": randomBytes(32).toString("base64") });
    expect(forged.status).toBe(401);
    expect(await statusOf(firm.id)).toBe("pending");

    await fake.authorise(sub.mandate, "upi");
    expect(await statusOf(firm.id)).toBe("active");
    const [first] = await paymentsOf(firm.id);
    expect(first).toMatchObject({ kind: "plan", status: "done", amount_paise: 149_900, gst_paise: 0, provider_ref: `auth-${sub.mandate}` });
    expect(first.doc).toMatchObject({ kind: "receipt", no: expect.stringMatching(/^RCT\/\d{2}-\d{2}\/\d{5}$/), total: 149_900, seller: { pan: "AAAFI1234B" }, buyer: { address: "2 Invented Lane, Pune" } });
    expect(await subOf(firm.id)).toMatchObject({ status: "active", method: "upi", paid_until: money.addMonths(today(), 1) });
    // The same webhook again: applied once.
    await hook(last!.raw, last!.headers);
    const { rows: logged } = await db.query("select action from public.activity_log where firm_id = $1 and action like 'billing.%' order by at", [firm.id]);
    expect(logged.map((row) => row.action)).toEqual(["billing.autopay_started", "billing.autopay_on", "billing.paid"]);
    expect(await paymentsOf(firm.id)).toHaveLength(1);
  });

  it("raises the renewal 3 days ahead, at least 25 hours before the debit, once, and moves the plan on when it is paid", async () => {
    const firm = await activeFirm("renew");
    const due = money.addDays(today(), 2);
    await db.query("update public.subscriptions set paid_until = $2 where firm_id = $1", [firm.id, due]);
    await billing.dailyBilling(firm.id);
    await billing.dailyBilling(firm.id);
    const [renewal] = await paymentsOf(firm.id, "renewal");
    expect(await paymentsOf(firm.id, "renewal")).toHaveLength(1);
    expect(renewal).toMatchObject({ status: "created", amount_paise: 149_900, details: { via: "charge", period: [due, money.addMonths(due, 1)] } });
    expect(renewal.due_at.getTime() - Date.now()).toBeGreaterThanOrEqual(25 * 3_600_000);
    expect(fake.charges.get(renewal.id)).toMatchObject({ subscription_id: firm.mandate, payment_type: "CHARGE", payment_amount: 1499 });
    expect(Date.parse(fake.charges.get(renewal.id)!.payment_schedule_date)).toBe(renewal.due_at.getTime());
    await fake.charge(renewal.id, "SUCCESS");
    expect((await subOf(firm.id)).paid_until).toBe(money.addMonths(due, 1));
    expect((await paymentsOf(firm.id, "renewal"))[0].doc).toMatchObject({ kind: "receipt" });
  });

  it("debits eNACH once the bank confirms, and after a failed renewal tries again on day 1, not day 2, then turns read only on day 8", async () => {
    const firm = await activeFirm("enach", { clients: 700, practice: "mixed", people: 40, aiBlocks: 0 }, "enach");
    expect(fake.subscriptions.get(firm.mandate)!.authorization_details.authorization_amount).toBe(0);
    expect(await statusOf(firm.id)).toBe("active");
    expect((await paymentsOf(firm.id, "plan"))[0]).toMatchObject({ status: "done", amount_paise: 1_549_900 });
    const due = today();
    await db.query("update public.subscriptions set paid_until = $2 where firm_id = $1", [firm.id, due]);
    await billing.dailyBilling(firm.id);
    const [renewal] = await paymentsOf(firm.id, "renewal");
    await fake.charge(renewal.id, "FAILED");
    expect(await statusOf(firm.id)).toBe("grace");
    await billing.dailyBilling(firm.id, new Date(Date.now() + 86_400_000));
    const retries = await paymentsOf(firm.id, "renewal");
    expect(retries.map((row) => row.status)).toEqual(["failed", "created"]);
    expect(fake.charges.has(retries[1].id)).toBe(true);
    await billing.dailyBilling(firm.id, new Date(Date.now() + 2 * 86_400_000));
    expect(await paymentsOf(firm.id, "renewal")).toHaveLength(2);
    await billing.dailyBilling(firm.id, new Date(Date.now() + 8 * 86_400_000));
    expect(await statusOf(firm.id)).toBe("read_only");
  });

  it("stops AutoPay when the owner cancels in the UPI app, calling off the debit raised", async () => {
    const firm = await activeFirm("cancel");
    await db.query("update public.subscriptions set paid_until = $2 where firm_id = $1", [firm.id, money.addDays(today(), 1)]);
    await billing.dailyBilling(firm.id);
    await fake.cancelByCustomer(firm.mandate);
    expect((await subOf(firm.id)).status).toBe("cancelled");
    expect((await paymentsOf(firm.id, "renewal")).map((row) => row.status)).toEqual(["cancelled"]);
    expect((await one("select details from public.activity_log where firm_id = $1 and action = 'billing.autopay_cancelled'", [firm.id])).details).toEqual({ by: "bank" });
  });

  it("charges an upgrade's difference for the rest of the period as an order, and adds people and AI only once paid", async () => {
    const firm = await activeFirm("upgrade");
    const sub = await subOf(firm.id);
    const growth = { clients: 150, practice: "mixed" as const, people: 4, aiBlocks: 0 };
    expect(await billing.buy(firm.id, firm.owner, { kind: "upgrade", plan: growth }, returnUrl)).toMatchObject({ kind: "order" });
    const [upgrade] = await paymentsOf(firm.id, "upgrade");
    expect(upgrade.amount_paise).toBe(money.prorate(349_900 - 149_900, today(), sub.paid_until, "monthly"));
    expect(fake.orders.get(upgrade.id)).toMatchObject({ order_amount: upgrade.amount_paise / 100, order_currency: "INR" });
    expect((await subOf(firm.id)).plan.clients).toBe(60);
    await fake.pay(upgrade.id);
    expect((await subOf(firm.id)).plan).toMatchObject({ clients: 150, people: 4 });

    // Growth takes up to 10 people, so one more is the 11th, paid for the rest of the period.
    expect(await billing.teamSize(firm.id)).toBe(10);
    await billing.buy(firm.id, firm.owner, { kind: "extra_user" }, returnUrl);
    await billing.buy(firm.id, firm.owner, { kind: "topup" }, returnUrl);
    const [person] = await paymentsOf(firm.id, "extra_user");
    const [topup] = await paymentsOf(firm.id, "topup");
    expect([person.status, topup.status, (await subOf(firm.id)).plan.people]).toEqual(["created", "created", 4]);
    await fake.pay(person.id);
    await fake.pay(topup.id);
    expect((await subOf(firm.id)).plan.people).toBe(11);
    expect((await paymentsOf(firm.id, "topup"))[0]).toMatchObject({ status: "done", amount_paise: 39_900, doc: { kind: "receipt" } });
    expect(await billing.teamSize(firm.id)).toBe(11);
  });

  it("gives the first payment back within 14 days, once, with a refund receipt, and refuses the same PAN later", async () => {
    const shared = pan();
    const firm = await activeFirm("back", solo, "upi", { gstin: `27${shared}1Z5` });
    expect((await billing.moneyBack(firm.id, money.addDays(today(), 15))).state).toBe("late");
    fake.settleRefunds(null);
    expect(await billing.claimMoneyBack(firm.id, firm.owner)).toBeNull();
    expect(await billing.claimMoneyBack(firm.id, firm.owner)).toBeNull();
    const refunds = await paymentsOf(firm.id, "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: "money_back", status: "created", amount_paise: 149_900 });
    expect(fake.refunds.get(refunds[0].id)).toMatchObject({ subscription_id: firm.mandate, payment_id: `auth-${firm.mandate}`, refund_amount: 1499, refund_speed: "STANDARD" });
    expect([await statusOf(firm.id), (await subOf(firm.id)).status, fake.subscriptions.get(firm.mandate)!.status]).toEqual(["read_only", "cancelled", "CANCELLED"]);
    expect((await billing.moneyBack(firm.id)).state).toBe("refunding");
    await fake.refund(refunds[0].id, "SUCCESS");
    const [done] = await paymentsOf(firm.id, "refund");
    const [first] = await paymentsOf(firm.id, "plan");
    expect(done).toMatchObject({ status: "done", doc: { kind: "refund", no: expect.stringMatching(/^RFD\//), of: { no: first.doc.no } } });

    const again = await activeFirm("back-again", solo, "upi", { gstin: `24${shared}1Z5` });
    expect((await billing.moneyBack(again.id)).state).toBe("used");
    expect(await billing.claimMoneyBack(again.id, again.owner)).toMatch(/already had its money back/);
  });

  it("issues a tax invoice from the GST start date, IGST to another state, and a credit note for its refund", async () => {
    await db.query("update public.platform_settings set value = $1 where key = 'tax'", [{ ...tax, gstin: "27AAAFI1234B1Z5", stateCode: "27", sac: "9983", rate: 18, gstFrom: today(), signatory: "Invented Signatory" }]);
    try {
      const local = await activeFirm("gst-same");
      expect((await paymentsOf(local.id, "plan"))[0]).toMatchObject({ amount_paise: 176_882, gst_paise: 26_982, doc: { kind: "invoice", cgst: 13_491, sgst: 13_491, igst: 0, rate: 18, sac: "9983", seller: { gstin: "27AAAFI1234B1Z5" } } });
      const away = await activeFirm("gst-away", solo, "upi", { state: "24" });
      const [invoice] = await paymentsOf(away.id, "plan");
      expect(invoice.doc).toMatchObject({ kind: "invoice", no: expect.stringMatching(/^INV\//), cgst: 0, sgst: 0, igst: 26_982 });
      fake.settleRefunds("SUCCESS");
      await billing.claimMoneyBack(away.id, away.owner);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect((await paymentsOf(away.id, "refund"))[0]).toMatchObject({ status: "done", gst_paise: 26_982, doc: { kind: "credit", no: expect.stringMatching(/^CN\//), igst: 26_982, of: { no: invoice.doc.no }, reason: "money_back", signatory: "Invented Signatory" } });
    } finally {
      fake.settleRefunds(null);
      await db.query("update public.platform_settings set value = $1 where key = 'tax'", [tax]);
    }
  });

  it("lets an admin give back a payment taken twice, keeps Cashfree's fees, and alerts on what does not match", async () => {
    const firm = await activeFirm("admin");
    await billing.buy(firm.id, firm.owner, { kind: "topup" }, returnUrl);
    const [topup] = await paymentsOf(firm.id, "topup");
    await fake.pay(topup.id);
    expect(await billing.adminRefund(topup.id, firm.owner, "duplicate")).toBe(true);
    expect(await billing.adminRefund(topup.id, firm.owner, "duplicate")).toBe(false);
    const [refund] = await paymentsOf(firm.id, "refund");
    expect(fake.refunds.get(refund.id)).toMatchObject({ via: "order", order_id: topup.id, refund_amount: 399 });
    await fake.refund(refund.id, "SUCCESS");
    expect((await paymentsOf(firm.id, "refund"))[0]).toMatchObject({ status: "done", reason: "duplicate", doc: { kind: "refund" } });

    fake.recon.push(
      { event_details: { event_type: "PAYMENT", event_status: "SUCCESS", event_amount: 399, event_service_charge: 7.5, event_service_tax: 1.35 }, order_details: { order_id: topup.id }, payment_details: { cf_payment_id: `cf-${topup.id}` }, settlement_details: { settlement_date: "2026-10-28T18:30:00+05:30" } },
      { event_details: { event_type: "PAYMENT", event_status: "SUCCESS", event_amount: 10, event_service_charge: 0, event_service_tax: 0 }, order_details: { order_id: `unknown-${run}` }, payment_details: { cf_payment_id: `unknown-${run}` }, settlement_details: {} },
    );
    await billing.reconcile();
    expect((await paymentsOf(firm.id, "topup"))[0]).toMatchObject({ fee_paise: 750, fee_tax_paise: 135, settled_at: expect.any(Date) });
    const { value } = await one("select value from public.platform_settings where key = 'billing'");
    expect(value.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "unknown_at_provider", ref: `unknown-${run}` })]));
  });

  it("keeps auto top-up off until the owner sets a limit, then debits one block on the mandate after the notice", async () => {
    const firm = await activeFirm("auto");
    expect(await billing.autoTopUp(firm.id)).toBe(false);
    await billing.setAutoTopUp(firm.id, 1);
    expect(await billing.autoTopUp(firm.id)).toBe(true);
    expect(await billing.autoTopUp(firm.id)).toBe(false);
    const [topup] = await paymentsOf(firm.id, "topup");
    expect(topup.due_at.getTime() - Date.now()).toBeGreaterThanOrEqual(25 * 3_600_000);
    expect(fake.charges.get(topup.id)).toMatchObject({ subscription_id: firm.mandate, payment_amount: 399 });
  });
});
