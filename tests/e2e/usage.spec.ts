import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { todayInIndia } from "@/src/lib/calendar";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// The owner's InboxCA use: a line on Today and the two meters in Settings; staff see neither.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

const signIn = async (page: Page, email: string, key: string) => {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
};

test("the owner sees returns and InboxCA storage used, staff do not", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const ownerEmail = `usage-owner-${randomUUID()}@invented.test`, staffEmail = `usage-staff-${randomUUID()}@invented.test`;
  const firm = await seedFirm("Invented Usage Firm", ownerEmail, key), staff = await seedFirm("Invented Usage Staff", staffEmail, key);
  const person = await (await browser.newContext()).newPage();
  try {
    await query(local.dbUrl, "delete from public.firm_members where firm_id = $1", [staff.firmId]);
    await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, staff.ownerId]);
    const client = randomUUID(), today = todayInIndia(), [year, month] = today.split("-").map(Number);
    await query(local.dbUrl, "insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Invented Usage Client', 'business')", [client, firm.firmId]);
    // One return due today and one on the year's last day, 31 March.
    for (const due of [today, `${month < 4 ? year : year + 1}-03-31`])
      await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'GSTR1_M', $3, $4)", [firm.firmId, client, `p${due}`, due]);

    await signIn(page, ownerEmail, key);
    await expect(page.getByText(/2 returns this year are due so far\. InboxCA storage used: \d/)).toBeVisible();
    await page.getByRole("link", { name: "See InboxCA use" }).click();
    const use = page.getByRole("region", { name: "InboxCA use" });
    await expect(use.getByText("Returns this year")).toBeVisible();
    await expect(use.getByText(/due so far$/)).toBeVisible();
    await expect(use.getByText("About 2 by March, from your calendar")).toBeVisible();
    await expect(use.getByText("InboxCA storage used")).toBeVisible();
    await expect(use.getByText(/^At this pace about [\d.]+ (KB|MB) by March$/)).toBeVisible();

    await signIn(person, staffEmail, key);
    await expect(person.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(person.getByRole("link", { name: "See InboxCA use" })).toHaveCount(0);
    await person.goto("/app/settings?group=data#use");
    await expect(person.getByRole("heading", { name: /^This page is for/ })).toBeVisible();
    await expect(person.getByRole("region", { name: "InboxCA use" })).toHaveCount(0);
  } finally {
    await person.context().close();
    await firm.remove(staffEmail);
    await staff.remove();
  }
});
