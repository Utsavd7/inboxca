import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { chosenPlan, formulaSchema, indiaDay, rupees, taxSchema, withGst, type Cycle } from "@/src/lib/billing/money";
import { CASHFREE_KEYS, CASHFREE_TEST_URL } from "../../playwright.config";
import { fakeCashfree } from "../fake-cashfree";
import { addPerson, appKey, emailStep, latestEmail, localSupabase, query, seedFirm, systemMail, totp } from "./local-supabase";

// Orelu's billing through the real pages, with payments on and Cashfree a fake on this machine
// (PLAN.md 5.14.1, D33): a new firm signs up and is held at the plan and payment step, owner and
// staff alike, until the owner chooses a plan, sees the billing code's price and GST, and sets up
// AutoPay in the fake's checkout; the signed webhook makes it active and opens the app. Each sign
// in step fits a laptop screen. Settings, Billing lists its receipt and turns
// AutoPay off; past its monthly share of returns with its year still within the plan, Today offers
// yearly payment and one payment switches it; once the year passes the plan, Today offers the plan
// that fits and one payment moves it up; the money comes back within 14 days with the 2 step code;
// the admin console shows the refund by month and reason. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
// One worker, as the fake Cashfree has one port.
test.describe.configure({ mode: "serial", timeout: 120_000 });
// The owner uses one computer throughout, as each new one waits for the owner's approval (D38).
test.use({ storageState: { cookies: [{ name: "inboxca_device", value: randomBytes(32).toString("hex"), domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] } });

const tag = randomUUID().slice(0, 8);
const email = `billing-${tag}@example.test`;
const staff = `billing-staff-${tag}@example.test`;
const firmName = `Billing Firm ${tag}`;
let origin = "";
const fake = fakeCashfree(CASHFREE_KEYS, (raw, headers) => fetch(`${origin}/api/webhooks/cashfree`, { method: "POST", body: raw, headers }));
const tax = { legalName: "Invented Orelu Partners", address: "1 Invented Road, Pune", pan: "AAAFI1234B", turnover: {} };
let saved: { value: unknown }[] = [];
let secret = "";
let lastStep = 0;
// A fresh 2 step code: one not used in this 30 second step already.
async function code() {
  while (Math.floor(Date.now() / 30_000) === lastStep) await new Promise((resolve) => setTimeout(resolve, 1000));
  lastStep = Math.floor(Date.now() / 30_000);
  return totp(secret);
}
const firm = async () => (await query(local.dbUrl, "select f.id, f.status, s.status as autopay, s.mandate from public.firms f left join public.subscriptions s on s.firm_id = f.id where f.name = $1", [firmName]))[0];

test.beforeAll(async ({ baseURL }) => {
  origin = baseURL!;
  await fake.listen(Number(new URL(CASHFREE_TEST_URL).port));
  fake.settleRefunds("SUCCESS");
  saved = await query(local.dbUrl, "select value from public.platform_settings where key = 'tax'");
  await query(local.dbUrl, "insert into public.platform_settings (key, value) values ('tax', $1) on conflict (key) do update set value = excluded.value", [tax]);
});
test.afterAll(async () => {
  await fake.close();
  if (saved[0]) await query(local.dbUrl, "update public.platform_settings set value = $1 where key = 'tax'", [saved[0].value]);
  else await query(local.dbUrl, "delete from public.platform_settings where key = 'tax'");
  await query(local.dbUrl, "delete from public.payments where firm_id in (select id from public.firms where name = $1)", [firmName]);
  await query(local.dbUrl, "with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where name = $1 and exists (select 1 from gone)", [firmName]);
  await query(local.dbUrl, "delete from auth.users where email = any($1)", [[email, staff]]);
});

// Each sign in step and the plan and payment step fit a 1280 by 720 laptop screen: nothing scrolls.
const fits = async (page: Page) => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
// What the plan and payment step must show for a plan on the site's price list: worked out by
// the billing code from the server's formula, for a firm in Maharashtra.
async function priceOf(plan: string, cycle: Cycle, taxNow: unknown) {
  const formula = formulaSchema.parse((await query(local.dbUrl, "select value from public.platform_settings where key = 'plan_formula'"))[0].value);
  return withGst(chosenPlan(formula, { plan, cycle })!.price.paise, taxSchema.parse(taxNow), "27", indiaDay(new Date()));
}

test("a new firm signs up, pays before anything opens, and the webhook opens the app", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await fits(page);
  await page.getByLabel("Firm name").fill(firmName);
  await page.getByLabel("Your work email").fill(email);
  await page.getByLabel("State").selectOption({ label: "Maharashtra" });
  await page.getByRole("checkbox").check();
  const sent = Date.now() - 1000;
  await page.getByRole("button", { name: "Sign up" }).click();
  const { code: emailed } = await latestEmail(local.mailUrl, email, sent);
  await page.getByLabel("Code from the email").fill(emailed);
  await fits(page);
  await page.getByRole("button", { name: "Continue" }).click();
  secret = (await page.locator(".secret").textContent())!.trim();
  await fits(page);
  await page.getByLabel("6 digit code from the app").fill(await code());
  await page.getByRole("button", { name: "Continue" }).click();

  // Nothing opens before the first payment: every page of the app sends to plan and payment.
  await expect(page).toHaveURL(/\/start$/);
  await page.goto("/app/clients");
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByText(`${firmName} opens on InboxCA`)).toBeVisible();
  await fits(page);
  // Someone else in the firm waits for the owner.
  const staffKey = appKey();
  await addPerson((await firm()).id, staff, "staff", staffKey);
  const other = await browser.newContext();
  try {
    const them = await other.newPage();
    await emailStep(them, staff);
    await them.getByLabel("6 digit code from the app").fill(totp(staffKey));
    await them.getByRole("button", { name: "Continue" }).click();
    await expect(them.getByRole("heading", { name: "Your firm starts once its owner chooses a plan" })).toBeVisible();
    await them.goto("/app/clients");
    await expect(them).toHaveURL(/\/start$/);
    await expect(them.getByRole("button", { name: "Pay and start" })).toHaveCount(0);
    await fits(them);
  } finally {
    await other.close();
  }

  // The price, GST and total are the billing code's for the plan and payment period chosen.
  const withTax = { ...tax, gstin: "27AAAFI1234B1Z5", stateCode: "27", sac: "9983", rate: 18, gstFrom: indiaDay(new Date()) };
  await query(local.dbUrl, "update public.platform_settings set value = $1 where key = 'tax'", [withTax]);
  const choose = async (nav: string, name: string | RegExp) => {
    const link = page.getByRole("navigation", { name: nav }).getByRole("link", { name });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "true");
  };
  await choose("Plans", "Growth");
  await choose("How often to pay", /Yearly/);
  const growth = await priceOf("growth", "yearly", withTax);
  const price = page.locator(".start-price");
  await expect(price.locator(".start-total dd")).toHaveText(rupees(growth.total));
  await expect(price).toContainText(rupees(growth.taxable));
  await expect(price).toContainText(rupees(growth.gst));
  await fits(page);
  await query(local.dbUrl, "update public.platform_settings set value = $1 where key = 'tax'", [tax]);
  await choose("Plans", "Solo");
  await choose("How often to pay", "Monthly");
  const solo = await priceOf("solo", "monthly", tax);
  await expect(price.locator(".start-total dd")).toHaveText(rupees(solo.total));
  expect(solo.gst).toBe(0);
  await expect(page.getByRole("radio", { name: /UPI AutoPay/ })).toBeChecked();
  await expect(page.getByText("Orelu will never take more than ₹2,998 at a time without asking you.")).toBeVisible();
  await page.getByLabel("Mobile number for AutoPay messages").fill("9876543210");
  await page.getByLabel("Firm address, for receipts").fill("2 Invented Lane, Pune");
  expect((await firm()).status).toBe("pending");
  await page.getByRole("button", { name: "Pay and start" }).click();

  // The fake's checkout authorises at once and sends the signed webhook; back from it, the firm
  // is open and Today shows its setup.
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings?group=billing");
  await expect(page.getByText(/Paid until/)).toBeVisible();
  await expect(page.getByText(/AutoPay is on with your UPI AutoPay/)).toBeVisible();
  expect(await firm()).toMatchObject({ status: "active", autopay: "active" });
  expect(fake.subscriptions.get((await firm()).mandate)).toMatchObject({ authorization_details: { authorization_amount: 1499, payment_methods: ["upi"] } });
  await expect.poll(() => systemMail(email), { timeout: 15_000 }).toContain("Payment receipt RCT/");
});

