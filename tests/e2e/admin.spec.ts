import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// M11: Orelu's admin console shows firm health to a listed admin, never client data, and a
// firm owner cannot open it.
test("an Orelu admin signs in with a passkey, sees firm health and retries a failed job; a firm owner is refused", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const ownerEmail = `admin-owner-${randomUUID()}@invented.test`, adminEmail = `orelu-admin-${randomUUID()}@invented.test`, otherEmail = `orelu-admin-${randomUUID()}@invented.test`;
  const name = `Invented Admin Firm ${randomUUID().slice(0, 8)}`;
  const firm = await seedFirm(name, ownerEmail, key), setup = await seedFirm("Invented Admin Setup", adminEmail, key), lostAdmin = await seedFirm("Invented Admin Lost", otherEmail);
  const context = await browser.newContext(), owner = await context.newPage();
  const adminContext = await browser.newContext({ baseURL: baseURL!.replace("127.0.0.1", "localhost") });
  try {
    await query(local.dbUrl, "delete from public.firm_members where user_id = any($1)", [[setup.ownerId, lostAdmin.ownerId]]);
    await query(local.dbUrl, "insert into public.orelu_admins (user_id) values ($1), ($2)", [setup.ownerId, lostAdmin.ownerId]);
    await query(local.dbUrl, "insert into public.admin_passkeys (id, user_id, public_key) values ($1, $2, 'invented')", [randomUUID(), lostAdmin.ownerId]);
    await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, 'Invented Admin Secret Client', 'business')", [firm.firmId]);
    const [{ id: job }] = await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, 'mail_poll', 'account', $2, $3, 'failed', 5, 'mail_unreachable') returning id", [firm.firmId, randomUUID(), `admin-e2e:${randomUUID()}`]);

    await emailStep(owner, ownerEmail);
    await owner.getByLabel("6 digit code from the app").fill(totp(key));
    await owner.getByRole("button", { name: "Continue" }).click();
    await expect(owner).toHaveURL(/\/app$/);
    expect((await owner.goto("/admin/firms"))?.status()).toBe(404);
    await expect(owner.getByText(name)).toHaveCount(0);
    // A page that is not there says so and leads back: to Today when signed in, inside the app's frame for its own pages.
    await expect(owner.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(owner.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/app");
    await owner.goto(`/app/clients/${randomUUID()}`);
    await expect(owner.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(owner.getByRole("navigation", { name: "InboxCA" })).toBeVisible();
    await owner.getByRole("link", { name: "Go to Today" }).click();
    await expect(owner).toHaveURL(/[/]app$/);
    expect((await page.goto("/no-such-page"))?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");

    // PLAN.md 8.1: after the email and 2 step codes an admin sets up a passkey, here a virtual
    // authenticator in Chrome on localhost (passkeys need a domain, not an address).
    page = await adminContext.newPage();
    const cdp = await adminContext.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const options = { protocol: "ctap2", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } as const;
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { ...options, transport: "internal" } });
    await emailStep(page, adminEmail);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up a passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Set up a passkey" }).click();
    await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();

    // A second passkey on a security key, then the console asks again once the hour's proof is gone.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { ...options, transport: "usb" } });
    await page.getByRole("link", { name: "Admins" }).click();
    const me = page.locator(".admin-row").filter({ hasText: adminEmail });
    await expect(me).toContainText("1 passkey");
    await me.getByRole("button", { name: "Add a passkey" }).click();
    await expect(me).toContainText("2 passkeys");
    await adminContext.clearCookies({ name: "orelu_admin_proof" });
    await page.goto("/admin/firms");
    await expect(page.getByRole("heading", { name: "Confirm with your passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Use my passkey" }).click();
    await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();
    expect(await query(local.dbUrl, "select max(counter) > 0 as counted from public.admin_passkeys where user_id = $1", [setup.ownerId])).toEqual([{ counted: true }]);

    // Recovery: another admin who lost their passkey has it removed, which is logged.
    await page.getByRole("link", { name: "Admins" }).click();
    const lost = page.locator(".admin-row").filter({ hasText: otherEmail });
    await expect(lost).toContainText("1 passkey");
    await lost.getByRole("button", { name: "Remove passkeys" }).click();
    await expect(lost).toContainText("0 passkeys");
    expect(await query(local.dbUrl, "select actor_id, firm_id from public.activity_log where action = 'admin.passkeys_removed' and entity_id = $1", [lostAdmin.ownerId])).toEqual([{ actor_id: setup.ownerId, firm_id: null }]);

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
    await adminContext.close().catch(() => {});
    await query(local.dbUrl, "delete from public.jobs where firm_id = $1", [firm.firmId]);
    await firm.remove();
    await setup.remove();
    await lostAdmin.remove();
  }
});
