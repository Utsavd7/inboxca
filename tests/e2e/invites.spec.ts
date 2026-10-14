import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { emailStep, latestEmail, localSupabase, seedFirm, totp } from "./local-supabase";

// The owner invites a new person, who signs in from the invite email, sets up a 2 step
// code and joins the firm. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `owner-${tag}@example.test`;
const newEmail = `new-${tag}@example.test`;
// A base32 authenticator key, given to the owner directly so their sign in is quick.
const ownerKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Invite Test Firm", ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove(newEmail));

test("the owner invites a new person, who appears as invited", async () => {
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "People" }).click();
  await expect(owner.getByText(ownerEmail)).toBeVisible();
  await owner.getByLabel("Their work email").fill(newEmail.toUpperCase());
  await owner.getByLabel("Role").selectOption("manager");
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${newEmail}`);
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).toContainText("invited");

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already on your firm's list" })).toBeVisible();
});

test("the invited person signs in from the email, sets up 2 step and joins", async ({ page, baseURL }) => {
  const { link } = await latestEmail(local.mailUrl, newEmail);
  const target = new URL(link!);
  await page.goto(`${baseURL}${target.pathname}${target.search}`);
  await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  const key = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Invite Test Firm has invited you as manager.")).toBeVisible();
  await page.getByRole("button", { name: "Join Invite Test Firm" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
  await expect(page.locator(".app-role")).toHaveText("You are signed in as manager.");
  await expect(page.getByText(/has invited you/)).toHaveCount(0);

  // Only the owner invites.
  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).not.toContainText("invited");
});

test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await row.getByLabel(`Role for ${newEmail}`).selectOption("staff");
  await row.getByRole("button", { name: "Save role" }).click();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");
  await owner.reload();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("removed");
  await row.getByRole("button", { name: "Bring back" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
});
