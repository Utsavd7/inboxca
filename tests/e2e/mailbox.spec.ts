import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import nodemailer from "nodemailer";
import { emailStep, localSupabase, seedFirm, totp } from "./local-supabase";

// The owner types only the firm's address and password; InboxCA says what it found, and the
// server settings are changed only when it finds none (the local GreenMail mailbox).
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");

const tag = randomUUID().slice(0, 8);
const ownerEmail = `mailbox-owner-${tag}@example.test`;
// GreenMail makes a mailbox for every address it receives mail for, its password the address.
const office = `mailbox-office-${tag}@firm.test`;
const ownerKey = Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");

test("the owner connects the firm's mailbox with only its address and password", async ({ page }) => {
  test.setTimeout(90_000);
  const firm = await seedFirm(`Mailbox Firm ${tag}`, ownerEmail, ownerKey);
  try {
    await nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true }).sendMail({ from: "setup@invented.test", to: office, subject: "Invented test setup", text: "Makes the test mailbox" });
    await emailStep(page, ownerEmail);
    await page.getByLabel("6 digit code from the app").fill(totp(ownerKey));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings?group=email");
    const card = page.locator("section#mailbox");
    const address = card.getByLabel("The firm's email address");

    await address.fill("shah.associates@gmail.com");
    await address.blur();
    await expect(card.getByText("Found Gmail. Gmail needs an app password: Google Account, Security, App passwords.")).toBeVisible();
    await address.fill("shah.associates@outlook.com");
    await address.blur();
    // The test server has Microsoft sign in set up (the fake in tests/fake-mail.ts).
    await expect(card.getByText("This address is on Outlook or Microsoft 365. Use Connect with Microsoft above.")).toBeVisible();

    await address.fill(office);
    await address.blur();
    await expect(card.getByText("InboxCA did not find this provider, so it will try the usual server names.")).toBeVisible();
    await card.getByLabel("Its password").fill(office);
    await card.getByRole("button", { name: "Connect email" }).click();
    await expect(card.getByRole("alert")).toContainText("could not reach the mail server");
    await expect(card.getByLabel("Incoming mail server (IMAP)")).toHaveValue("imap.firm.test");
    await card.getByLabel("Incoming mail server (IMAP)").fill("127.0.0.1");
    await card.getByLabel("Incoming port").fill("3143");
    await card.getByLabel("Outgoing mail server (SMTP)").fill("127.0.0.1");
    await card.getByLabel("Outgoing port").fill("3025");
    await card.getByLabel("Its password").fill("wrong");
    await card.getByRole("button", { name: "Connect email" }).click();
    await expect(card.getByRole("alert")).toHaveText("InboxCA could not sign in with that address and password. Check the password, or use an app password.");
    await card.getByLabel("Its password").fill(office);
    await card.getByRole("button", { name: "Connect email" }).click();
    await expect(card.getByRole("status")).toHaveText(`Connected: ${office}`);
  } finally {
    await firm.remove();
  }
});
