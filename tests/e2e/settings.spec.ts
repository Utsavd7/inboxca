import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { longDate } from "@/src/lib/hours";
import { pdf } from "../fixtures/pdf";
import { appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, query, runJobs, seedFirm, signIn } from "./local-supabase";

// The owner's everyday settings, each saved and shown again: papers sent on request, the
// email limit, how the drive arranges and names files, reminders paused for one client, with
// the reminder email going from the firm's mailbox on the local GreenMail server, and holidays
// and special hours taken off again.
// Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `settings-owner-${tag}@example.test`;
const ownerKey = appKey();
const office = `settings-office-${tag}@firm.test`;
const code = `ST${tag.toUpperCase()}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const settings = async () => (await query(local.dbUrl, "select settings from public.firms where id = $1", [firm.firmId]))[0].settings;
const saved = (text: string) => owner.getByRole("status").filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Settings Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  await owner.goto("/app/settings?group=email");
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
});
test.afterAll(async () => {
  await firm.remove();
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("the owner chooses which papers go at once, and every paper can wait for approval", async () => {
  await owner.goto("/app/settings?group=reminders");
  const card = owner.locator("section#records");
  await expect(card.getByLabel("Challan", { exact: true })).toBeChecked();
  await card.getByLabel("Challan", { exact: true }).uncheck();
  await card.getByLabel("Form 16", { exact: true }).check();
  await card.getByLabel("Wait for approval for every paper").check();
  await card.getByRole("button", { name: "Save papers" }).click();
  await expect(saved("Papers saved.")).toBeVisible();
  const { records } = await settings();
  expect(records.approve_all).toBe(true);
  expect(records.routine).toContain("Form 16");
  expect(records.routine).not.toContain("Challan");
  await owner.reload();
  await expect(card.getByLabel("Challan", { exact: true })).not.toBeChecked();
  await expect(card.getByLabel("Form 16", { exact: true })).toBeChecked();
  await expect(card.getByLabel("Wait for approval for every paper")).toBeChecked();
});

test("the owner lowers the firm's email limit for its provider", async () => {
  await owner.goto("/app/settings?group=email");
  const limit = owner.locator("section#mailbox").getByLabel("Emails in 24 hours");
  await expect(limit).toHaveValue("500");
  await limit.fill("120");
  await owner.getByRole("button", { name: "Save email limit" }).click();
  await expect(saved("Email limit saved.")).toBeVisible();
  expect((await settings()).mail_limit).toBe(120);
  await owner.reload();
  await expect(limit).toHaveValue("120");
});

test("new files are arranged and named the way the owner chose, and the change is logged", async () => {
  await owner.goto("/app/settings?group=email");
  const drive = owner.locator("section#drive");
  await drive.getByLabel("How new files are arranged").selectOption("work_year_client");
  await drive.getByLabel("How new files are named").selectOption("period_type_client");
  await drive.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select settings from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId]))[0].settings).toMatchObject({ folder_order: "work_year_client", naming: "period_type_client" });
  expect(await query(local.dbUrl, "select actor_id from public.activity_log where firm_id = $1 and action = 'drive.folder_order'", [firm.firmId])).toEqual([{ actor_id: firm.ownerId }]);
  await owner.reload();
  await expect(drive.getByLabel("How new files are arranged")).toHaveValue("work_year_client");

  // A paper uploaded now goes under GST, then the year, then the client, period first in its name.
  const client = `Arranged Client ${tag}`;
  const [{ id }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, client]);
  await owner.goto(`/app/clients/${id}?tab=documents`);
  await owner.getByRole("link", { name: "Upload papers" }).click();
  const panel = owner.getByRole("dialog", { name: "Upload papers" });
  await panel.getByLabel("Files", { exact: true }).setInputFiles({ name: "purchase_bills_sep_2026.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented purchase bills")) });
  await expect(panel.getByRole("group", { name: "purchase_bills_sep_2026.pdf" }).getByLabel("Type")).toHaveValue("Purchase bills");
  await panel.getByRole("button", { name: /^Upload/ }).click();
  await expect(owner.getByRole("status")).toContainText("Sep 2026 - Purchase bills");
  const file = path.join(TEST_DRIVE, "InboxCA", "GST", "FY 2026-27", client, `Sep 2026 - Purchase bills - ${client}.pdf`);
  expect((await readFile(file)).subarray(0, 8).toString()).toBe("%PDF-1.4");
});

test("reminders go from the firm's mailbox, except to a client whose reminders are paused", async () => {
  // An invented return type with a confirmed date, due in 3 days for two clients.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Settings test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  const clients: Record<string, { email: string; id: string }> = {};
  for (const name of ["Reminded", "Paused"]) {
    const email = `${name.toLowerCase()}-${tag}@patel.test`;
    await makeMailbox(email);
    await owner.goto("/app/clients?panel=add");
    await owner.getByLabel("Name", { exact: true }).fill(`${name} Client ${tag}`);
    await owner.getByLabel("Email", { exact: true }).fill(email);
    await owner.getByRole("button", { name: "Add client" }).click();
    await expect(owner.locator(".page-head")).toContainText(`${name} Client ${tag}`);
    const id = owner.url().split("/").at(-1)!;
    clients[name] = { email, id };
    await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-09', (now() at time zone 'Asia/Kolkata')::date + 3)", [firm.firmId, id, code]);
  }
  await owner.goto(`/app/clients/${clients.Paused.id}?tab=details`);
  await owner.getByLabel("Pause reminders for this client").check();
  await owner.locator("form").filter({ has: owner.getByLabel("Pause reminders for this client") }).getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select reminders_paused from public.clients where id = $1", [clients.Paused.id]))[0].reminders_paused).toBe(true);
  await owner.reload();
  await expect(owner.getByLabel("Pause reminders for this client")).toBeChecked();

  await owner.goto("/app/settings?group=reminders");
  await owner.getByLabel("Email clients before their returns are due").check();
  await owner.getByRole("button", { name: "Save reminders" }).click();
  await expect(saved("Reminders saved.")).toBeVisible();
  expect((await settings()).reminders).toBe(true);
  await query(local.dbUrl, "select private.queue_reminders()");
  await runJobs(owner.request, firm.firmId);
  await expect.poll(async () => (await mailTexts(clients.Reminded.email)).join("\n")).toContain("- Settings test return for Sep 2026: due in 3 days");
  expect(await mailTexts(clients.Paused.email)).toEqual([]);
  const [paused] = await query(local.dbUrl, "select details from public.tasks where client_id = $1", [clients.Paused.id]);
  expect(paused.details.skipped).toMatchObject({ reason: "paused" });
});

test("the owner removes a holiday and a special hours day, and each change is logged", async () => {
  const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [first, second, third] = [day(30), day(60), day(90)];
  const changed = async () => (await query(local.dbUrl, "select details -> 'settings' as keys from public.activity_log where firm_id = $1 and actor_id = $2 and action = 'firm.changed' order by at", [firm.firmId, firm.ownerId])).map((row) => row.keys);
  await owner.goto("/app/settings?group=hours");
  const holidays = owner.locator("section#holidays");
  for (const [at, date] of [first, second].entries()) {
    await holidays.getByLabel("Add a holiday").fill(date);
    await holidays.getByRole("button", { name: "Add holiday" }).click();
    await expect(holidays.getByRole("listitem")).toHaveCount(at + 1);
  }
  const special = owner.locator("section#special");
  for (const [at, [from, to, open, close]] of [[first, first, "08:00", "20:00"], [second, third, "09:00", "21:00"]].entries()) {
    for (const [label, value] of [["From", from], ["To", to], ["Opens", open], ["Closes", close]]) await special.getByLabel(label, { exact: true }).fill(value);
    await special.getByRole("button", { name: "Add special hours" }).click();
    await expect(special.getByRole("listitem")).toHaveCount(at + 1);
  }

  const before = await changed();
  await holidays.getByRole("listitem").filter({ hasText: longDate(first) }).getByRole("button", { name: "Remove" }).click();
  await expect(holidays.getByRole("listitem")).toHaveCount(1);
  await expect(holidays.getByRole("listitem")).toContainText(longDate(second));
  await special.getByRole("listitem").filter({ hasText: `${longDate(first)}: 08:00 to 20:00` }).getByRole("button", { name: "Remove" }).click();
  await expect(special.getByRole("listitem")).toHaveCount(1);
  await expect(special.getByRole("listitem")).toContainText(`${longDate(second)} to ${longDate(third)}: 09:00 to 21:00`);
  const { holidays: kept, special_hours: hours } = await settings();
  expect(kept).toEqual([second]);
  expect(hours).toEqual([{ from: second, to: third, open: "09:00", close: "21:00" }]);
  expect((await changed()).slice(before.length)).toEqual([["holidays"], ["special_hours"]]);
  // Still removed when the page is drawn again.
  await owner.reload();
  await expect(holidays.getByRole("listitem")).toHaveCount(1);
  await expect(special.getByRole("listitem")).toHaveCount(1);
});
