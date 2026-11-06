import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverCrypto } from "@/src/lib/crypto";
import { pdf } from "../fixtures/pdf";
import { addPerson, appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp } from "./local-supabase";

// Papers from clients, end to end (user, 26 Oct 2026): the owner chooses when InboxCA asks; the
// client gets the email with the month's papers by itself; after two reminders with nothing back
// the person who looks after the client is asked to call, and sends a reminder with Undo or marks
// the call; once the client replies with every paper attached, they are told to check the figures. Mail goes through the local GreenMail server. Skipped without local Supabase.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `papers-owner-${tag}@example.test`;
const staffEmail = `papers-staff-${tag}@example.test`;
const [ownerKey, staffKey] = [appKey(), appKey()];
const office = `papers-office-${tag}@firm.test`;
const code = `GSTR1E${tag.toUpperCase()}`;
const client = { name: `Papers Traders ${tag}`, email: `papers-${tag}@patel.test`, id: "" };
const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
const ask = async () => (await query(local.dbUrl, "select id, status, details from public.requests where client_id = $1 and kind = 'documents'", [client.id]))[0];
// A send waits 20 seconds for Undo; the test lets it go now.
const goNow = async (page: Page) => {
  await query(local.dbUrl, "update public.jobs set run_at = now() where firm_id = $1 and kind = 'reminders' and state = 'pending'", [firm.firmId]);
  await runJobs(page.request, firm.firmId);
};

