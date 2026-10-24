import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { TEST_WORKER_SECRET } from "../../playwright.config";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// The Inbox reads mail live from the firm's mailbox (the local GreenMail server) and keeps
// none of it; the team answers from the open conversation. Skipped without local Supabase.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `inbox-owner-${tag}@example.test`;
// GreenMail makes a mailbox for every address it receives mail for, its password the address.
const office = `inbox-office-${tag}@firm.test`;
const clientEmail = `inbox-client-${tag}@patel.test`;
const clientName = `Inbox Client ${tag}`;
const ownerKey = Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");
const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let clientId = "";

const mailbox = async <T,>(address: string, work: (imap: ImapFlow) => Promise<T>) => {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  await imap.connect();
  try { return await work(imap); } finally { await imap.logout(); }
};
// What a provider such as Gmail does with mail sent over SMTP: a copy in the Sent folder.
const intoSent = (raw: string) => mailbox(office, async (imap) => {
  if (!(await imap.list()).some((box) => box.path === "Sent")) await imap.mailboxCreate("Sent");
  await imap.append("Sent", raw, ["\\Seen"]);
});
const readMail = async () => {
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await owner.request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
};
const list = () => owner.getByRole("list", { name: "Emails" });
const pane = () => owner.getByRole("article", { name: "Open email" });

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Inbox Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await smtp.sendMail({ from: "setup@invented.test", to: office, subject: "Invented test setup", text: "Makes the test mailbox" });
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
  await owner.goto("/app/settings");
  const card = owner.locator("section#mailbox");
  await card.getByLabel("The firm's email address").fill(office);
  await card.getByLabel("Its password").fill(office);
  await card.getByText("Change server settings").click();
  await card.getByLabel("Incoming (IMAP) server").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing (SMTP) server").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${office}`);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(clientName);
  await owner.getByLabel("Email", { exact: true }).fill(clientEmail);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(clientName);
  [{ id: clientId }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1", [firm.firmId]);
});
test.afterAll(() => firm.remove());

test("client mail and the firm's sent mail show live, filtered by URL, and nothing of them is kept", async () => {
  await smtp.sendMail({ from: clientEmail, to: office, subject: `Meeting ${tag}`, text: "Dear Sir,\n\nCan we meet next week about the audit?\n\nRegards, Meera" });
  await readMail();
  await intoSent(`From: ${office}\r\nTo: ${clientEmail}\r\nSubject: Reminder: sales register\r\nMessage-ID: <reminder-${clientId}-2026-10-24@inboxca.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nWe still need your sales register for September.\r\n`);
  await intoSent(`From: ${office}\r\nTo: stranger-${tag}@else.test\r\nSubject: Private ${tag}\r\nMessage-ID: <private-${tag}@firm.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nNot a client.\r\n`);

  await owner.goto("/app/inbox");
  const incoming = list().getByRole("listitem").filter({ hasText: `Meeting ${tag}` });
  await expect(incoming).toContainText(clientName);
  await expect(incoming).toContainText("Can we meet next week about the audit?");
  await expect(incoming).toContainText("Needs reply");
  await expect(list().getByRole("listitem").filter({ hasText: "Reminder: sales register" })).toContainText("Reminder sent");
  await expect(list()).not.toContainText(`Private ${tag}`);
  await expect(owner.getByRole("link", { name: /^Needs reply/ })).toContainText("1");

  // Opening an email reads its conversation; the address keeps it open.
  await incoming.getByText(`Meeting ${tag}`).click();
  await expect(pane().getByRole("heading", { name: `Meeting ${tag}` })).toBeVisible();
  await expect(pane()).toContainText("Can we meet next week about the audit?");
  const [{ id: mail }] = await query(local.dbUrl, "select id from public.email_events where firm_id = $1", [firm.firmId]);
  await expect(owner).toHaveURL(new RegExp(`mail=${mail}`));
  await owner.goto(`/app/inbox?client=${clientId}&show=out`);
  await expect(list().getByRole("listitem")).toHaveCount(1);
  await owner.goto("/app/inbox?q=audit");
  await expect(list().getByRole("listitem")).toHaveCount(1);
  await owner.goto("/app/inbox?q=nothing-like-this");
  await expect(owner.getByText("No emails match")).toBeVisible();
  await owner.goto("/app/inbox?status=reminder");
  await expect(list().getByRole("listitem")).toHaveCount(1);
  await expect(list()).toContainText("Reminder: sales register");

  // No subject, text or line of the email is stored anywhere in the firm's records.
  const kept = await query(local.dbUrl, "select (select coalesce(jsonb_agg(e), '[]') from public.email_events e where e.firm_id = $1)::text || (select coalesce(jsonb_agg(l), '[]') from public.activity_log l where l.firm_id = $1)::text as text", [firm.firmId]);
  expect(kept[0].text).not.toContain("audit");
  expect(kept[0].text).not.toContain(`Meeting ${tag}`);

  // A mailbox that cannot be reached leaves the list with what InboxCA knows, and says so.
  await query(local.dbUrl, "update public.connected_accounts set settings = jsonb_set(settings, '{imap,port}', '3999') where firm_id = $1 and kind = 'mail'", [firm.firmId]);
  await owner.goto("/app/inbox");
  await expect(owner.getByRole("alert").filter({ hasText: "could not be reached" })).toBeVisible();
  await expect(list().getByRole("listitem").filter({ hasText: clientName })).toContainText("Needs reply");
  await query(local.dbUrl, "update public.connected_accounts set settings = jsonb_set(settings, '{imap,port}', '3143') where firm_id = $1 and kind = 'mail'", [firm.firmId]);
});

