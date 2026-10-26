import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// A branch's own office, PCs and hours (PLAN.md 5.17.4 #13), Remote friendly's approved
// devices and India only, and the policy tester (5.17). Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `branch-owner-${tag}@example.test`;
const staffEmail = `branch-staff-${tag}@example.test`;
const key = () => Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const ownerKey = key();
const staffKey = key();
const BRANCH_IP = "198.51.100.5";
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
let staffId = "";
let branchId = "";
const settingsOf = async (table: "firms" | "groups", id: string) => (await query(local.dbUrl, `select settings from public.${table} where id = $1`, [id]))[0].settings;

async function signIn(page: Page, email: string, secret: string) {
  await emailStep(page, email);
  // A code typed in a 30 second step's last moments can reach the server in the next one.
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 4_000) await page.waitForTimeout(left + 250);
  await page.getByLabel("6 digit code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Branch Firm ${tag}`, ownerEmail, ownerKey);
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.createUser({ email: staffEmail, email_confirm: true });
  staffId = data.user!.id;
  [{ id: branchId }] = await query(local.dbUrl, "insert into public.groups (firm_id, kind, name) values ($1, 'branch', 'Pune') returning id", [firm.firmId]);
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status, branch_id) values ($1, $2, 'staff', 'active', $3)", [firm.firmId, staffId, branchId]);
  await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())", [staffId, staffKey]);
  owner = await (await browser.newContext({ extraHTTPHeaders: { "x-test-ip": BRANCH_IP } })).newPage();
  staff = await (await browser.newContext({ extraHTTPHeaders: { "x-test-ip": "203.0.113.99" } })).newPage();
});
test.afterAll(() => firm.remove(staffEmail));

test("the owner turns Office only on for one branch, and its staff are checked against that office", async () => {
  await signIn(owner, ownerEmail, ownerKey);
  await owner.goto("/app/settings?group=access#office");
  // The office picker applies by itself; its Show button is there only for screen readers.
  await owner.getByLabel("Office", { exact: true }).selectOption({ label: "Pune" });
  await expect(owner).toHaveURL(new RegExp(`/app/settings\\?group=access&branch=${branchId}#office$`));
  await expect(owner.getByText("Pune follows the main office")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Show", exact: true })).toHaveClass("sr-only");
  await owner.locator("#office details.office-switch > summary").click();
  await owner.getByLabel("Yes, I am in the office now").check();
  // Turn on sits outside the preset's form and still shows it is saving.
  await owner.route(/\/app\/settings/, async (route) => {
    if (route.request().headers()["next-action"]) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await owner.getByRole("button", { name: "Turn on" }).click();
  await expect(owner.locator('button[form="preset-form"]')).toHaveAttribute("aria-busy", "true");
  await expect(owner.getByRole("status").filter({ hasText: "On." })).toContainText("You are on your office internet connection now.");
  await owner.unroute(/\/app\/settings/);
  expect((await settingsOf("groups", branchId)).office).toMatchObject({ on: true, lines: [{ ipv4: BRANCH_IP }] });
  expect((await settingsOf("firms", firm.firmId)).office).toBeUndefined();

  // Away from the branch's office the branch's staff are kept out; there, their PC waits for the owner.
  await signIn(staff, staffEmail, staffKey);
  await expect(staff.getByRole("heading", { name: "Use InboxCA from your office." })).toBeVisible();
  await staff.setExtraHTTPHeaders({ "x-test-ip": BRANCH_IP });
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  // The PC is the branch's: it waits under Pune, not under the main office.
  await owner.goto(`/app/settings?group=access&branch=${branchId}`);
  await expect(owner.getByRole("heading", { name: "PCs waiting for approval" })).toBeVisible();
  await expect(owner.getByText(/^Branch on .+, first seen today$/)).toBeVisible();
  await owner.goto("/app/settings?group=access#office");
  await expect(owner.getByRole("heading", { name: "PCs waiting for approval" })).toHaveCount(0);
  await query(local.dbUrl, "update public.devices set status = 'approved', kind = 'office' where firm_id = $1", [firm.firmId]);
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // Out of the branch, the person follows the firm, which has no Office only.
  await query(local.dbUrl, "update public.firm_members set branch_id = null where user_id = $1", [staffId]);
  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99" });
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
});

test("a branch follows the main office again in one press", async () => {
  await owner.goto(`/app/settings?group=access&branch=${branchId}#office`);
  await expect(owner.getByText("Pune has its own Office only switch, connections and PCs.")).toBeVisible();
  await owner.getByRole("button", { name: "Follow the main office" }).click();
  await expect(owner.getByText("Pune follows the main office")).toBeVisible();
  expect((await settingsOf("groups", branchId)).office).toBeUndefined();
  // Its PC now belongs to the main office.
  expect(await query(local.dbUrl, "select branch_id from public.devices where firm_id = $1", [firm.firmId])).toEqual([{ branch_id: null }]);
});

test("a branch keeps its own office hours until it goes back to the main office's", async () => {
  const allWeek = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), ["00:00", "23:59"]]));
  await query(local.dbUrl, "update public.firms set settings = settings || $2 where id = $1", [firm.firmId, { hours: allWeek, access: { hours_only: true } }]);
  await query(local.dbUrl, "update public.firm_members set branch_id = $2 where user_id = $1", [staffId, branchId]);
  await owner.goto("/app/settings?group=hours");
  await owner.getByLabel("Office", { exact: true }).selectOption({ label: "Pune" });
  await expect(owner).toHaveURL(new RegExp(`/app/settings\\?group=hours&branch=${branchId}#hours$`));
  await expect(owner.getByText("Pune uses the main office's hours, holidays and special hours")).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Office hours for Pune" })).toBeVisible();
  // Pune closes every day; whether hours apply stays the main office's switch.
  await expect(owner.getByLabel("Everyone except you can use InboxCA only during office hours, and not on holidays")).toHaveCount(0);
  for (const open of await owner.locator("section#hours").getByRole("checkbox", { name: "Open" }).all()) await open.uncheck();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Office hours saved." })).toBeVisible();
  expect((await settingsOf("groups", branchId)).hours).toEqual({});
  expect((await settingsOf("firms", firm.firmId)).hours).toEqual(allWeek);

  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: /is closed now\.$/ })).toBeVisible();
  await owner.getByRole("button", { name: "Use the main office's hours" }).click();
  await expect(owner.getByText("Pune uses the main office's hours, holidays and special hours")).toBeVisible();
  expect((await settingsOf("groups", branchId)).hours).toBeUndefined();
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await query(local.dbUrl, "update public.firm_members set branch_id = null where user_id = $1", [staffId]);
});