test("Settings, Billing lists the receipt and turns AutoPay off", async ({ page }) => {
  await page.goto("/sign-in");
  await fits(page);
  await emailStep(page, email);
  await expect(page.getByLabel("6 digit code from the app")).toBeVisible();
  await fits(page);
  await page.getByLabel("6 digit code from the app").fill(await code());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings?group=billing");
  const receipts = page.locator("section#receipts");
  await expect(receipts.getByText(/Payment receipt RCT\//)).toBeVisible();
  await expect(receipts.getByText("Paid", { exact: true })).toBeVisible();
  const href = await receipts.getByRole("link", { name: "Open" }).getAttribute("href");
  const receipt = await page.request.get(href!);
  expect(await receipt.text()).toContain("Orelu is not registered under GST, so no GST is charged.");
  expect(await receipt.text()).toContain("2 Invented Lane, Pune");

  await page.locator("section#plan summary", { hasText: "Turn AutoPay off" }).click();
  await page.locator("section#plan").getByRole("button", { name: "Turn AutoPay off" }).click();
  await expect(page.getByText("AutoPay is off. Nothing more will be taken.").first()).toBeVisible();
  expect((await firm()).autopay).toBe("cancelled");
  expect(fake.subscriptions.get((await firm()).mandate)!.status).toBe("CANCELLED");
  await expect(page.getByRole("button", { name: "Turn AutoPay on" })).toBeVisible();
});

test("Today offers a seasonal monthly payer yearly payment, not a bigger plan; once its year passes the plan, one payment moves it up", async ({ page }) => {
  // Returns due so far: all that a Solo plan paid monthly has given by this month, and the year's
  // returns within Solo's 800 (5.14, D38).
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const months = ((Number(day.slice(5, 7)) + 8) % 12) + 1;
  const due = async (n: number, on = day) => query(local.dbUrl, "insert into public.usage_ledger (firm_id, due_on) select $1, $2::date from generate_series(1, $3)", [(await firm()).id, on, n]);
  await due(Math.ceil((800 * months) / 12));
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(await code());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const card = page.getByRole("region", { name: "Your plan" });
  await expect(card.getByRole("button", { name: /move up/ })).toHaveCount(0);
  await card.getByRole("button", { name: /switch to yearly payment/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\?group=billing&saved=checkout/);
  await expect.poll(async () => (await query(local.dbUrl, "select s.cycle from public.subscriptions s join public.payments p on p.firm_id = s.firm_id and p.kind = 'yearly' and p.status = 'done' where s.firm_id = $1", [(await firm()).id]))[0]?.cycle).toBe("yearly");

  // Returns still due by March take the year past Solo.
  await due(400, `${Number(day.slice(0, 4)) + (months > 9 ? 0 : 1)}-03-31`);
  await page.goto("/app");
  await expect(card).toContainText("Growth");
  await card.getByRole("button", { name: /move up/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\?group=billing&saved=checkout/);
  await expect.poll(async () => (await query(local.dbUrl, "select status from public.payments where kind = 'upgrade' and firm_id = $1", [(await firm()).id]))[0]?.status).toBe("done");
  await page.reload();
  await expect(page.locator("section#plan")).toContainText("Growth");
  await expect(page.locator("section#fit")).toHaveCount(0);
});

test("the owner gets the money back within 14 days with the 2 step code, and the firm can only view", async ({ page }) => {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(await code());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings?group=billing");
  const back = page.locator("section#money_back");
  await expect(back.getByText(/within 14 days of your first payment/)).toBeVisible();
  await back.locator("summary", { hasText: "Cancel and get my money back" }).click();
  await back.getByLabel("6 digit code from your authenticator app").fill("000000");
  await back.getByRole("button", { name: "Cancel and get my money back" }).click();
  await expect(back.getByRole("alert")).toContainText("That code did not work");
  await back.getByLabel("6 digit code from your authenticator app").fill(await code());
  await back.getByRole("button", { name: "Cancel and get my money back" }).click();
  await expect(page).toHaveURL(/saved=money_back/);
  await expect(page.getByText("Your firm can only view for now", { exact: false })).toBeVisible();
  expect((await firm()).status).toBe("read_only");
  // The fake gives the refunds back a moment later, by its signed webhook: the first payment, the
  // switch to yearly payment and the move up of the same 14 days.
  await expect.poll(async () => (await query(local.dbUrl, "select status from public.payments where kind = 'refund' and firm_id = $1", [(await firm()).id])).map((row) => row.status).join(), { timeout: 15_000 }).toBe("done,done,done");
  await page.reload();
  await expect(page.locator("section#receipts").getByText(/Refund receipt RFD\//)).toHaveCount(3);
  await expect(page.locator("section#receipts").getByText("Given back")).toHaveCount(3);
  await expect(page.locator("section#money_back").getByText("your money was given back")).toBeVisible();
});

// A listed Orelu admin signed in with a passkey, on localhost (passkeys need a domain).
async function signedInAdmin(browser: Browser, baseURL: string) {
  const key = appKey(), address = `orelu-admin-${randomUUID()}@invented.test`;
  const setup = await seedFirm("Invented Billing Admin Setup", address, key);
  await query(local.dbUrl, "delete from public.firm_members where user_id = $1", [setup.ownerId]);
  await query(local.dbUrl, "insert into public.orelu_admins (user_id) values ($1)", [setup.ownerId]);
  const context = await browser.newContext({ baseURL: baseURL.replace("127.0.0.1", "localhost") });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await emailStep(page, address);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Set up a passkey" }).click();
  await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();
  return { page, close: async () => { await context.close().catch(() => {}); await setup.remove(); } };
}

test("the admin console shows the refund by month and reason, and the tax details", async ({ browser, baseURL }) => {
  const admin = await signedInAdmin(browser, baseURL!);
  try {
    await admin.page.goto("/admin/billing");
    await expect(admin.page.getByRole("heading", { name: "Billing" })).toBeVisible();
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
    const row = admin.page.locator("section[aria-label='Refunds by month'] tr").filter({ hasText: month });
    await expect(row).toBeVisible();
    const payments = admin.page.locator("section[aria-label='Payments'] tr").filter({ hasText: firmName });
    await expect(payments.filter({ hasText: "Refund, Money back within 14 days of the first payment" })).toHaveCount(3);
    await expect(payments.filter({ hasText: /First payment/ })).toBeVisible();
    await expect(admin.page.getByLabel("Legal name")).toHaveValue(tax.legalName);
  } finally {
    await admin.close();
  }
});