test("the team replies in the conversation from the firm's mailbox, threaded, and the email is done", async () => {
  const [{ id: mail, provider_message_id: original }] = await query(local.dbUrl, "select id, provider_message_id from public.email_events where firm_id = $1", [firm.firmId]);
  await owner.goto(`/app/inbox?mail=${mail}`);
  await expect(pane().getByRole("button", { name: "Write a reply with AI" })).toBeDisabled();
  await owner.keyboard.press("r");
  await expect(owner.getByLabel("Your reply")).toBeFocused();
  await owner.getByLabel("Your reply").fill("Yes, Tuesday at 11 works for us.");
  await owner.getByRole("button", { name: "Send reply" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible();

  const reply = await mailbox(clientEmail, async (imap) => {
    await imap.mailboxOpen("INBOX");
    const message = await imap.fetchOne("*", { source: true });
    return simpleParser(message && message.source ? message.source : "");
  });
  expect(reply.subject).toBe(`Re: Meeting ${tag}`);
  expect(reply.inReplyTo).toBe(original);
  expect([reply.references].flat()).toContain(original);
  expect(reply.text).toContain("Tuesday at 11");
  expect(await query(local.dbUrl, "select status from public.requests where firm_id = $1 and kind = 'team_reply'", [firm.firmId])).toEqual([{ status: "done" }]);
  const [{ details }] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'email.replied'", [firm.firmId]);
  expect(details).toEqual({ files: 0, papers: [] });

  // The reply was put in the Sent folder, so the conversation shows it, after the email.
  await owner.reload();
  const messages = pane().getByRole("list", { name: "Conversation" }).getByRole("listitem");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(1)).toContainText("Your team");
  await expect(messages.nth(1)).toContainText("Tuesday at 11");
  await expect(list().getByRole("listitem").filter({ hasText: `Meeting ${tag}`, hasNotText: "Re:" })).toContainText("Done");
  await expect(list().getByRole("listitem").filter({ hasText: `Re: Meeting ${tag}` })).toContainText("Sent by team");
});

test("an attachment shows where it was saved in the drive, and opens in the viewer", async () => {
  await owner.goto("/app/settings");
  const card = owner.locator("section#drive");
  await card.getByLabel("Test drive on this computer").check();
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveText("Connected: Test drive on this computer");
  await smtp.sendMail({ from: clientEmail, to: office, subject: "September purchase bills", text: "Sir,\n\nAttaching all purchase bills for September.\n\nMeera", attachments: [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }] });
  // The first sweep reads the mail; the second files its attachment.
  for (let sweep = 0; sweep < 2; sweep++) await readMail();
  await owner.goto("/app/inbox?show=in");
  await list().getByText("September purchase bills").click();
  const file = pane().getByRole("list", { name: "Attachments" }).getByRole("listitem");
  await expect(file).toContainText(`${clientName} - Purchase bills - Sep 2026.pdf`);
  await expect(file).toContainText(`Saved to FY 2026-27 / ${clientName} / GST`);
  const [{ id }] = await query(local.dbUrl, "select id from public.documents where firm_id = $1", [firm.firmId]);
  await expect(file.getByRole("link", { name: "View" })).toHaveAttribute("href", `/app/files/${id}/view`);
  await expect(list().getByRole("listitem").filter({ hasText: "September purchase bills" })).toContainText("Filed");
});

