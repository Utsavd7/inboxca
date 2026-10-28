import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { emailStep, localSupabase, pollFirmMail, query, seedFirm, totp } from "./local-supabase";

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
const readMail = () => pollFirmMail(owner.request, firm.firmId);
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
  await card.getByLabel("Incoming mail server (IMAP)").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing mail server (SMTP)").fill("127.0.0.1");
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
  // The same from the Filters menu; a filter in use is a chip that takes itself away.
  await owner.goto("/app/inbox");
  await owner.locator("summary", { hasText: "Filters" }).click();
  await owner.getByRole("group", { name: "Email" }).getByRole("link", { name: "Sent to clients" }).click();
  await expect(list().getByRole("listitem")).toHaveCount(1);
  await owner.getByRole("link", { name: "Remove filter: Sent to clients" }).click();
  await expect(list().getByRole("listitem").filter({ hasText: `Meeting ${tag}` })).toBeVisible();
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
  // Without AI set up there is no AI button at all.
  await expect(pane().getByRole("button", { name: "Write a reply with AI" })).toHaveCount(0);
  // The keys work once the page has loaded its script; a press before that is simply not heard.
  await expect(async () => {
    await owner.keyboard.press("r");
    await expect(owner.getByLabel("Your reply")).toBeFocused({ timeout: 1000 });
  }).toPass();
  // A quick reply writes the email in the firm's voice, ready to change.
  await pane().getByRole("group", { name: "Quick replies" }).getByRole("button", { name: "Received, thank you" }).click();
  await expect(owner.getByLabel("Your reply")).toHaveValue(new RegExp(`^Dear ${clientName},\\n\\nThank you, we have received your email[\\s\\S]*Regards,\\nInbox Firm ${tag}$`));
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
  await expect(list().getByRole("listitem").filter({ hasText: `Meeting ${tag}`, hasNotText: "Re:" })).toContainText("Answered by your team");
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
  await expect(list().getByRole("listitem").filter({ hasText: "September purchase bills" })).toContainText("Papers saved");
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
  await expect(panel.getByRole("button", { name: "Write with AI" })).toHaveCount(0);

  await panel.getByLabel("Subject").fill(`Audit plan ${tag}`);
  await panel.getByLabel("Your email").fill("Dear Meera,\n\nWe start the audit on Monday.");
  await panel.getByLabel("Add a paper from the drive").selectOption({ label: `${clientName} - Purchase bills - Sep 2026.pdf` });
  await panel.getByLabel("Upload a file").setInputFiles({ name: "audit_plan.txt", mimeType: "text/plain", buffer: Buffer.from("Invented audit plan") });
  await expect(panel.getByText("audit_plan.txt")).toBeVisible();
  await panel.getByRole("button", { name: "Send email" }).click();
  const sent = owner.getByRole("status").filter({ hasText: "Email sent" });
  await expect(sent).toBeVisible();
  await expect(sent).not.toContainText("were not sent");

  const received = await mailbox(clientEmail, async (imap) => {
    await imap.mailboxOpen("INBOX");
    const all = [];
    for await (const message of imap.fetch("1:*", { source: true })) all.push(await simpleParser(message.source ?? ""));
    return all;
  });
  const written = received.find((message) => message.subject === `Audit plan ${tag}`);
  expect(written?.text).toContain("We start the audit on Monday.");
  expect(written?.attachments.map((file) => file.filename)).toEqual(["audit_plan.txt"]);
  expect(received.find((message) => message.subject?.startsWith("Purchase bills for Sep 2026 from "))?.text).toContain("/s/");
  const [{ id: paper }] = await query(local.dbUrl, "select id from public.documents where firm_id = $1", [firm.firmId]);
  const [{ details }] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'email.written' and entity_id = $2", [firm.firmId, clientId]);
  expect(details).toEqual({ to: 1, files: 1, papers: [paper] });
});

