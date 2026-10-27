import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// A notice's daily steps (PLAN.md 5.6): staff record it with the date they read, which waits
// as a suggestion; the owner confirms the date against the notice, and moves the notice on
// until it is closed. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `notices-owner-${tag}@example.test`;
const staffEmail = `notices-staff-${tag}@example.test`;
const ownerKey = appKey();
const staffKey = appKey();
const clientName = `Notice Client ${tag}`;
const reference = `TEST-${tag.toUpperCase()}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
let clientId = "";
let staffId = "";
const notice = async () => (await query(local.dbUrl, "select id, status, to_char(due_on, 'YYYY-MM-DD') as due_on, details from public.tasks where firm_id = $1 and kind = 'notice'", [firm.firmId]))[0];
const logged = async (action: string) => (await query(local.dbUrl, "select actor_id from public.activity_log where firm_id = $1 and action = $2", [firm.firmId, action])).map((row) => row.actor_id);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Notices Firm ${tag}`, ownerEmail, ownerKey);
  staffId = await addPerson(firm.firmId, staffEmail, "staff", staffKey);
  [{ id: clientId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [firm.firmId, clientName]);
  owner = await (await browser.newContext()).newPage();
  staff = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove(staffEmail));

test("staff record a notice from the client's page; the date they read waits as a suggestion", async () => {
  await signIn(staff, staffEmail, staffKey);
  await staff.goto(`/app/clients/${clientId}?tab=notices`);
  await staff.getByRole("link", { name: "Add a notice" }).first().click();
  const panel = staff.getByRole("dialog", { name: "Add a notice" });
  await panel.getByLabel("Authority").selectOption({ label: "Income Tax" });
  await panel.getByLabel("Notice", { exact: true }).fill("Notice u/s 143(2)");
  await panel.getByLabel("Reference or DIN").fill(reference.toLowerCase());
  await panel.getByLabel("Received on").fill("2026-10-20");
  await panel.getByLabel("Action date, as the notice states it").fill("2026-12-24");
  await panel.getByRole("button", { name: "Add notice" }).click();
  // Back on the client's Notices tab, under the firm's review deadline, not the date read.
  await expect(staff).toHaveURL(new RegExp(`/app/clients/${clientId}\\?tab=notices$`));
  await expect(staff.getByRole("row").filter({ hasText: reference })).toContainText("Check by");
  const added = await notice();
  expect(added).toMatchObject({ status: "upcoming", details: { authority: "income_tax", notice_type: "Notice u/s 143(2)", reference, received_on: "2026-10-20", suggested_date: "2026-12-24" } });
  expect(added.details.action_date).toBeUndefined();
  expect(added.due_on).not.toBe("2026-12-24");
  expect(await logged("notice.added")).toEqual([staffId]);
});

test("the owner confirms the suggested date, and only then is it the deadline", async () => {
  await signIn(owner, ownerEmail, ownerKey);
  await owner.goto("/app/notices?show=confirm");
  const row = owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: reference });
  await row.getByRole("link", { name: `Update the notice for ${clientName}` }).click();
  const panel = owner.getByRole("dialog", { name: "Notice u/s 143(2)" });
  await expect(panel.getByLabel("Action date, as the notice states it")).toHaveValue("2026-12-24");
  await panel.getByRole("button", { name: "Mark date checked" }).click();
  await expect(owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: reference })).toHaveCount(0);
  const confirmed = await notice();
  expect(confirmed).toMatchObject({ due_on: "2026-12-24", details: { action_date: "2026-12-24" } });
  expect(await logged("notice.date_confirmed")).toEqual([firm.ownerId]);
});

test("the owner moves the notice on to in progress, replied and closed; a done notice leaves the open list", async () => {
  const { id } = await notice();
  await owner.goto(`/app/notices?notice=${id}`);
  const panel = owner.getByRole("dialog", { name: "Notice u/s 143(2)" });
  const row = owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: reference });
  await panel.getByRole("button", { name: "Mark in progress" }).click();
  await expect.poll(async () => (await notice()).status).toBe("in_progress");

  await row.getByRole("link", { name: `Update the notice for ${clientName}` }).click();
  await panel.getByRole("button", { name: "Mark replied" }).click();
  await expect(row).toHaveCount(0);
  expect((await notice()).status).toBe("replied");

  await owner.getByRole("link", { name: /^Replied or closed/ }).click();
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: `Update the notice for ${clientName}` }).click();
  await panel.getByRole("button", { name: "Close notice" }).click();
  await expect(owner).toHaveURL(/show=done/);
  await expect.poll(async () => (await notice()).status).toBe("closed");
});

test("staff see the closed notice but cannot move it on", async () => {
  const { id } = await notice();
  await staff.goto(`/app/notices?show=all&notice=${id}`);
  const panel = staff.getByRole("dialog", { name: "Notice u/s 143(2)" });
  await expect(panel).toContainText("The owner, a partner or a manager checks the date");
  await expect(panel.getByRole("button", { name: "Mark open" })).toHaveCount(0);
});

test("on the client's Notices tab the owner confirms a date in its row and sets the status from the list", async () => {
  const [{ id }] = await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, due_on, details) values ($1, $2, 'notice', (now() at time zone 'Asia/Kolkata')::date + 1, '{"authority":"gst","notice_type":"Invented GST notice","reference":"","received_on":"2026-10-20","suggested_date":"2027-01-15"}') returning id`, [firm.firmId, clientId]);
  const saved = async () => (await query(local.dbUrl, "select status, to_char(due_on, 'YYYY-MM-DD') as due_on, details->>'action_date' as action_date from public.tasks where id = $1", [id]))[0];
  await owner.goto(`/app/clients/${clientId}?tab=notices`);
  const row = owner.getByRole("row").filter({ hasText: "Invented GST notice" });
  await expect(row.getByLabel("Action date for Invented GST notice")).toHaveValue("2027-01-15");
  await row.getByRole("button", { name: "Mark date checked" }).click();
  await expect(row).toContainText("Checked by");
  expect(await saved()).toEqual({ status: "upcoming", due_on: "2027-01-15", action_date: "2027-01-15" });

  await row.getByLabel("Status of Invented GST notice").selectOption("in_progress");
  await expect.poll(async () => (await saved()).status).toBe("in_progress");
  await owner.reload();
  await expect(row.getByLabel("Status of Invented GST notice")).toHaveValue("in_progress");
});
