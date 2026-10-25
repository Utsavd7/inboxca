import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// A branch's own office (PLAN.md 5.17.4 #13) and Remote friendly's India only (5.17).
// Skipped when local Supabase is not running.
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
  await owner.getByLabel("Office", { exact: true }).selectOption({ label: "Pune" });
  await owner.getByRole("button", { name: "Show" }).click();
  await expect(owner.getByText("Pune follows the main office")).toBeVisible();
  await owner.locator("#office details.office-switch > summary").click();
  await owner.getByLabel("Yes, I am in the office now").check();
  await owner.getByRole("button", { name: "Turn on" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "On." })).toContainText("You are on your office internet connection now.");
  expect((await settingsOf("groups", branchId)).office).toMatchObject({ on: true, lines: [{ ipv4: BRANCH_IP }] });
  expect((await settingsOf("firms", firm.firmId)).office).toBeUndefined();

  // Away from the branch's office the branch's staff are kept out; there, their PC waits for the owner.
  await signIn(staff, staffEmail, staffKey);
  await expect(staff.getByRole("heading", { name: "Use InboxCA from your office." })).toBeVisible();
  await staff.setExtraHTTPHeaders({ "x-test-ip": BRANCH_IP });
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  await query(local.dbUrl, "update public.devices set status = 'approved', kind = 'office' where firm_id = $1", [firm.firmId]);
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // Out of the branch, the person follows the firm, which has no Office only.
  await query(local.dbUrl, "update public.firm_members set branch_id = null where user_id = $1", [staffId]);
  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99" });
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
});

test("Remote friendly lets everyone but the owner use InboxCA only from India", async () => {
  await owner.goto("/app/settings#preset");
  const preset = owner.locator("section#preset");
  await preset.getByRole("radio", { name: /^Remote friendly:/ }).check();
  await preset.getByRole("button", { name: "Use this preset" }).click();
  await expect.poll(async () => (await settingsOf("firms", firm.firmId)).access?.india_only).toBe(true);
  // Office hours stay out of this test.
  await query(local.dbUrl, "update public.firms set settings = jsonb_set(settings, '{access,hours_only}', 'false') where id = $1", [firm.firmId]);

  // The owner has no country header here and still works.
  await owner.goto("/app/clients");
  await expect(owner.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99", "x-test-country": "US" });
  await staff.goto("/app/clients");
  await expect(staff).toHaveURL(/\/sign-in\?reason=country$/);
  await expect(staff.getByText("Your firm allows InboxCA only from India.")).toBeVisible();

  await staff.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.99", "x-test-country": "IN" });
  await signIn(staff, staffEmail, staffKey);
  await staff.goto("/app/clients");
  await expect(staff.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
});
