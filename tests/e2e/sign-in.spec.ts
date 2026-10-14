import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { latestEmail, localSupabase, totp } from "./local-supabase";

// Signing in through the real pages against local Supabase: an email code, then a code
// from an authenticator app. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const admin = () =>
  createClient(local.url, local.secretKey, { auth: { persistSession: false } });
const email = `owner-${randomUUID().slice(0, 8)}@example.test`;
let userId = "";
let firmId = "";
let secret = "";
let lastCode = "";
let lastRequest = 0;

// Supabase refuses a second code to the same address within a second or so.
async function askForCode(page: Page) {
  const wait = lastRequest + 2000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
}

test.beforeAll(async () => {
  const { data, error } = await admin().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  const db = new Client({ connectionString: local.dbUrl });
  await db.connect();
  firmId = (
    await db.query(
      "insert into public.firms (name, state_code, status) values ('Test Firm', '27', 'active') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
    [firmId, userId],
  );
  await db.end();
});

test.afterAll(async () => {
  const db = new Client({ connectionString: local.dbUrl });
  await db.connect();
  await db.query("delete from public.firms where id = $1", [firmId]);
  await db.end();
  await admin().auth.admin.deleteUser(userId);
});

// A fresh code, never the one used last: a code is accepted once.
async function nextTotp() {
  let code = totp(secret);
  while (code === lastCode) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    code = totp(secret);
  }
  lastCode = code;
  return code;
}

async function emailStep(page: Page) {
  const sent = Date.now() - 1000;
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(email);
  await askForCode(page);
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  const { code } = await latestEmail(local.mailUrl, email, sent);
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("the app sends a signed out visitor to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("first sign in: email code, then setting up the 2 step code", async ({ page }) => {
  await emailStep(page);
  await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  secret = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  // Next.js keeps its own route announcer as an alert too, so match the message itself.
  await expect(page.getByRole("alert").filter({ hasText: "did not work" })).toBeVisible();
  await page.getByLabel("6 digit code from the app").fill(await nextTotp());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Test Firm");
  await expect(page.locator(".app-role")).toHaveText("You are signed in as owner.");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("next sign in asks for the app's code, and firm data waits for it", async ({ page }) => {
  await emailStep(page);
  await expect(page.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
  await page.getByLabel("6 digit code from the app").fill(await nextTotp());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".app-role")).toHaveText("You are signed in as owner.");
});

test("the link in the email works on the same device", async ({ page, baseURL }) => {
  const sent = Date.now() - 1000;
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(email);
  await askForCode(page);
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  const { link } = await latestEmail(local.mailUrl, email, sent);
  const target = new URL(link!);
  await page.goto(`${baseURL}${target.pathname}${target.search}`);
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
});

test("an unknown address gets the same answer and no email", async ({ page }) => {
  const stranger = `nobody-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(stranger);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(/If .* has an InboxCA account/)).toBeVisible();
  const search = await fetch(
    `${local.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${stranger}"`)}`,
  ).then((response) => response.json());
  expect(search.messages ?? []).toHaveLength(0);
});
