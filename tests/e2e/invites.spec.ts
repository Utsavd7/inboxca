import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import nodemailer from "nodemailer";
import { TEST_WORKER_SECRET } from "../../playwright.config";
import { financialYear } from "@/src/lib/drive";
import { emailStep, latestEmail, localSupabase, query, seedFirm, totp } from "./local-supabase";

// The owner invites a new person, who signs in from the invite email, sets up a 2 step
// code and joins the firm. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `owner-${tag}@example.test`;
const newEmail = `new-${tag}@example.test`;
const mailClient = `Mail Client ${tag}`;
// A base32 authenticator key, given to the owner directly so their sign in is quick.
const ownerKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let person: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Invite Test Firm", ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  person = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove(newEmail));

test("the owner invites a new person, who appears as invited", async () => {
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "People" }).click();
  await expect(owner.getByText(ownerEmail)).toBeVisible();
  await owner.getByLabel("Their work email").fill(newEmail.toUpperCase());
  await owner.getByLabel("Role").selectOption("manager");
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${newEmail}`);
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).toContainText("Invited");

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already on your firm's list" })).toBeVisible();
});

test("the invited person signs in from the email, sets up 2 step and joins", async ({ baseURL }) => {
  const page = person;
  const { link } = await latestEmail(local.mailUrl, newEmail);
  const target = new URL(link!);
  await page.goto(`${baseURL}${target.pathname}${target.search}`);
  await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  const key = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Invite Test Firm has invited you as manager.")).toBeVisible();
  await page.getByRole("button", { name: "Join Invite Test Firm" }).click();
  await expect(page.locator(".page-head")).toContainText("Invite Test Firm");
  await expect(page.locator(".rail-me")).toContainText("Manager");
  // A manager's sidebar has People but not Settings, which is the owner's.
  await expect(page.getByRole("link", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByText(/has invited you/)).toHaveCount(0);

  // Only the owner invites.
  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).not.toContainText("Invited");
});

test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  // A new role saves as soon as it is picked.
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByLabel(`Role for ${newEmail}`).selectOption("staff"),
  ]);
  await owner.reload();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("Removed");
  await row.getByRole("button", { name: "Bring back" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
});

test("the owner keeps people to office hours, and the person sees the firm is closed", async () => {
  await owner.getByRole("link", { name: "Settings" }).click();
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
    await owner.getByRole("row", { name: new RegExp(day) }).getByLabel("Open", { exact: true }).uncheck();
  await owner.getByLabel(/only during office hours/).check();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");

  await owner.getByLabel("Add a holiday").fill("2026-12-25");
  await owner.getByRole("button", { name: "Add holiday" }).click();
  await expect(owner.getByText("Friday, 25 December 2026")).toBeVisible();

  await person.goto("/app");
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm is closed now.");
  await owner.goto("/app");
  await expect(owner.locator(".page-head")).toContainText("Invite Test Firm");

  // Special hours for today open the firm again, closed weekdays or not.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await owner.goto("/app/settings");
  for (const [label, value] of [["From", today], ["To", today], ["Opens", "00:00"], ["Closes", "23:59"]])
    await owner.getByLabel(label, { exact: true }).fill(value);
  await owner.getByRole("button", { name: "Add special hours" }).click();
  await expect(owner.getByText("00:00 to 23:59")).toBeVisible();
  await person.reload();
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm");
  await expect(person.getByRole("heading", { level: 1 })).not.toContainText("closed");
});

test("in restricted mode a person sees only clients assigned to them or their team", async () => {
  await owner.goto("/app/clients");
  await owner.getByLabel("Name", { exact: true }).fill("Shared Client");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText("Shared Client");
  const client = owner.url();

  await owner.goto("/app/settings");
  await owner.getByLabel(/Only you, partners and the people assigned/).check();
  await owner.getByRole("button", { name: "Save who sees clients" }).click();
  await expect(owner.getByRole("status")).toHaveText("Who sees clients saved.");
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "0 clients" })).toBeVisible();

  // A team: the person joins it, and the client is assigned to the whole team.
  await owner.goto("/app/people");
  await owner.getByLabel("New team").fill("GST team");
  await owner.getByRole("button", { name: "Add team" }).click();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByLabel(`Team for ${newEmail}`).selectOption({ label: "GST team" }),
  ]);
  await expect(owner.locator("section[aria-labelledby=teams]").getByRole("listitem")).toContainText("1 person");
  await owner.goto(`${client}?tab=team`);
  await owner.getByLabel("Person or team").selectOption({ label: "Team: GST team" });
  await owner.getByRole("button", { name: "Assign" }).click();
  await expect(owner.getByRole("listitem").filter({ hasText: "Team: GST team" })).toContainText("Staff");
  await person.reload();
  await expect(person.getByRole("link", { name: "Shared Client" })).toBeVisible();
  await expect(person.getByRole("heading", { name: "1 client", exact: true })).toBeVisible();
});

test("after the firm's idle limit, an unattended screen signs out", async () => {
  await owner.goto("/app/settings");
  await owner.getByLabel(/only during office hours/).uncheck();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");
  await owner.getByLabel("Sign out after no activity for").selectOption("15");
  await owner.getByRole("button", { name: "Save signing in limits" }).click();
  await expect(owner.getByRole("status")).toHaveText("Signing in limits saved.");

  await person.clock.install();
  await person.goto("/app");
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm");
  await person.clock.fastForward("16:00");
  await expect(person).toHaveURL(/\/sign-in\?reason=idle$/);
  await expect(person.getByRole("status")).toContainText("signed out after a while without activity");
  await person.goto("/app");
  await expect(person).toHaveURL(/\/sign-in$/);
});

test("the owner connects the firm's mailbox; client mail is sorted, unclear mail waits for the team, a stranger's is skipped", async ({ request }) => {
  await owner.goto("/app/settings");
  const card = owner.locator("section[aria-labelledby=mailbox]");
  await card.getByLabel("The firm's email address").fill("office@firm.test");
  await card.getByLabel("Its password").fill("wrong");
  await card.getByText("Server settings, only if InboxCA asks").click();
  await card.getByLabel("Incoming (IMAP) server").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing (SMTP) server").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("alert")).toContainText("could not sign in");
  await card.getByLabel("Its password").fill("secret");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText("Connected: office@firm.test");

  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(mailClient);
  await owner.getByLabel("Email", { exact: true }).fill(`client-${tag}@patel.test`);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(mailClient);
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  for (const from of [`Client-${tag}@Patel.test`, `stranger-${tag}@else.test`])
    await smtp.sendMail({ from, to: "office@firm.test", subject: "Please send last year's ITR", text: "Thanks" });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const events = await query(local.dbUrl, "select (client_id is not null) as matched, label from public.email_events where firm_id = $1", [firm.firmId]);
  expect(events).toEqual([{ matched: true, label: "records_past" }]);

  // A second email the rules cannot place waits for the team, and a person corrects a label.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "Hello", text: "Can we meet next week?" });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.getByRole("link", { name: "Inbox" }).click();
  const waiting = owner.locator("section[aria-labelledby=team-reply]").getByRole("listitem");
  await expect(waiting).toContainText("InboxCA could not tell what it asks");
  await waiting.getByRole("button", { name: "Done" }).click();
  await expect(owner.getByText("Nothing waits for the team.")).toBeVisible();
  const latest = owner.locator("section[aria-labelledby=latest] tbody tr");
  await expect(latest).toHaveCount(2);
  await latest.first().getByRole("combobox").selectOption({ label: "Asks for this year's records" });
  await expect(latest.filter({ hasText: "Corrected" })).toHaveCount(1);
});

test("the owner connects a drive only after agreeing to the Drive access terms", async () => {
  await owner.goto("/app/settings");
  const card = owner.locator("section#drive");
  await expect(card.getByLabel(/OneDrive/)).toBeDisabled();
  await card.getByLabel("Test drive on this computer").check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveCount(0);
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveText("Connected: Test drive on this computer");
  const [consent] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'drive.consent'", [firm.firmId]);
  expect(consent.details).toEqual({ provider: "local", level: "whole_drive", terms_version: "2026-10-17" });
});

test("a client's attachments are filed into its folder in the drive; an unclear one waits under To check", async ({ request }) => {
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  await smtp.sendMail({
    from: `client-${tag}@patel.test`,
    to: "office@firm.test",
    subject: "GST data",
    text: "Please find the bills attached.",
    attachments: [
      { filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" },
      { filename: "scan001.pdf", content: "%PDF-1.4 invented scan" },
    ],
  });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  // The first sweep reads the mail; the second files its attachments.
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  // Bills for September 2026 belong to FY 2026-27; the scan names no period, so it goes in the year it arrived.
  const drive = path.join(tmpdir(), "inboxca-test-drive");
  expect(await readFile(path.join(drive, "FY 2026-27", mailClient, "GST", `${mailClient} - Purchase bills - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  const thisYear = financialYear(new Date().toISOString().slice(0, 7));
  expect(await readFile(path.join(drive, thisYear, mailClient, "GST", "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");

  await owner.goto("/app/clients");
  await owner.getByRole("link", { name: mailClient }).click();
  await owner.getByRole("link", { name: /^Files/ }).click();
  const rows = owner.locator("section[aria-labelledby=files] tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
  // A file opens in the view-only viewer. The owner also gets the file itself, sandboxed;
  // for the viewer it comes as plain bytes, which a browser never shows on its own.
  await rows.getByRole("link", { name: `${mailClient} - Purchase bills - Sep 2026.pdf`, exact: true }).click();
  await expect(owner.getByText("View only. Your email and the time are shown across every page.")).toBeVisible();
  const raw = owner.url().replace(/\/view$/, "");
  const file = await owner.request.get(raw);
  expect(await file.text()).toBe("%PDF-1.4 invented purchase bills");
  expect(file.headers()).toMatchObject({ "content-type": "application/pdf", "content-security-policy": "sandbox" });
  expect((await owner.request.get(`${raw}?view=1`, { headers: { "x-inboxca-viewer": "1" } })).headers()["content-type"]).toBe("application/octet-stream");
  await owner.goBack();

  // A person names the unclear scan: it moves out of To check under its new name, and Undo puts it back.
  await rows.getByRole("link", { name: `Change ${mailClient} - Document.pdf` }).click();
  await owner.getByLabel("Type", { exact: true }).selectOption("Other");
  await owner.getByLabel("Name for Other").fill("HDFC loan sanction letter");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - HDFC loan sanction letter.pdf`);
  const gst = path.join(drive, thisYear, mailClient, "GST");
  expect(await readFile(path.join(gst, `${mailClient} - HDFC loan sanction letter.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");
  await owner.getByRole("button", { name: "Undo" }).click();
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
  expect(await readFile(path.join(gst, "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");

  // The same bills sent again wait under To check beside the first copy, for the team to choose.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "Bills again", text: "Sending again.", attachments: [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }] });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.reload();
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");

  // The owner removes the second copy: it waits in the drive's Deleted and old versions folder and can be put back.
  await rows.filter({ hasText: "Same file as" }).getByRole("button", { name: /^Remove/ }).click();
  await expect(owner.getByRole("status")).toContainText("waits 30 days");
  expect(await readFile(path.join(drive, "Deleted and old versions", `${mailClient} - Purchase bills - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  await expect(rows).toHaveCount(2);
  await owner.getByRole("button", { name: "Put back" }).first().click();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");

  // A manager or the owner uploads a file and types it; it is saved under its name in the client's folder.
  await owner.getByRole("link", { name: "Upload a file" }).click();
  await owner.getByLabel("File", { exact: true }).setInputFiles({ name: "IMG_2041.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 invented form 16") });
  await owner.getByLabel("Type", { exact: true }).selectOption("Form 16");
  await owner.getByLabel("Work", { exact: true }).selectOption("income_tax");
  await owner.getByLabel("Period", { exact: true }).selectOption({ label: "FY 2025-26" });
  await owner.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - Form 16 - FY 2025-26.pdf`);
  expect(await readFile(path.join(drive, "FY 2025-26", mailClient, "Income tax", `${mailClient} - Form 16 - FY 2025-26.pdf`), "utf8")).toBe("%PDF-1.4 invented form 16");

  await owner.goto("/app/settings");
  for (const section of ["section[aria-labelledby=mailbox]", "section#drive"]) await owner.locator(section).getByRole("button", { name: "Disconnect" }).click();
  await expect(owner.locator("section#drive").getByRole("button", { name: "Connect drive" })).toBeVisible();
  await expect(owner.locator("section[aria-labelledby=mailbox]").getByLabel("The firm's email address")).toBeVisible();
});