test("Remote friendly lets staff in only on approved devices, with the 2 step code, and only from India", async ({ browser }) => {
  await owner.goto("/app/settings#preset");
  const preset = owner.locator("section#preset");
  await preset.getByRole("radio", { name: /^Remote friendly:/ }).check();
  await preset.getByRole("button", { name: "Use this preset" }).click();
  await expect.poll(async () => (await settingsOf("firms", firm.firmId)).access?.india_only).toBe(true);
  expect((await settingsOf("firms", firm.firmId)).office).toMatchObject({ on: true, anywhere: true, away: false });
  await expect(preset.getByRole("radio", { name: /^Remote friendly:/ })).toBeChecked();
  // Office hours stay out of this test.
  await query(local.dbUrl, "update public.firms set settings = jsonb_set(settings, '{access,hours_only}', 'false') where id = $1", [firm.firmId]);

  // The owner has no country header here and still works.
  await owner.goto("/app/clients");
  await expect(owner.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // The staff member's approved PC works from any connection, only from India.
  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99", "x-test-country": "US" });
  await staff.goto("/app/clients");
  await expect(staff).toHaveURL(/\/sign-in\?reason=country$/);
  await expect(staff.getByText("Your firm allows InboxCA only from India.")).toBeVisible();

  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99", "x-test-country": "IN" });
  await signIn(staff, staffEmail, staffKey);
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // A new laptop at home waits for the owner, who allows it in one press.
  const laptop = await (await browser.newContext({ extraHTTPHeaders: { "x-test-ip": "192.0.2.44", "x-test-country": "IN" } })).newPage();
  await signIn(laptop, staffEmail, staffKey);
  await expect(laptop.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  await owner.goto("/app/settings?group=access#office");
  await expect(owner.locator("#office").getByText("Approved devices only is on")).toBeAttached();
  await expect(owner.getByRole("button", { name: "Stays in the office" })).toHaveCount(0);
  await owner.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "PCs waiting for approval" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select kind from public.devices where firm_id = $1 order by kind", [firm.firmId])).toEqual([{ kind: "laptop" }, { kind: "office" }]);
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await laptop.context().close();
});

test("the owner checks whether someone can use InboxCA now, from here, on this PC", async () => {
  await owner.goto("/app/settings?group=access");
  const tester = owner.locator("section#tester");
  await tester.getByLabel("Person").selectOption({ label: staffEmail });
  await tester.getByRole("button", { name: "Check" }).click();
  await expect(owner).toHaveURL(new RegExp(`check=${staffId}`));
  // The owner's own browser is not one of the firm's approved devices.
  await expect(tester.getByRole("status")).toHaveText("No. Branch cannot use InboxCA now, from here, on this PC. This PC is not approved for your firm yet.");
  await tester.getByLabel("Person").selectOption({ label: ownerEmail });
  await tester.getByRole("button", { name: "Check" }).click();
  await expect(tester.getByRole("status")).toHaveText("Yes. Branch can use InboxCA now, from here, on this PC.");
});