test("the team writes a new email to a client, only to the client's known addresses, with a paper and a file", async () => {
  // The Inbox's button opens the writing panel; the client is picked like the filter's.
  await owner.goto("/app/inbox");
  await owner.getByRole("link", { name: "Write to a client" }).click();
  const panel = owner.getByRole("dialog", { name: "Write to a client" });
  await panel.getByRole("link", { name: clientName }).click();
  await expect(owner).toHaveURL(new RegExp(`compose=${clientId}`));
  // The client's page opens the same panel with the client chosen.
  await owner.goto(`/app/clients/${clientId}`);
  await owner.getByRole("link", { name: "Write to client" }).click();
  await expect(owner).toHaveURL(new RegExp(`/app/inbox\\?compose=${clientId}$`));
  await expect(panel.getByRole("checkbox", { name: `${clientName}, ${clientEmail}` })).toBeChecked();
  await expect(panel.getByRole("textbox", { name: "To" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Write with AI" })).toBeDisabled();

  await panel.getByLabel("Subject").fill(`Audit plan ${tag}`);
  await panel.getByLabel("Your email").fill("Dear Meera,\n\nWe start the audit on Monday.");
  await panel.getByLabel("Add a paper from the drive").selectOption({ label: `${clientName} - Purchase bills - Sep 2026.pdf` });
  await panel.getByLabel("Upload a file").setInputFiles({ name: "audit_plan.txt", mimeType: "text/plain", buffer: Buffer.from("Invented audit plan") });
  await expect(panel.getByText("audit_plan.txt")).toBeVisible();
  await panel.getByRole("button", { name: "Send email" }).click();
  const sent = owner.getByRole("status").filter({ hasText: "Email sent" });
  await expect(sent).toBeVisible();
  await expect(sent).not.toContainText("could not go");

  const received = await mailbox(clientEmail, async (imap) => {
    await imap.mailboxOpen("INBOX");
    const all = [];
    for await (const message of imap.fetch("1:*", { source: true })) all.push(await simpleParser(message.source ?? ""));
    return all;
  });
  const written = received.find((message) => message.subject === `Audit plan ${tag}`);
  expect(written?.text).toContain("We start the audit on Monday.");
  expect(written?.attachments.map((file) => file.filename)).toEqual(["audit_plan.txt"]);
  expect(received.find((message) => message.subject === `${clientName} - Purchase bills - Sep 2026.pdf`)?.text).toContain("/s/");
  const [{ id: paper }] = await query(local.dbUrl, "select id from public.documents where firm_id = $1", [firm.firmId]);
  const [{ details }] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'email.written' and entity_id = $2", [firm.firmId, clientId]);
  expect(details).toEqual({ to: 1, files: 1, papers: [paper] });
});
