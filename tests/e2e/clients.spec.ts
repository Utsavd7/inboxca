import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { emailStep, localSupabase, seedFirm, totp } from "./local-supabase";

// Adding and finding clients, with numbers encrypted by the firm's key. Skipped when local
// Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ownerEmail = `clients-${randomUUID().slice(0, 8)}@example.test`;
const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Client Test Firm", ownerEmail, key);
  owner = await (await browser.newContext()).newPage();
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(key));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
});
test.afterAll(() => firm.remove());

test("a client added with only a GSTIN gets its PAN too, and opens with both", async () => {
  await owner.getByRole("link", { name: "Clients" }).click();
  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles");
  await owner.getByLabel("Kind", { exact: true }).selectOption("business");
  await owner.getByLabel("GSTIN, if any").fill("27aapfu0939f1zv");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Patel Textiles");
  await expect(owner.getByRole("listitem").filter({ hasText: "PAN" })).toContainText("AAPFU0939F");
  await expect(owner.getByRole("listitem").filter({ hasText: "GSTIN" })).toContainText("27AAPFU0939F1ZV");
});

test("search finds a client by name or by its whole PAN, and the same PAN is refused twice", async () => {
  await owner.goto("/app/clients");
  for (const search of ["patel", "aapfu0939f"]) {
    await owner.getByLabel("Find by name, PAN or GSTIN").fill(search);
    await owner.getByRole("button", { name: "Find" }).click();
    await expect(owner.getByRole("link", { name: "Patel Textiles" })).toBeVisible();
  }
  await owner.getByLabel("Name", { exact: true }).fill("Copy");
  await owner.getByLabel("PAN", { exact: true }).fill("AAPFU0939F");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already in your firm" })).toBeVisible();
  await owner.getByLabel("GSTIN, if any").fill("27AAPFU0939F1ZW");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "GSTIN is not valid" })).toBeVisible();
});