test("a notice that asks something waits for a reply; Mark done clears it, with Undo; Esc closes the email", async () => {
  await smtp.sendMail({ from: clientEmail, to: office, subject: `GST notice ${tag}`, text: "Sir, we received a notice from the GST department. What should we do? Please call." });
  await readMail();
  // Today says why it waits, in plain words, and when it came.
  await owner.goto("/app");
  await expect(owner.locator("section[aria-labelledby=t-list] li").filter({ has: owner.getByRole("link", { name: `Reply to ${clientName}` }) })).toContainText("Sent a notice and asks what to do");

  await owner.goto("/app/inbox?show=reply");
  const row = list().getByRole("listitem").filter({ hasText: `GST notice ${tag}` });
  await expect(row).toContainText("Needs reply");
  await row.getByText(`GST notice ${tag}`).click();
  await expect(pane().getByRole("heading", { name: `GST notice ${tag}` })).toBeVisible();
  await expect(pane()).toContainText("Notice received");
  await expect(pane()).toContainText("Sent a notice and asks what to do");
  const [{ id: request }] = await query(local.dbUrl, "select r.id from public.requests r join public.email_events e on e.id = r.entity_id where r.firm_id = $1 and r.kind = 'team_reply' and e.label = 'notice_received'", [firm.firmId]);
  const status = async () => (await query(local.dbUrl, "select status from public.requests where id = $1", [request]))[0].status;

  // The e key takes it out of Needs reply; the toast undoes that.
  await owner.keyboard.press("e");
  const toast = owner.getByRole("status").filter({ hasText: "Marked done." });
  await expect(toast).toBeVisible();
  expect(await status()).toBe("done");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(pane().getByRole("button", { name: "Mark done" })).toBeVisible();
  expect(await status()).toBe("pending");
  await pane().getByRole("button", { name: "Mark done" }).click();
  await expect(toast).toBeVisible();
  expect(await status()).toBe("done");

  // Esc closes the open email back to the list.
  await owner.locator("body").click({ position: { x: 1, y: 1 } });
  await owner.keyboard.press("Escape");
  await expect(owner).not.toHaveURL(/mail=/);
  await expect(pane()).toContainText("Pick an email to read it here.");

  // The label is a tag with a small menu to change it.
  await owner.goto("/app/inbox?show=in");
  await list().getByText(`GST notice ${tag}`).click();
  await pane().getByLabel("Change label").click();
  await pane().getByRole("form", { name: "What this email is" }).getByRole("button", { name: "GST data" }).click();
  await expect(pane().getByText("Corrected")).toBeVisible();
  expect(await query(local.dbUrl, "select label, decision_source from public.email_events e join public.requests r on r.entity_id = e.id where r.id = $1", [request])).toEqual([{ label: "data_gst", decision_source: "staff" }]);

  // The client's page lists its emails by subject, read live, with who sent it and when.
  await owner.goto(`/app/clients/${clientId}?tab=emails`);
  const mailRow = owner.locator("section[aria-labelledby=client-mail] li").filter({ has: owner.getByRole("link", { name: new RegExp(`GST notice ${tag}`) }) });
  await expect(mailRow).toContainText(`From ${clientName}, `);
});