test.beforeAll(async ({ browser }) => {
  loadEnvConfig(process.cwd());
  firm = await seedFirm(`Papers Firm ${tag}`, ownerEmail, ownerKey);
  await addPerson(firm.firmId, staffEmail, "staff", staffKey);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  await makeMailbox(client.email);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(client.name);
  await owner.getByLabel("Email", { exact: true }).fill(client.email);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(client.name);
  client.id = owner.url().split("/").at(-1)!;
  await query(local.dbUrl, "update public.clients set kind = 'business' where id = $1", [client.id]);
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) select $1, $2, user_id, 'staff' from public.firm_members where firm_id = $1 and role = 'staff'", [firm.firmId, client.id]);
  // An invented monthly GST return whose date a CA confirmed, due in 5 days.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'GSTR-1 test return', 'monthly', '{\"for\": \"gstin\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-10', $4)", [firm.firmId, client.id, code, day(5)]);
  // The firm's drive, on this computer, for what the client uploads.
  const account = randomUUID();
  const crypto = serverCrypto();
  await query(local.dbUrl, "insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc, settings) values ($1, $2, 'drive', 'local', $3, $4, '{}')", [account, firm.firmId, await crypto.encrypt(firm.firmId, `accounts/${account}/address`, "Test drive"), await crypto.encrypt(firm.firmId, `accounts/${account}/credentials`, "{}")]);
});
test.afterAll(async () => {
  await firm.remove(staffEmail);
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("the owner chooses how early InboxCA asks for papers, and the client gets the month's list by email", async () => {
  await owner.goto("/app/settings?group=reminders");
  await owner.getByLabel("Email clients before their returns are due").check();
  await expect(owner.getByLabel("Monthly returns")).toHaveValue("10");
  await owner.getByLabel("Yearly returns").selectOption("0");
  await owner.getByRole("button", { name: "Save reminders" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reminders saved." })).toBeVisible();
  await owner.locator("section#reminders").screenshot({ path: test.info().outputPath("ask-settings.png") });
  const [{ settings }] = await query(local.dbUrl, "select settings from public.firms where id = $1", [firm.firmId]);
  expect([settings.reminders, settings.ask_days]).toEqual([true, { monthly: 10, quarterly: 15, yearly: 0 }]);

  // The morning's reminders run.
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'reminders', 'firm', $1, $2)", [firm.firmId, `reminders:test:${randomUUID()}`]);
  await runJobs(owner.request, firm.firmId);
  const [sent] = await mailTexts(client.email);
  expect(sent).toContain(`Dear ${client.name},`);
  expect(sent).toContain("To prepare your GSTR-1 test return for Oct 2026, please send these documents: Sales bills, Purchase bills, Bank statement.");
  expect(sent).toContain("Please reply to this email with the files attached, or email them to us.");
  expect(sent).not.toMatch(/https?:\/\//);
  expect(await ask()).toMatchObject({ status: "pending", details: { period: "2026-10", returns: [code], since: day(0) } });

  // Send reminder now, under More on the client's Work tab: never a second email the same day.
  await owner.goto(`/app/clients/${client.id}?tab=returns`);
  await owner.locator(".page-head").getByRole("button", { name: "More" }).click();
  await owner.getByRole("menuitem", { name: "Send reminder now" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "already emailed today" })).toBeVisible();
  expect(await mailTexts(client.email)).toHaveLength(1);
});

test("after two reminders with nothing back, the person who looks after the client is asked to call", async ({ browser }) => {
  // Three days on from the second reminder, as if the days had passed.
  const request = await ask();
  await query(local.dbUrl, "update public.requests set details = $2 where id = $1", [request.id, { ...request.details, since: day(-9), followups: [day(-6), day(-3)], reminder: { day: day(-3), state: "sent" } }]);
  const db = new Client({ connectionString: local.dbUrl });
  await db.connect();
  await db.query("begin");
  await db.query("select set_config('app.log_purge', 'on', true)");
  await db.query("delete from public.activity_log where entity_id = $1 and action = 'reminder.sent'", [client.id]);
  await db.query("commit");
  await db.end();
  staff = await (await browser.newContext()).newPage();
  await signIn(staff, staffEmail, staffKey);
  const call = staff.locator("section[aria-labelledby=g-waits] li").filter({ hasText: client.name });
  await expect(call).toContainText("Sales bills, Purchase bills, Bank statement");
  await staff.locator("section.today-list").screenshot({ path: test.info().outputPath("call-on-today.png") });
  await call.getByRole("link", { name: `See papers: ${client.name}` }).click();
  await expect(staff.getByRole("heading", { name: "Papers asked for", level: 1 })).toBeVisible();

  // Send reminder now, stopped by Undo, then sent.
  const toast = (text: string) => staff.getByRole("status").filter({ hasText: text });
  await staff.getByRole("button", { name: "Send reminder now" }).click();
  await toast("The reminder goes out from your firm email in about 20 seconds").getByRole("button", { name: "Undo" }).click();
  await expect(toast("Stopped. Nothing was sent.")).toBeVisible();
  await staff.getByRole("button", { name: "Send reminder now" }).click();
  await expect(toast("The reminder goes out from your firm email in about 20 seconds")).toBeVisible();
  await goNow(staff);
  expect((await query(local.dbUrl, "select state from public.jobs where firm_id = $1 and entity_type = 'client' order by id", [firm.firmId])).map((job) => job.state)).toEqual(["cancelled", "done"]);
  const [, again] = await mailTexts(client.email);
  expect(again).toContain("We are still waiting for these documents for Oct 2026: Sales bills, Purchase bills, Bank statement.");
  expect((await ask()).details).toMatchObject({ followups: [day(-6), day(-3), day(0)], chased: day(0) });
  // The third reminder tells the owner too; the call is off the person's list once they chased it.
  expect(await query(local.dbUrl, "select 1 from public.requests where entity_id = $1 and entity_type = 'request_stalled' and status = 'pending'", [request.id])).toHaveLength(1);
  await staff.goto("/app");
  await expect(staff.locator("section[aria-labelledby=t-list]")).toBeVisible();
  await expect(call).toHaveCount(0);

  // A call after the email: marked, and logged.
  await staff.goto(`/app/papers/${request.id}`);
  await expect(staff.getByRole("button", { name: "Send reminder now" })).toBeDisabled();
  await expect(staff.getByRole("note")).toHaveText("Already emailed today. The next reminder can go tomorrow.");
  await staff.screenshot({ path: test.info().outputPath("papers-page.png") });
  expect(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await staff.getByRole("button", { name: "Mark as asked by phone" }).click();
  await expect(toast("Marked as asked by phone.")).toBeVisible();
  expect(await query(local.dbUrl, "select 1 from public.activity_log where entity_id = $1 and action = 'request.phoned'", [request.id])).toHaveLength(1);
});

test("once the client replies with every paper attached, the person is told to check the figures", async () => {
  // The reply's attachments are typed by their names, filed, and matched to the papers asked
  // for; a register comes as a spreadsheet (product gaps S5).
  await testSmtp.sendMail({
    from: client.email, to: office, subject: "Re: Documents needed for Oct 2026", text: "Please find attached.",
    attachments: [
      { filename: "sales_bills_oct_2026.pdf", content: Buffer.from(pdf("Invented sales bills")) },
      { filename: "purchase_bills_oct_2026.pdf", content: Buffer.from(pdf("Invented purchase bills")) },
      { filename: "bank_statement_oct_2026.csv", content: "Date,Narration,Amount\n01-10-2026,Invented entry,100\n" },
    ],
  });
  await pollFirmMail(staff.request, firm.firmId);
  await expect.poll(async () => { await runJobs(staff.request, firm.firmId); return (await ask()).status; }, { timeout: 30_000 }).toBe("done");
  expect((await ask()).details.items.every((item: { received: string[] }) => item.received.length === 1)).toBe(true);

  await staff.goto("/app");
  const done = staff.locator("section[aria-labelledby=t-list] li").filter({ hasText: client.name }).filter({ hasText: "GSTR-1 test return" });
  await expect(done).toBeVisible();
  await staff.locator("section.today-list").screenshot({ path: test.info().outputPath("papers-in-on-today.png") });
  await done.getByRole("link", { name: `See papers: ${client.name}` }).click();
  await expect(staff.getByText("Every paper is in, so the reminders have stopped.")).toBeVisible();
  await staff.reload();
  await staff.screenshot({ path: test.info().outputPath("papers-all-in.png") });
  await staff.getByRole("button", { name: "Check the figures" }).click();
  await expect(staff).toHaveURL(new RegExp(`/app/clients/${client.id}\\?tab=extraction`));
  await staff.goto("/app");
  await expect(staff.locator("section[aria-labelledby=t-list]")).toBeVisible();
  await expect(done).toHaveCount(0);
});

test("a TDS client is asked for the quarter's TDS papers, its reply is filed under TDS, and the person is told to prepare the statement", async () => {
  const tds = { name: `TDS Traders ${tag}`, email: `tds-${tag}@patel.test`, id: "" };
  await makeMailbox(tds.email);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(tds.name);
  await owner.getByLabel("Email", { exact: true }).fill(tds.email);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(tds.name);
  tds.id = owner.url().split("/").at(-1)!;
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) select $1, $2, user_id, 'staff' from public.firm_members where firm_id = $1 and role = 'staff'", [firm.firmId, tds.id]);
  // Its TDS statement for Oct to Dec, due in 10 days, on a date the owner confirmed for the firm.
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'TDS_RET', '2026-12', $3)", [firm.firmId, tds.id, day(10)]);
  await query(local.dbUrl, "insert into public.firm_due_dates (firm_id, code, confirmed_by, source_url) select $1, 'TDS_RET', user_id, 'https://example.test/notification' from public.firm_members where firm_id = $1 and role = 'owner'", [firm.firmId]);
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'reminders', 'firm', $1, $2)", [firm.firmId, `reminders:test:${randomUUID()}`]);
  await runJobs(owner.request, firm.firmId);
  const [sent] = await mailTexts(tds.email);
  expect(sent).toContain("for Oct to Dec 2026, please send these documents: TDS register (payments and the tax deducted on them), Salary register (if tax was deducted from salaries), TDS challans (the tax deposited).");

  // The reply: two registers by their names, and a challan receipt known only by what it prints.
  await testSmtp.sendMail({
    from: tds.email, to: office, subject: "Re: Documents needed", text: "Please find attached.",
    attachments: [
      { filename: "TDS register Q3 2026-27.csv", content: "Deductee PAN,Deductee name,Section code\n" },
      { filename: "salary_register_dec_2026.csv", content: "Employee,Salary\n" },
      { filename: "receipt_dec_2026.pdf", content: Buffer.from(pdf("Challan No./ITNS 281N")) },
    ],
  });
  await pollFirmMail(staff.request, firm.firmId);
  const request = async () => (await query(local.dbUrl, "select id, status from public.requests where client_id = $1 and kind = 'documents'", [tds.id]))[0];
  await expect.poll(async () => { await runJobs(staff.request, firm.firmId); return (await request()).status; }, { timeout: 30_000 }).toBe("done");
  expect(await query(local.dbUrl, "select document_type, work_type, period_key, status from public.documents where client_id = $1 order by document_type", [tds.id])).toEqual(
    ["Salary register", "TDS challans", "TDS register"].map((document_type) => ({ document_type, work_type: "tds", period_key: "2026-12", status: "filed" })),
  );

  await staff.goto("/app");
  const ready = staff.locator("section[aria-labelledby=t-list] li").filter({ has: staff.getByRole("button", { name: `Prepare statement: ${tds.name}` }) });
  await expect(ready).toContainText("2 registers");
  await ready.getByRole("button", { name: `Prepare statement: ${tds.name}` }).click();
  await expect(staff).toHaveURL(new RegExp(`/app/clients/${tds.id}/tds\\?period=2026-12`));
  await staff.goto("/app");
  await expect(staff.locator("section[aria-labelledby=t-list]")).toBeVisible();
  await expect(ready).toHaveCount(0);
});
