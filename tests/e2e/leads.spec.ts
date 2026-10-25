import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { TEST_WORKER_SECRET } from "../../playwright.config";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// Leads (PLAN.md 5.12): the firm's public enquiry form, enquiries spotted in its email, the
// board, follow ups from its own mailbox (the local GreenMail server) and turning a lead into
// a client; staff never see leads. Skipped without local Supabase.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const firmName = `Leads Firm ${tag}`;
const ownerEmail = `leads-owner-${tag}@example.test`;
const staffEmail = `leads-staff-${tag}@example.test`;
// GreenMail makes a mailbox for every address it receives mail for, its password the address.
const office = `leads-office-${tag}@firm.test`;
const meera = { name: `Meera Shah ${tag}`, email: `meera-${tag}@prospect.test` };
const ravi = { name: `Ravi Kumar ${tag}`, email: `ravi-${tag}@prospect.test` };
const key = Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");
const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
let firm: Awaited<ReturnType<typeof seedFirm>>;
let staff: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;

const signIn = async (page: Page, email: string) => {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
};
const readMail = async () => {
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await owner.request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
};
const stageOf = async (name: string) => (await query(local.dbUrl, "select stage from public.clients where firm_id = $1 and name = $2", [firm.firmId, name]))[0]?.stage;
const column = (title: string) => owner.getByRole("list", { name: `${title} leads` });

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(firmName, ownerEmail, key);
  staff = await seedFirm(`Leads Staff Setup ${tag}`, staffEmail, key);
  await query(local.dbUrl, "delete from public.firm_members where firm_id = $1", [staff.firmId]);
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, staff.ownerId]);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await smtp.sendMail({ from: "setup@invented.test", to: office, subject: "Invented test setup", text: "Makes the test mailbox" });
  await signIn(owner, ownerEmail);
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
});
test.afterAll(async () => {
  await firm.remove();
  await staff.remove();
});

