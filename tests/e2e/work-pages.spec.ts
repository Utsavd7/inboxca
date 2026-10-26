import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import { xlsxEntries } from "@/src/lib/sheet";
import { TEST_DRIVE } from "../../playwright.config";
import { pdf } from "../fixtures/pdf";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// Documents, Calendar, Notices, People and Settings: the actions each page offers beyond its
// list. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const email = `pages-${randomUUID().slice(0, 8)}@example.test`;
const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const tag = randomUUID().slice(0, 8);
const patelName = `Patel Textiles ${tag}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let patel: string;
let mehta: string;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Work Pages Test Firm", email, key);
  owner = await (await browser.newContext()).newPage();
  await emailStep(owner, email);
  await owner.getByLabel("6 digit code from the app").fill(totp(key));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
  // Only that a client has an email is read here; nothing is sent without the firm's email.
  [{ id: patel }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind, email_enc) values ($1, $2, 'business', 'invented') returning id", [firm.firmId, patelName]);
  [{ id: mehta }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [firm.firmId, `Mehta Traders ${tag}`]);
});
test.afterAll(() => firm.remove());

test("Documents: tick papers to download one ZIP or preview sending them as links, and drop files to upload", async () => {
  await owner.goto("/app/settings");
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
  await mkdir(`${TEST_DRIVE}/InboxCA`, { recursive: true });
  const insert = "insert into public.documents (firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, $3, $4, $5, $6, 1, $7) returning id";
  const papers = [];
  for (const [client, name, type] of [[patel, `${patelName} - Purchase bills.pdf`, "Purchase bills"], [mehta, `Mehta Traders ${tag} - Form 16.pdf`, "Form 16"]]) {
    const file = `InboxCA/pages-${randomUUID()}.pdf`;
    await writeFile(`${TEST_DRIVE}/${file}`, Buffer.from(pdf(`Invented ${type}`)));
    papers.push((await query(local.dbUrl, insert, [firm.firmId, client, "gst", type, file, name, randomUUID()]))[0].id);
  }

  await owner.goto("/app/documents?view=papers");
  const list = owner.getByRole("region", { name: "Papers" });
  await list.getByLabel(`Choose ${patelName} - Purchase bills.pdf`).check();
  await list.getByLabel(`Choose Mehta Traders ${tag} - Form 16.pdf`).check();
  const bar = owner.getByRole("form", { name: "Chosen papers" });
  // The bar rises once a paper is ticked.
  await expect(bar).toBeVisible();
  // The owner downloads both papers as one ZIP; each download is logged.
  const [download] = await Promise.all([owner.waitForEvent("download"), bar.getByRole("button", { name: "Download as ZIP" }).click()]);
  const files = xlsxEntries(await readFile((await download.path())!));
  expect([...files.keys()].sort()).toEqual([`${patelName} - Purchase bills.pdf`, `Mehta Traders ${tag} - Form 16.pdf`].sort());
  const [{ n }] = await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id = $1 and action = 'document.downloaded'", [firm.firmId]);
  expect(n).toBe(2);

  // Sending shows who gets what first; with no firm email nothing can go.
  await bar.getByRole("button", { name: "Send as secure links" }).click();
  const preview = owner.getByRole("dialog", { name: "Send 2 papers as secure links" });
  await expect(preview.getByRole("listitem").filter({ hasText: "Purchase bills" })).toContainText("Will be emailed");
  await expect(preview.getByRole("listitem").filter({ hasText: "Form 16" })).toContainText("No email address");
  await expect(preview.getByRole("alert")).toContainText("Connect the firm's email");
  await expect(preview.getByRole("button", { name: "Send 1 link" })).toBeDisabled();
  await preview.getByRole("link", { name: "Cancel" }).click();
  await expect(preview).toHaveCount(0);

  // Files dropped with no client chosen wait while the client is picked, then fill its form.
  await owner.goto("/app/documents?view=papers");
  const drag = (type: string) =>
    owner.evaluate((type) => {
      const holder = window as unknown as { transfer?: DataTransfer };
      if (!holder.transfer) {
        holder.transfer = new DataTransfer();
        holder.transfer.items.add(new File(["%PDF-1.4 invented"], "sales_bills_sep_2026.pdf", { type: "application/pdf" }));
      }
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: holder.transfer, bubbles: true, cancelable: true }));
    }, type);
  // Files dragged in before the page is ready do nothing, so the drag is tried until it shows.
  const dragIn = (text: string) =>
    expect(async () => {
      await drag("dragenter");
      await expect(owner.getByText(text)).toBeVisible({ timeout: 2000 });
    }).toPass();
  await dragIn("Choose a client first");
  await drag("drop");
  const sheet = owner.getByRole("dialog", { name: "Upload papers" });
  await expect(sheet).toContainText("1 file is ready");
  await sheet.getByLabel("Client name").fill("Patel");
  await sheet.getByLabel("Client name").press("Enter");
  await sheet.getByRole("link", { name: `Choose ${patelName}` }).click();
  const form = owner.getByRole("dialog", { name: `Upload papers for ${patelName}` });
  await expect(form.getByRole("group", { name: "sales_bills_sep_2026.pdf" }).getByLabel("Type")).toHaveValue("Sales bills");

  // With a paper open, the page names its client as where the files go.
  await owner.goto(`/app/documents?file=${papers[0]}`);
  await owner.evaluate(() => delete (window as unknown as { transfer?: DataTransfer }).transfer);
  await dragIn(`Drop to upload for ${patelName}`);
  await drag("dragleave");
  await expect(owner.getByText(`Drop to upload for ${patelName}`)).toHaveCount(0);
});

test("Calendar: a month of days with a dot for each kind of return, a day's returns, and Remind client", async () => {
  const code = `TP${tag.toUpperCase()}`;
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  const today = todayInIndia();
  const soon = addDays(today, 2);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-09', $4)", [firm.firmId, patel, code, soon]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on, status, details) values ($1, $2, $3, '2026-08', $4::date, 'filed', jsonb_build_object('filed_on', $5::text))", [firm.firmId, mehta, code, soon, today]);

  await owner.goto("/app/calendar");
  await owner.getByRole("navigation", { name: "Layout" }).getByRole("link", { name: "Month" }).click();
  await expect(owner).toHaveURL(new RegExp(`month=${today.slice(0, 7)}`));
  if (!soon.startsWith(today.slice(0, 7))) await owner.getByRole("link", { name: "Next month" }).click();
  const days = owner.getByRole("navigation", { name: /^Days of/ });
  const cell = days.getByRole("link", { name: `${dueLabel(soon)}: 1 to file, 1 filed` });
  await expect(cell.locator(".d-wait")).toHaveCount(1);
  await expect(cell.locator(".d-done")).toHaveCount(1);
  await cell.click();
  await expect(owner).toHaveURL(new RegExp(`day=${soon}`));
  await expect(cell).toHaveAttribute("aria-current", "date");
  const row = owner.getByRole("row").filter({ hasText: patelName });
  await expect(row).toContainText("Upcoming");
  await expect(owner.getByRole("row").filter({ hasText: `Mehta Traders ${tag}` })).toContainText("Filed");

  // Remind client shows the email's returns first; with no firm email nothing can go.
  await row.getByRole("link", { name: `Remind ${patelName}` }).click();
  const panel = owner.getByRole("dialog", { name: `Remind ${patelName}` });
  await expect(panel.getByRole("listitem")).toContainText("In the email");
  await expect(panel.getByRole("alert")).toContainText("Connect the firm's email");
  await expect(panel.getByRole("button", { name: "Send reminder" })).toBeDisabled();
  await panel.getByRole("link", { name: "Cancel" }).click();
  await expect(panel).toHaveCount(0);
  await expect(owner).toHaveURL(new RegExp(`month=.*`));
});

test("Notices, People and Settings: status pills, the open notice, an empty team and switches", async () => {
  await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, due_on, details) values ($1, $2, 'notice', '2030-01-22', '{"authority":"gst","notice_type":"Invented GST notice","reference":"","received_on":"2026-10-20"}')`, [firm.firmId, patel]);
  await owner.goto("/app/notices");
  const notice = owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: "Invented GST notice" });
  await expect(notice).toContainText("Open");
  await notice.getByRole("link", { name: `Update the notice for ${patelName}` }).click();
  const panel = owner.getByRole("dialog", { name: "Invented GST notice" });
  await expect(panel).toContainText("Received 20 Oct 2026");
  await expect(panel.getByRole("button", { name: "Mark replied" })).toBeVisible();

  await owner.goto("/app/people");
  await expect(owner.getByRole("row").filter({ hasText: email })).toContainText("Owner");
  await expect(owner.getByRole("row").filter({ hasText: email })).toContainText("Active");
  await expect(owner.getByText("Just you so far")).toBeVisible();

  await owner.goto("/app/settings?group=reminders");
  const reminders = owner.getByLabel("Email clients before their returns are due");
  await expect(reminders).toHaveClass(/toggle/);
  await reminders.check();
  await owner.getByRole("button", { name: "Save reminders" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reminders saved." })).toBeVisible();
  await expect(reminders).toBeChecked();
  await owner.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your data" }).click();
  await expect(owner.locator("section#close")).toHaveClass(/set-danger/);
});
