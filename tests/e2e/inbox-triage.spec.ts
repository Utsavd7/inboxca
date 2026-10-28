import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { appKey, connectTestMailbox, localSupabase, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp as smtp } from "./local-supabase";

// Inbox steps the other specs leave out: mail from a contact who writes for two clients waits
// until someone says which client, and its attachment is then filed in that client's folder;
// a snoozed email is brought back to Needs reply at once. The mail arrives in the firm's
// mailbox on the local GreenMail server. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `triage-owner-${tag}@example.test`;
const ownerKey = appKey();
const office = `triage-office-${tag}@firm.test`;
const contactEmail = `kiran-${tag}@mehta.test`;
const names = [`Mehta Traders ${tag}`, `Mehta Exports ${tag}`];
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const ids: string[] = [];
const list = () => owner.getByRole("list", { name: "Emails" });
const pane = () => owner.getByRole("article", { name: "Open email" });
const readMail = () => pollFirmMail(owner.request, firm.firmId);
const open = async (subject: string) => {
  await owner.goto("/app/inbox?show=reply");
  await list().getByText(subject).click();
  await expect(pane().getByRole("heading", { name: subject })).toBeVisible();
  return new URL(owner.url()).searchParams.get("mail")!;
};

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Triage Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
  // One contact, Kiran, writes for both clients.
  for (const name of names) {
    const [{ id }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, name]);
    ids.push(id);
    await owner.goto(`/app/clients/${id}?tab=contacts`);
    await owner.getByLabel("Contact's name").fill("Kiran Mehta");
    await owner.getByLabel("Contact's email").fill(contactEmail);
    await owner.getByRole("button", { name: "Add contact" }).click();
    await expect(owner.getByRole("dialog", { name: "Contacts" }).getByRole("listitem").filter({ hasText: "Kiran Mehta" })).toBeVisible();
  }
});
test.afterAll(() => firm.remove());

test("mail from a contact of two clients waits for the team to say which, then its attachment is filed there", async () => {
  await smtp.sendMail({ from: contactEmail, to: office, subject: `Bills ${tag}`, text: "Please find the September bills attached.", attachments: [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }] });
  await readMail();
  const mail = await open(`Bills ${tag}`);
  expect(await query(local.dbUrl, "select client_id, contact_id is not null as contact from public.email_events where id = $1", [mail])).toEqual([{ client_id: null, contact: true }]);
  expect(await query(local.dbUrl, "select reason_code from public.requests where entity_id = $1", [mail])).toEqual([{ reason_code: "client_unclear" }]);

  await pane().getByLabel("Which client the email from Kiran Mehta is for").selectOption({ label: names[1] });
  await pane().getByRole("button", { name: "It is for this client" }).click();
  await expect(pane().getByRole("link", { name: `Open ${names[1]}` })).toBeVisible();
  expect(await query(local.dbUrl, "select client_id from public.email_events where id = $1", [mail])).toEqual([{ client_id: ids[1] }]);
  // Filing its attachment is all it needed, so it no longer waits for anyone.
  expect(await query(local.dbUrl, "select status from public.requests where entity_id = $1", [mail])).toEqual([]);
  await runJobs(owner.request, firm.firmId);
  const filed = path.join(TEST_DRIVE, "InboxCA", "FY 2026-27", names[1], "GST", `${names[1]} - Purchase bills - Sep 2026.pdf`);
  expect(await readFile(filed, "utf8")).toBe("%PDF-1.4 invented purchase bills");
  expect(await query(local.dbUrl, "select client_id from public.documents where firm_id = $1", [firm.firmId])).toEqual([{ client_id: ids[1] }]);
});

test("once a person picks the client, a request for a paper goes through InboxCA's rules as a known client's does", async () => {
  await smtp.sendMail({ from: contactEmail, to: office, subject: `Last year's ITR ${tag}`, text: "Please send last year's ITR" });
  await readMail();
  const mail = await open(`Last year's ITR ${tag}`);
  expect(await query(local.dbUrl, "select label, client_id from public.email_events where id = $1", [mail])).toEqual([{ label: "records_past", client_id: null }]);
  await pane().getByLabel("Which client the email from Kiran Mehta is for").selectOption({ label: names[0] });
  await pane().getByRole("button", { name: "It is for this client" }).click();
  await expect(pane().getByRole("link", { name: `Open ${names[0]}` })).toBeVisible();
  await runJobs(owner.request, firm.firmId);
  // Kiran may not receive this client's papers, so the rules hand it back to the team, saying why.
  await expect.poll(async () => await query(local.dbUrl, "select client_id, reason_code, status from public.requests where entity_id = $1", [mail])).toEqual([{ client_id: ids[0], reason_code: "not_allowed", status: "pending" }]);
});

test("a snoozed email is brought back to Needs reply at once", async () => {
  await smtp.sendMail({ from: contactEmail, to: office, subject: `Question ${tag}`, text: "Sir, when is our next meeting?" });
  await readMail();
  const mail = await open(`Question ${tag}`);
  const [{ id: request }] = await query(local.dbUrl, "select id from public.requests where entity_id = $1", [mail]);
  await pane().getByLabel("Snooze", { exact: true }).click();
  await pane().getByRole("group", { name: "Snooze until" }).getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(owner.getByRole("status").filter({ hasText: /^Snoozed until/ })).toBeVisible();
  await owner.goto(`/app/inbox?status=snoozed&mail=${mail}`);
  await pane().getByRole("button", { name: "Back to Needs reply now" }).click();
  // While it saves, the button reads "Bringing back"; the saved state is the snooze gone.
  await expect.poll(async () => (await query(local.dbUrl, "select details from public.requests where id = $1", [request]))[0].details).toEqual({});
  await owner.goto("/app/inbox?show=reply");
  await expect(list().getByRole("listitem").filter({ hasText: `Question ${tag}` })).toContainText("Needs reply");
});
