import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { askForCode, emailStep, localSupabase, seedFirm, totp } from "./local-supabase";

// Signing in through the real pages against local Supabase: an email code, then a code
// from an authenticator app. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const email = `owner-${randomUUID().slice(0, 8)}@example.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
// The owner's first computer, which approves the next ones (D38).
let first: Page;
let secret = "";
let lastCode = "";

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Test Firm", email);
  first = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove());

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

test("the app sends a signed out visitor to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("first sign in: email code, then setting up the 2 step code", async () => {
  const page = first;
  await emailStep(page, email);
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
  await expect(page.locator(".rail-firm")).toContainText("Test Firm");
  await expect(page.locator(".rail-me")).toContainText("Owner");
  await page.locator(".rail-me").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("next sign in asks for the app's code, and firm data waits for it", async () => {
  const page = first;
  await emailStep(page, email);
  await expect(page.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
  await page.getByLabel("6 digit code from the app").fill(await nextTotp());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".rail-me")).toContainText("Owner");
});

test("a new computer waits, reaching nothing of the firm, until a computer already signed in approves it", async ({ page }) => {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(await nextTotp());
  await page.getByRole("button", { name: "Continue" }).click();
  const waits = page.getByRole("heading", { name: /^Approve this computer/ });
  await expect(waits).toBeVisible();
  await page.goto("/app/clients");
  await expect(waits).toBeVisible();

  await first.goto("/app");
  await first.getByRole("region", { name: "New computer" }).getByRole("button", { name: "Approve" }).click();
  await expect(first.getByRole("region", { name: "New computer" })).toHaveCount(0);
  await page.getByRole("link", { name: "I approved it" }).click();
  await expect(page.locator(".rail-me")).toContainText("Owner");
  await page.goto("/app/clients");
  await expect(page).toHaveURL(/\/app\/clients$/);

  // Removed from the first computer, it is signed out at once and waits for approval again.
  await first.goto("/app/settings?group=access#computers");
  const computers = first.locator("section#computers");
  await expect(computers.getByText("This computer")).toBeVisible();
  await computers.getByRole("button", { name: "Remove and sign out other computers" }).click();
  await expect(computers.getByRole("button", { name: "Remove and sign out other computers" })).toHaveCount(0);
  await page.goto("/app/clients");
  await expect(page).not.toHaveURL(/\/app\/clients$/);
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(await nextTotp());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(waits).toBeVisible();
});

test("the link in the email works on the same device", async ({ page, baseURL }) => {
  const { link } = await askForCode(page, email);
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
