import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// M11: Orelu's admin console shows firm health to a listed admin, never client data, and a
// firm owner cannot open it.
test("an Orelu admin sees firm health and retries a failed job; a firm owner is refused", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const ownerEmail = `admin-owner-${randomUUID()}@invented.test`, adminEmail = `orelu-admin-${randomUUID()}@invented.test`;
  const name = `Invented Admin Firm ${randomUUID().slice(0, 8)}`;
  const firm = await seedFirm(name, ownerEmail, key), setup = await seedFirm("Invented Admin Setup", adminEmail, key);
  const context = await browser.newContext(), owner = await context.newPage();
  try {
    await query(local.dbUrl, "delete from public.firm_members where user_id = $1", [setup.ownerId]);
    await query(local.dbUrl, "insert into public.orelu_admins (user_id) values ($1)", [setup.ownerId]);
    await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, 'Invented Admin Secret Client', 'business')", [firm.firmId]);
    const [{ id: job }] = await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, 'mail_poll', 'account', $2, $3, 'failed', 5, 'mail_unreachable') returning id", [firm.firmId, randomUUID(), `admin-e2e:${randomUUID()}`]);

    await emailStep(owner, ownerEmail);
    await owner.getByLabel("6 digit code from the app").fill(totp(key));
    await owner.getByRole("button", { name: "Continue" }).click();
    await expect(owner).toHaveURL(/\/app$/);
    expect((await owner.goto("/admin/firms"))?.status()).toBe(404);
    await expect(owner.getByText(name)).toHaveCount(0);

    await emailStep(page, adminEmail);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();

    await page.getByRole("link", { name: "Firms" }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Not connected");
    await expect(page.getByText("Invented Admin Secret Client")).toHaveCount(0);

    await page.getByRole("link", { name: "Failed jobs" }).click();
    const failed = page.getByRole("row").filter({ hasText: name });
    await expect(failed).toContainText("mail_unreachable");
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    expect((await query(local.dbUrl, "select state from public.jobs where id = $1", [job]))[0].state).not.toBe("failed");

    await page.getByRole("link", { name: "Due dates" }).click();
    await expect(page.getByRole("row").filter({ hasText: "GSTR1_M" })).toBeVisible();
  } finally {
    await context.close().catch(() => {});
    await query(local.dbUrl, "delete from public.jobs where firm_id = $1", [firm.firmId]);
    await firm.remove();
    await setup.remove();
  }
});