test("an email that needs a reply is given to a teammate, snoozed to a day, marked done with the rest, and unmatched mail is filed to a client", async () => {
  for (const subject of [`Question A ${tag}`, `Question B ${tag}`]) await smtp.sendMail({ from: clientEmail, to: office, subject, text: "Sir, what is the status of our file?" });
  await readMail();
  const requestOf = async (subject: string) => {
    await owner.goto("/app/inbox?show=reply");
    await list().getByText(subject).click();
    await expect(pane().getByRole("heading", { name: subject })).toBeVisible();
    const mail = new URL(owner.url()).searchParams.get("mail");
    return { mail, request: (await query(local.dbUrl, "select id from public.requests where entity_id = $1", [mail]))[0].id as string };
  };
  const details = async (request: string) => (await query(local.dbUrl, "select details from public.requests where id = $1", [request]))[0].details;
  const { request: a } = await requestOf(`Question A ${tag}`);

  // With nobody assigned to the client, its email is for the owner: For you on the row, and in
  // Mine. Assign changes it: to nobody, then to a teammate.
  await expect(list().getByRole("listitem").filter({ hasText: `Question A ${tag}` })).toContainText("For you");
  await expect(owner.getByRole("link", { name: /^Mine/ })).toContainText("2");
  await pane().getByLabel(/^For you/).click();
  await pane().getByRole("form", { name: "Assign to" }).getByRole("button", { name: "Nobody" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Nobody is assigned now." })).toBeVisible();
  expect(await details(a)).toEqual({ assignee: null });
  await expect(owner.getByRole("link", { name: /^Mine/ })).toContainText("1");
  await pane().getByLabel("Assign", { exact: true }).click();
  await pane().getByRole("form", { name: "Assign to" }).getByRole("button", { name: /\(you\)/ }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Assigned to you." })).toBeVisible();
  expect(await details(a)).toEqual({ assignee: firm.ownerId });
  await expect(owner.getByRole("link", { name: /^Mine/ })).toContainText("2");
  await owner.getByRole("link", { name: /^Mine/ }).click();
  await expect(list().getByRole("listitem")).toHaveCount(2);

  // Snooze until tomorrow (h opens it): out of Needs reply until that day, with Undo.
  await list().getByText(`Question A ${tag}`).click();
  await expect(pane().getByRole("heading", { name: `Question A ${tag}` })).toBeVisible();
  await expect(async () => {
    await owner.keyboard.press("h");
    await expect(pane().getByRole("group", { name: "Snooze until" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await pane().getByRole("group", { name: "Snooze until" }).getByRole("button", { name: /^Tomorrow/ }).click();
  const snoozed = owner.getByRole("status").filter({ hasText: /^Snoozed until .*It comes back to Needs reply that day\./ });
  await expect(snoozed).toBeVisible();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
  expect(await details(a)).toEqual({ assignee: firm.ownerId, snooze: tomorrow });
  await snoozed.getByRole("button", { name: "Undo" }).click();
  await expect(snoozed).toHaveCount(0);
  expect(await details(a)).toEqual({ assignee: firm.ownerId });
  await pane().getByLabel("Snooze", { exact: true }).click();
  await pane().getByLabel("Snooze until a date").fill(tomorrow);
  await pane().getByRole("group", { name: "Snooze until" }).getByRole("button", { name: "Snooze", exact: true }).click();
  await expect(snoozed).toBeVisible();
  await owner.goto("/app/inbox?show=reply");
  await expect(list()).not.toContainText(`Question A ${tag}`);
  await expect(owner.getByRole("link", { name: /^Needs reply/ })).toContainText("1");
  await owner.goto("/app/inbox?status=snoozed");
  await expect(list().getByRole("listitem").filter({ hasText: `Question A ${tag}` })).toContainText("Snoozed until");
  // On the day it comes back by itself.
  await query(local.dbUrl, "update public.requests set details = jsonb_set(details, '{snooze}', to_jsonb($2::text)) where id = $1", [a, today]);
  await owner.goto("/app/inbox?show=reply");
  await expect(list().getByRole("listitem").filter({ hasText: `Question A ${tag}` })).toContainText("Needs reply");

  // Mark all as done, under More: a preview of the list, one button, then Undo brings them all back.
  await owner.getByLabel("More actions").click();
  await owner.getByRole("link", { name: "Mark all done" }).click();
  const panel = owner.getByRole("dialog", { name: "Mark 2 emails done?" });
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("button", { name: "Mark 2 emails done" }).click();
  const cleared = owner.getByRole("status").filter({ hasText: "2 emails marked done." });
  await expect(cleared).toBeVisible();
  const waiting = async () => (await query(local.dbUrl, "select id from public.requests where firm_id = $1 and kind = 'team_reply' and status = 'pending'", [firm.firmId])).length;
  expect(await waiting()).toBe(0);
  await cleared.getByRole("button", { name: "Undo" }).click();
  await expect(list().getByRole("listitem")).toHaveCount(2);
  expect(await waiting()).toBe(2);

  // Mail InboxCA could not match is filed to a client picked from the client list.
  const { mail, request: b } = await requestOf(`Question B ${tag}`);
  await query(local.dbUrl, "update public.email_events set client_id = null where id = $1", [mail]);
  await query(local.dbUrl, "update public.requests set client_id = null, reason_code = 'client_unclear' where id = $1", [b]);
  await owner.goto(`/app/inbox?mail=${mail}`);
  await pane().getByText("Save to a client", { exact: true }).click();
  await pane().getByRole("link", { name: clientName }).click();
  const filing = pane().getByRole("form", { name: "Save to a client" });
  await expect(filing).toContainText(`Save this email to ${clientName}?`);
  await filing.getByRole("button", { name: `Save to ${clientName}` }).click();
  await expect(owner.getByRole("status").filter({ hasText: `Saved to ${clientName}.` })).toBeVisible();
  expect(await query(local.dbUrl, "select client_id from public.email_events where id = $1", [mail])).toEqual([{ client_id: clientId }]);
  expect((await query(local.dbUrl, "select status from public.requests where id = $1", [b]))[0].status).toBe("done");
});