test("a lead sent through the public form shows on the board, moves, is followed up and becomes a client", async ({ browser }) => {
  await owner.goto("/app/leads");
  await expect(owner.getByText("No leads yet")).toBeVisible();
  await owner.getByRole("link", { name: "Ways in", exact: true }).click();
  await owner.getByRole("button", { name: "Turn on the form" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Your enquiry form is on." })).toBeVisible();
  const link = (await owner.locator(".lead-link .num").textContent())!;
  expect(link).toMatch(/\/f\/[A-Za-z0-9_-]{16}$/);

  // The form needs no sign in. A bot (the hidden field filled, sent at once) is thanked, and
  // nothing is kept.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("heading", { name: `How can ${firmName} help?` })).toBeVisible();
  await expect(visitor.getByText("Private link, only for you")).toHaveCount(0);
  await visitor.getByLabel("Your name").fill("Spam Bot");
  await visitor.getByLabel("Your email").fill(`bot-${tag}@spam.test`);
  await visitor.locator("#lead-website").evaluate((input: HTMLInputElement) => (input.value = "https://spam.test"));
  await visitor.getByRole("button", { name: "Send enquiry" }).click();
  await expect(visitor.getByRole("heading", { name: `Thank you. ${firmName} will reply soon.` })).toBeVisible();

  // A person: what is wrong is said, and what they typed stays.
  await visitor.goto(link);
  await visitor.getByLabel("Your name").fill(meera.name);
  await visitor.getByLabel("Your email").fill("meera-at-prospect");
  await visitor.getByLabel("What do you need help with?").selectOption("gst");
  await visitor.getByLabel("The work is for").selectOption("business");
  await visitor.getByLabel("When is it needed?").selectOption("now");
  await visitor.getByLabel("Anything else we should know?").fill("I am opening a shop and need GST registration.");
  await visitor.waitForTimeout(3200);
  await visitor.getByRole("button", { name: "Send enquiry" }).click();
  await expect(visitor.getByRole("alert").filter({ hasText: "email" })).toHaveText("That email address is not valid.");
  await expect(visitor.getByLabel("Your name")).toHaveValue(meera.name);
  await visitor.screenshot({ path: test.info().outputPath("form.png"), fullPage: true });
  await visitor.getByLabel("Your email").fill(meera.email);
  await visitor.getByRole("button", { name: "Send enquiry" }).click();
  await expect(visitor.getByRole("heading", { name: `Thank you. ${firmName} will reply soon.` })).toBeVisible();
  await visitor.context().close();
  expect((await query(local.dbUrl, "select name, stage from public.clients where firm_id = $1", [firm.firmId])).map((row) => row.name)).toEqual([meera.name]);

  // The firm has it: on Today, due today, and in New.
  await owner.goto("/app");
  await expect(owner.getByRole("region", { name: "Needs you now" })).toContainText(`${meera.name}: new enquiry, reply today.`);
  await owner.goto("/app/leads");
  const card = column("New").getByRole("listitem").filter({ hasText: meera.name });
  await expect(card).toContainText("GST registration or returns");
  await expect(card).toContainText("This week");
  await expect(card).toContainText("Follow up today");

  // Moved with its menu (the keyboard opens it too), then dragged to Proposal.
  await owner.getByRole("button", { name: `Move ${meera.name}` }).focus();
  await owner.keyboard.press("Enter");
  await expect(owner.getByRole("menuitem", { name: "Move to Qualifying" })).toBeFocused();
  await owner.keyboard.press("Enter");
  await expect(column("Qualifying").getByRole("listitem").filter({ hasText: meera.name })).toBeVisible();
  await expect.poll(() => stageOf(meera.name)).toBe("qualifying");
  await column("Qualifying").getByText(meera.name).dragTo(owner.locator("section[aria-labelledby='col-proposal']"));
  await expect(column("Proposal").getByRole("listitem").filter({ hasText: meera.name })).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await owner.screenshot({ path: test.info().outputPath("board.png") });
  await expect.poll(() => stageOf(meera.name)).toBe("proposal");

  // A follow up only when someone sends it, from the firm's mailbox; the next one is 3 days on.
  await column("Proposal").getByRole("link", { name: meera.name }).click();
  const panel = owner.getByRole("dialog", { name: meera.name });
  await expect(panel).toContainText(meera.email);
  await expect(panel).toContainText("0 of 4 follow up emails sent.");
  await panel.getByRole("link", { name: "Write a follow up email" }).click();
  await expect(panel.getByLabel("Subject")).toHaveValue(`Your enquiry with ${firmName}`);
  await expect(panel.getByLabel(`Email to ${meera.email}`)).toHaveValue(new RegExp(`^Dear ${meera.name},\\n\\nThank you for contacting ${firmName} about GST registration or returns\\.`));
  await panel.getByRole("button", { name: "Send follow up" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Follow up email sent." })).toBeVisible();
  await expect(panel).toContainText("1 of 4 follow up emails sent.");
  const inThree = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await expect(panel.getByLabel("Follow up on")).toHaveValue(inThree);
  await panel.screenshot({ path: test.info().outputPath("panel.png") });
  const sent = await new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: meera.email, pass: meera.email }, logger: false });
  await sent.connect();
  await sent.mailboxOpen("INBOX");
  const message = await sent.fetchOne("*", { source: true });
  await sent.logout();
  const mail = await simpleParser(message && message.source ? message.source : "");
  expect(mail.subject).toBe(`Your enquiry with ${firmName}`);
  expect(mail.from?.text).toContain(office);

  // Notes stay sealed; the history says what happened.
  await panel.getByLabel("Notes about this lead").fill("Quoted the GST registration fee.");
  await panel.getByRole("button", { name: "Save notes" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Notes saved." })).toBeVisible();
  await expect(owner.getByRole("dialog", { name: meera.name }).getByLabel("Notes about this lead")).toHaveValue("Quoted the GST registration fee.");
  const stored = await query(local.dbUrl, "select notes_enc, details::text as details from public.clients where firm_id = $1", [firm.firmId]);
  expect(JSON.stringify(stored)).not.toContain("GST registration fee");
  expect(JSON.stringify(stored)).not.toContain("opening a shop");
  const history = owner.getByRole("dialog", { name: meera.name }).getByRole("list").last();
  await expect(history).toContainText("Came in through the enquiry form");
  await expect(history).toContainText("Moved to Proposal by Leads");
  await expect(history).toContainText("Follow up email sent by Leads");

  // Turned into a client: the same row, now in Clients, and won on the board.
  await owner.getByRole("dialog", { name: meera.name }).getByRole("link", { name: "Turn into a client" }).click();
  await owner.getByRole("dialog", { name: meera.name }).getByRole("button", { name: "Turn into a client" }).click();
  await expect(owner).toHaveURL(/\/app\/clients\/[0-9a-f-]{36}$/);
  await expect(owner.locator(".page-head")).toContainText(meera.name);
  await expect.poll(() => stageOf(meera.name)).toBe("client");
  await owner.goto("/app/leads");
  await expect(column("Won").getByRole("listitem").filter({ hasText: meera.name })).toContainText("Now a client");
  const lines = await query(local.dbUrl, "select action from public.activity_log where firm_id = $1 and entity_type = 'client' order by at", [firm.firmId]);
  expect(lines.map((line) => line.action)).toEqual(["lead.added", "lead.moved", "lead.moved", "lead.followed_up", "lead.noted", "lead.won"]);
});

test("an enquiry email from someone new is offered, and added as a lead in one click", async () => {
  await owner.goto("/app/leads?panel=setup");
  await owner.getByRole("button", { name: "Look for enquiries in our email" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "InboxCA now looks for enquiries in your email." })).toBeVisible();
  await smtp.sendMail({ from: `"${ravi.name}" <${ravi.email}>`, to: office, subject: `Enquiry about GST registration ${tag}`, text: "Hello, I am opening a shop in Pune. What are your fees for GST registration?" });
  await smtp.sendMail({ from: `friend-${tag}@prospect.test`, to: office, subject: `Lunch ${tag}`, text: "Are you free on Friday?" });
  await readMail();

  await owner.goto("/app/leads");
  const offers = owner.getByRole("region", { name: "Emails that look like enquiries" });
  const offer = offers.getByRole("listitem").filter({ hasText: ravi.email });
  await expect(offer).toContainText(`Enquiry about GST registration ${tag}`);
  await expect(offers).not.toContainText(`Lunch ${tag}`);
  await expect(offer.getByLabel("Name for the lead")).toHaveValue(ravi.name);
  await expect(offer.getByLabel("Help needed")).toHaveValue("gst");
  await owner.screenshot({ path: test.info().outputPath("offers.png") });
  // It waits here, not in the Inbox, and only its ids are kept.
  const kept = await query(local.dbUrl, "select reason_code, client_id from public.email_events where firm_id = $1", [firm.firmId]);
  expect(kept).toEqual([{ reason_code: "enquiry", client_id: null }]);
  await owner.goto("/app/inbox");
  await expect(owner.getByRole("list", { name: "Emails" }).or(owner.getByText("No client email yet"))).toBeVisible();
  await expect(owner.getByText(`Enquiry about GST registration ${tag}`)).toHaveCount(0);
  await owner.goto("/app/leads");
  await offer.getByRole("button", { name: "Add as lead" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Lead added." })).toBeVisible();
  await expect(owner.getByRole("dialog", { name: ravi.name })).toContainText(ravi.email);
  await owner.goto("/app/leads");
  await expect(column("New").getByRole("listitem").filter({ hasText: ravi.name })).toContainText("GST registration or returns");
  await expect(owner.getByRole("region", { name: "Emails that look like enquiries" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select id from public.email_events where firm_id = $1", [firm.firmId])).toEqual([]);
  const everything = await query(local.dbUrl, "select (select coalesce(jsonb_agg(c), '[]') from public.clients c where c.firm_id = $1)::text || (select coalesce(jsonb_agg(l), '[]') from public.activity_log l where l.firm_id = $1)::text as text", [firm.firmId]);
  expect(everything[0].text).not.toContain("Pune");
  expect(everything[0].text).not.toContain(ravi.email);

  // A lead added by hand after a call, then lost, with the reason.
  await owner.getByRole("link", { name: "Add a lead" }).click();
  await owner.getByRole("dialog", { name: "Add a lead" }).getByLabel("Name", { exact: true }).fill(`Walk In ${tag}`);
  await owner.getByRole("button", { name: "Add lead" }).click();
  const walkIn = owner.getByRole("dialog", { name: `Walk In ${tag}` });
  await expect(walkIn).toContainText("None");
  await walkIn.getByRole("link", { name: "Mark lost" }).click();
  await walkIn.getByLabel("Reason").selectOption("other_firm");
  await walkIn.getByRole("button", { name: "Mark lost" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Lead marked lost." })).toBeVisible();
  await expect(column("Lost").getByRole("listitem").filter({ hasText: `Walk In ${tag}` })).toBeVisible();
  expect((await query(local.dbUrl, "select details->>'lost_reason' as reason from public.clients where firm_id = $1 and name = $2", [firm.firmId, `Walk In ${tag}`]))[0].reason).toBe("other_firm");
});

test("staff, who do not work leads, see no Leads page and no lead anywhere", async ({ browser }) => {
  const person = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(person, staffEmail);
  await expect(person.getByRole("link", { name: "Leads" })).toHaveCount(0);
  await person.goto("/app/leads");
  await expect(person.getByText("This page is for the owner, partners and the front desk")).toBeVisible();
  await expect(person.getByText(ravi.name)).toHaveCount(0);
  await person.goto("/app/clients");
  await expect(person.getByRole("link", { name: meera.name })).toBeVisible();
  await expect(person.getByText(ravi.name)).toHaveCount(0);
  await person.context().close();
});
