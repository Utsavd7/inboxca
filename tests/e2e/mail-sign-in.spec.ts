import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { MAIL_API_URL, TEST_WORKER_SECRET } from "../../playwright.config";
import { fakeMail } from "../fake-mail";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// The firm's email connected with Google, Microsoft or Zoho sign in, against the fake
// providers in tests/fake-mail.ts (no internet): connect, new client mail read by the poll,
// the Inbox read live through the file worker, a threaded reply from the conversation, and
// disconnecting takes the token back. Nothing of the mail and no token is kept in the logs.
const local = localSupabase();
test.skip(!local.url, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const fake = fakeMail();
test.beforeAll(async () => {
  await fake.listen(Number(new URL(MAIL_API_URL).port));
});
test.afterAll(() => fake.close());

const names = { gmail: "Google", outlook: "Microsoft", zoho: "Zoho" } as const;
const readMail = async (page: Page) => {
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await page.request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
};

for (const provider of ["gmail", "outlook", "zoho"] as const) {
  test(`the owner connects the firm's email with ${names[provider]} sign in, and the team reads and replies`, async ({ browser }) => {
    const tag = randomUUID().slice(0, 8);
    const ownerEmail = `signin-owner-${tag}@example.test`;
    const office = `signin-office-${tag}@firm.test`;
    const clientEmail = `signin-client-${tag}@patel.test`;
    const clientName = `Sign In Client ${tag}`;
    const ownerKey = Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");
    fake.reset(office);
    const firm = await seedFirm(`Sign In Firm ${tag}`, ownerEmail, ownerKey);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await emailStep(page, ownerEmail);
      await page.getByLabel("6 digit code from the app").fill(totp(ownerKey));
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/app$/);
      await page.goto("/app/settings?group=email");
      const card = page.locator("section#mailbox");
      const connect = card.getByRole("button", { name: `Connect with ${names[provider]}` });
      // Every provider's keys are set on the test server, so no "not set up yet" line.
      await expect(card.getByText("is not set up yet")).toHaveCount(0);

      // Not allowed at the provider: nothing is connected. Microsoft 365's admin can allow it.
      fake.mailbox.answer = "deny";
      await connect.click();
      await expect(card.getByRole("alert")).toContainText(provider === "outlook" ? "its admin may need to allow InboxCA once" : "The sign in was not allowed");
      if (provider === "outlook") {
        await card.getByRole("button", { name: "Allow for the whole firm" }).click();
        await expect(page.getByText("Your admin allowed InboxCA. Now connect with Microsoft.")).toBeVisible();
      }
      fake.mailbox.answer = "allow";
      await connect.click();
      await expect(card.getByRole("status")).toHaveText(`Connected: ${office}`);
      const [account] = await query(local.dbUrl, "select provider, status, settings - 'mail_sends' as settings from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm.firmId]);
      expect(account).toMatchObject({ provider, status: "connected" });
      expect(Object.keys(account.settings).sort()).toEqual(["api", "mail_failures"]);

      await page.goto("/app/clients?panel=add");
      await page.getByLabel("Name", { exact: true }).fill(clientName);
      await page.getByLabel("Email", { exact: true }).fill(clientEmail);
      await page.getByRole("button", { name: "Add client" }).click();
      await expect(page.locator(".page-head")).toContainText(clientName);

      // Mail from the client is read by the poll; mail from anyone else is not kept.
      await fake.deliver({ from: `stranger-${tag}@else.test`, subject: `Offer ${tag}`, text: "Not a client" });
      await fake.deliver({ from: clientEmail, subject: `Meeting ${tag}`, text: "Dear Sir,\n\nCan we meet next week about the audit?\n\nRegards, Meera" });
      await expect(async () => {
        await readMail(page);
        expect(await query(local.dbUrl, "select label from public.email_events where firm_id = $1", [firm.firmId])).toEqual([{ label: "other" }]);
      }).toPass({ timeout: 30_000 });

      // The Inbox reads the subject and first line live, through the file worker.
      await page.goto("/app/inbox");
      const list = page.getByRole("list", { name: "Emails" });
      const incoming = list.getByRole("listitem").filter({ hasText: `Meeting ${tag}` });
      await expect(incoming).toContainText(clientName);
      await expect(incoming).toContainText("Can we meet next week about the audit?");
      await incoming.getByText(`Meeting ${tag}`).click();
      const pane = page.getByRole("article", { name: "Open email" });
      await expect(pane).toContainText("Can we meet next week about the audit?");
      await page.getByLabel("Your reply").fill("Yes, Tuesday at 11 works for us.");
      await page.getByRole("button", { name: "Send reply" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible();

      // The reply went from the firm's mailbox, in the conversation, and Sent shows it.
      const [sent] = fake.mailbox.sends;
      expect(sent.raw).toContain("Tuesday at 11");
      if (provider === "zoho") expect(sent.json).toMatchObject({ action: "reply", fromAddress: office, toAddress: clientEmail, subject: `Re: Meeting ${tag}` });
      else expect(sent.raw).toMatch(/In-Reply-To: <[^>]+>/);
      await page.reload();
      const messages = pane.getByRole("list", { name: "Conversation" }).getByRole("listitem");
      await expect(messages).toHaveCount(2);
      await expect(messages.nth(1)).toContainText("Tuesday at 11");

      // A mailbox that must be connected again signs in again in place, keeping its place.
      const [before] = await query(local.dbUrl, "select id, sync_cursor from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm.firmId]);
      await query(local.dbUrl, "update public.connected_accounts set status = 'needs_reconnect' where id = $1", [before.id]);
      await page.goto("/app/settings?group=email");
      await expect(card.getByRole("alert")).toContainText("Connect your firm's email again");
      await card.getByRole("button", { name: `Connect again with ${names[provider]}` }).click();
      await expect(card.getByRole("status")).toHaveText(`Connected: ${office}`);
      expect(await query(local.dbUrl, "select id, status, sync_cursor from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm.firmId])).toEqual([{ ...before, status: "connected" }]);

      // Disconnecting takes the token back where the provider allows it.
      await page.goto("/app/settings?group=email");
      await card.getByRole("button", { name: "Disconnect" }).click();
      await expect(connect).toBeVisible();
      expect(fake.mailbox.revoked).toHaveLength(provider === "outlook" ? 0 : 1);

      const logged = await query(local.dbUrl, "select action, details from public.activity_log where firm_id = $1 and action like 'mailbox.%' order by at", [firm.firmId]);
      const actions = logged.map((line) => line.action);
      expect(actions).toEqual(expect.arrayContaining(["mailbox.connected", "mailbox.reconnected", "mailbox.token_saved", "mailbox.token_read", "mailbox.token_deleted"]));
      expect(logged.find((line) => line.action === "mailbox.token_deleted")?.details).toEqual({ provider, revoked: provider !== "outlook" });
      const kept = await query(local.dbUrl, "select (select coalesce(jsonb_agg(e), '[]') from public.email_events e where e.firm_id = $1)::text || (select coalesce(jsonb_agg(l), '[]') from public.activity_log l where l.firm_id = $1)::text as text", [firm.firmId]);
      for (const secret of ["audit", `Meeting ${tag}`, `Offer ${tag}`, "access-", "refresh-"]) expect(kept[0].text).not.toContain(secret);
    } finally {
      await context.close();
      await firm.remove();
    }
  });
}

test("closing the firm takes the mailbox sign in back at the provider too", async ({ browser }) => {
  const tag = randomUUID().slice(0, 8);
  const ownerEmail = `signin-close-${tag}@example.test`;
  const office = `signin-close-office-${tag}@firm.test`;
  const name = `Sign In Close Firm ${tag}`;
  const ownerKey = Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");
  fake.reset(office);
  const firm = await seedFirm(name, ownerEmail, ownerKey);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await emailStep(page, ownerEmail);
    await page.getByLabel("6 digit code from the app").fill(totp(ownerKey));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings?group=email");
    const card = page.locator("section#mailbox");
    await card.getByRole("button", { name: "Connect with Google" }).click();
    await expect(card.getByRole("status")).toHaveText(`Connected: ${office}`);

    await page.goto("/app/settings?group=data");
    await page.getByText("Close the firm", { exact: true }).last().click();
    await page.getByLabel(`Type ${name} to confirm`).fill(name);
    await page.getByRole("button", { name: "Close the firm for good" }).click();
    await expect.poll(() => fake.mailbox.revoked.length).toBe(1);
    const logged = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'mailbox.token_deleted'", [firm.firmId]);
    expect(logged.map((line) => line.details)).toEqual([{ provider: "gmail", revoked: true }]);
  } finally {
    await context.close();
    await firm.remove();
  }
});
