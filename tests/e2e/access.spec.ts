import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// Access presets, a co-admin, a shared PC and owner recovery (PLAN.md 5.17, 5.17.4 #3,
// #22, #23). Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `access-owner-${tag}@example.test`;
const partnerEmail = `access-partner-${tag}@example.test`;
const key = () => Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const ownerKey = key();
const partnerKey = key();
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let partner: Page;
let partnerId = "";
const settings = async () => (await query(local.dbUrl, "select settings from public.firms where id = $1", [firm.firmId]))[0].settings;

async function signIn(page: Page, email: string, secret: string) {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Access Firm ${tag}`, ownerEmail, ownerKey);
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.createUser({ email: partnerEmail, email_confirm: true });
  partnerId = data.user!.id;
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'partner', 'active')", [firm.firmId, partnerId]);
  await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())", [partnerId, partnerKey]);
  owner = await (await browser.newContext({ extraHTTPHeaders: { "x-test-ip": "203.0.113.30" } })).newPage();
  partner = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove(partnerEmail));

test("the owner chooses a preset in one step, and it sets the office rules", async () => {
  await signIn(owner, ownerEmail, ownerKey);
  await owner.goto("/app/settings#preset");
  const preset = owner.locator("section#preset");
  await expect(preset.getByRole("radio", { name: /^Standard:/ })).toBeChecked();
  await preset.getByRole("radio", { name: /^Office only:/ }).check();
  await preset.getByLabel("Yes, I am in the office now").check();
  await preset.getByRole("button", { name: "Use this preset" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Preset saved." })).toBeVisible();
  await expect(preset.getByRole("radio", { name: /^Office only:/ })).toBeChecked();
  const chosen = await settings();
  expect(chosen.office).toMatchObject({ on: true, away: false, lines: [{ ipv4: "203.0.113.30" }] });
  expect(chosen.access).toEqual({ hours_only: true, idle_minutes: 15 });
  expect(Object.keys(chosen.hours).length).toBeGreaterThan(0);

  await preset.getByRole("radio", { name: /^Standard:/ }).check();
  await preset.getByRole("button", { name: "Use this preset" }).click();
  await expect.poll(async () => (await settings()).office.on).toBe(false);
  expect((await settings()).access).toEqual({ hours_only: false });
});

test("the owner names a co-admin, who changes the access settings but not the owner's", async () => {
  await owner.goto("/app/settings#office");
  await owner.getByLabel("Co-admin").selectOption({ label: partnerEmail });
  await owner.getByRole("button", { name: "Save deputies and co-admin" }).click();
  await expect(owner.getByLabel(partnerEmail, { exact: true })).toBeChecked();
  expect((await settings()).office).toMatchObject({ deputies: [partnerId], co_admin: partnerId });

  await signIn(partner, partnerEmail, partnerKey);
  await partner.goto("/app/settings");
  await expect(partner.getByRole("heading", { name: "Access preset" })).toBeVisible();
  for (const owners of ["Firm email", "Recovery codes", "Close the firm"]) await expect(partner.getByRole("heading", { name: owners })).toHaveCount(0);
  await expect(partner.getByLabel("Co-admin")).toHaveCount(0);
  const preset = partner.locator("section#preset");
  await preset.getByRole("radio", { name: /^Solo CA:/ }).check();
  await preset.getByRole("button", { name: "Use this preset" }).click();
  await expect.poll(async () => (await settings()).office).toMatchObject({ on: true, away: false, co_admin: partnerId });
  expect((await query(local.dbUrl, "select count(*)::int as n from public.activity_log where firm_id = $1 and actor_id = $2 and action = 'office.on'", [firm.firmId, partnerId]))[0].n).toBe(1);
});

test("on a shared PC, the next person's sign in signs the previous one out", async () => {
  const sessions = async () => (await query(local.dbUrl, "select count(*)::int as n from auth.sessions where user_id = $1", [partnerId]))[0].n;
  expect(await sessions()).toBe(1);
  await emailStep(partner, ownerEmail);
  await expect(partner).toHaveURL(/\/sign-in\/two-step$/);
  expect(await sessions()).toBe(0);
});

test("the owner who lost the phone sets up the 2 step code again with a recovery code", async ({ browser, baseURL }) => {
  const download = await owner.request.post("/app/settings/recovery-codes", { headers: { origin: new URL(baseURL!).origin } });
  expect(download.ok()).toBe(true);
  const codes = (await download.text()).match(/^[A-Z2-9]{10}$/gm)!;
  expect(codes).toHaveLength(10);

  const lost = await (await browser.newContext()).newPage();
  await emailStep(lost, ownerEmail);
  await lost.getByText("Lost your phone? Use a recovery code").click();
  await lost.getByLabel("Recovery code").fill("AAAAAAAAAA");
  await lost.getByRole("button", { name: "Use recovery code" }).click();
  await expect(lost.getByText("That recovery code did not work")).toBeVisible();
  await lost.getByLabel("Recovery code").fill(codes[3].toLowerCase());
  await lost.getByRole("button", { name: "Use recovery code" }).click();
  await expect(lost.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  const [user] = await query(local.dbUrl, "select raw_app_meta_data -> 'recovery' as recovery, (select count(*)::int from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as factors from auth.users u where email = $1", [ownerEmail]);
  expect(user).toMatchObject({ factors: 0 });
  expect(user.recovery).toHaveLength(9);
});
