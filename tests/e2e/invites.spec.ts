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
let person: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Invite Test Firm", ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  person = await (await browser.newContext()).newPage();
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
  await expect(row).toContainText("Invited");

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already on your firm's list" })).toBeVisible();
});

test("the invited person signs in from the email, sets up 2 step and joins", async ({ baseURL }) => {
  const page = person;
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
  await expect(row).not.toContainText("Invited");
});

test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await row.getByLabel(`Role for ${newEmail}`).selectOption("staff");
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save role" }).click(),
  ]);
  await owner.reload();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("Removed");
  await row.getByRole("button", { name: "Bring back" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
});

test("the owner keeps people to office hours, and the person sees the firm is closed", async () => {
  await owner.getByRole("link", { name: "Settings" }).click();
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
    await owner.getByRole("row", { name: new RegExp(day) }).getByLabel("Open", { exact: true }).uncheck();
  await owner.getByLabel(/only during office hours/).check();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");

  await owner.getByLabel("Add a holiday").fill("2026-12-25");
  await owner.getByRole("button", { name: "Add holiday" }).click();
  await expect(owner.getByText("Friday, 25 December 2026")).toBeVisible();

  await person.goto("/app");
  await expect(person.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm is closed now.");
  await owner.goto("/app");
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
});

test("after the firm's idle limit, an unattended screen signs out", async () => {
  await owner.goto("/app/settings");
  await owner.getByLabel(/only during office hours/).uncheck();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");
  await owner.getByLabel("Sign out after no activity for").selectOption("15");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByRole("status")).toHaveText("Signing in limits saved.");

  await person.clock.install();
  await person.goto("/app");
  await expect(person.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
  await person.clock.fastForward("16:00");
  await expect(person).toHaveURL(/\/sign-in\?reason=idle$/);
  await expect(person.getByRole("status")).toContainText("signed out after a while without activity");
  await person.goto("/app");
  await expect(person).toHaveURL(/\/sign-in$/);
});
