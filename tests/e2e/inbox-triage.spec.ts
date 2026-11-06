import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { serverCrypto } from "@/src/lib/crypto";
import { appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp as smtp } from "./local-supabase";

// Inbox steps the other specs leave out: mail from a contact who writes for two clients waits
// until someone says which client, and its attachment is then filed in that client's folder;
// a snoozed email is brought back to Needs reply at once; a tax portal's mail is matched by
// PAN, filed, and closes the e-verification, while a forged one is skipped; a portal's filing
// acknowledgement offers the matching approved return to mark filed with its number. The mail arrives in the firm's
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

test("a tax portal's mail that passed SPF or DKIM is matched by its PAN, filed, and closes the e-verification; a forged one is skipped", async () => {
  // A client with a PAN and this year's income tax return, marked filed with one e-verify reminder.
  const pan = `${[...tag.slice(0, 5)].map((c) => "ABCDEFGHIJKLMNOP"[parseInt(c, 16)]).join("")}${String(parseInt(tag.slice(5, 8), 16) % 10000).padStart(4, "0")}Z`;
  const clientEmail = `desai-${tag}@desai.test`;
  await makeMailbox(clientEmail);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(`Desai ${tag}`);
  await owner.getByLabel("Email", { exact: true }).fill(clientEmail);
  await owner.getByLabel("PAN", { exact: true }).fill(pan);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(`Desai ${tag}`);
  const client = owner.url().split("/").at(-1)!.split("?")[0];
  const [{ id: task }] = await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'ITR_NA', '2026', (now() at time zone 'Asia/Kolkata')::date - 2) returning id", [firm.firmId, client]);
  await owner.goto(`/app/clients/${client}?tab=returns&task=${task}`);
  const panel = owner.getByRole("dialog", { name: "Mark filed" });
  await panel.getByLabel("Email the client to e-verify the return within 30 days").check();
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "marked filed" })).toBeVisible();
  const filedRow = () => owner.locator("li.app-row").filter({ hasText: "ITR (no business, no audit) AY 2026-27 (FY 2025-26)" });
  await owner.goto(`/app/clients/${client}?tab=returns&show=filed`);
  await expect(filedRow()).toContainText("Verify by");
  await expect.poll(async () => (await mailTexts(clientEmail)).some((text) => text.includes("e-verify"))).toBe(true);

  // The portal's confirmation, with the mailbox's own SPF and DKIM results; then the same
  // address forged, with none.
  const events = async () => (await query(local.dbUrl, "select count(*)::int as n from public.email_events where firm_id = $1", [firm.firmId]))[0].n as number;
  const before = await events();
  const auth = "mx.google.com; dkim=pass header.i=@incometax.gov.in header.s=sel; spf=pass (domain of donotreply@incometax.gov.in designates 1.2.3.4 as permitted sender) smtp.mailfrom=donotreply@incometax.gov.in";
  await smtp.sendMail({ from: "donotreply@incometax.gov.in", to: office, subject: `ITR for AY 2026-27 successfully e-Verified ${tag}`, text: `Dear Taxpayer, your return for PAN ${pan} has been e-verified. ITR-V attached.`, headers: { "Authentication-Results": auth }, attachments: [{ filename: "ITR-V.pdf", content: "%PDF-1.4 invented ITR-V" }] });
  await smtp.sendMail({ from: "donotreply@incometax.gov.in", to: office, subject: `Refund for PAN ${pan} ${tag}`, text: "Click here to claim your refund." });
  await readMail();
  expect(await query(local.dbUrl, "select label, reason_code from public.email_events where client_id = $1", [client])).toEqual([{ label: "data_income_tax", reason_code: "government_verified" }]);
  // The forged one was neither opened nor kept.
  expect(await events()).toBe(before + 1);
  expect((await query(local.dbUrl, "select details->>'verified_on' as verified_on from public.tasks where id = $1", [task]))[0].verified_on).toBeTruthy();
  await runJobs(owner.request, firm.firmId);
  expect(await query(local.dbUrl, "select document_type, status from public.documents where client_id = $1", [client])).toEqual([{ document_type: "ITR-V", status: "filed" }]);
  await owner.goto(`/app/clients/${client}?tab=returns&show=filed`);
  await expect(filedRow()).toContainText("E-verified");
});

test("a portal's acknowledgement email offers the client's approved statement with its token number, filed only on a person's click", async () => {
  // An approved Form No. 140 for the client's TAN, July to September 2026. Invented TAN.
  const tan = `${[...tag.slice(0, 4)].map((c) => "ABCDEFGHIJKLMNOP"[parseInt(c, 16)]).join("")}${String(parseInt(tag.slice(4, 8), 16) % 100000).padStart(5, "0")}Z`;
  loadEnvConfig(process.cwd());
  const [client, registration, draft] = [ids[0], randomUUID(), randomUUID()], crypto = serverCrypto();
  await query(local.dbUrl, "insert into public.client_registrations (id, firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, $3, 'tan', $4, $5)", [registration, firm.firmId, client, await crypto.encrypt(firm.firmId, `clients/${client}/tan`, tan), await crypto.blindIndex(firm.firmId, "tan", tan)]);
  await query(local.dbUrl, "insert into public.datasets (id, firm_id, client_id, form_code, period_key, data) values ($1, $2, $3, 'TDS140', '2026-09', $4)", [draft, firm.firmId, client, { registration, lines: [{ id: randomUUID(), field: "tds.total", value_enc: "invented encrypted figure", state: "confirmed", source: { entered_by: firm.ownerId, entered_at: new Date().toISOString() }, by: firm.ownerId, at: new Date().toISOString() }], checks: [] }]);
  const [{ id: form }] = await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, name, size, sha256, drive_file_id, prepared) values ($1, $2, 'tds', 'Prepared return', '2026-09', $3, 1, repeat('a', 64), 'invented-statement', $4) returning id", [firm.firmId, client, `${names[0]} - Form No. 140 - Jul to Sep 2026 - v1.txt`, { form: "TDS140", registration, version: 1, template: "9.1", sources: [{ id: draft, revision: 1 }], status: "approved" }]);
  const token = Array.from({ length: 15 }, () => randomInt(10)).join("");
  const auth = "mx.google.com; dkim=pass header.i=@incometax.gov.in header.s=sel; spf=pass smtp.mailfrom=donotreply@incometax.gov.in";
  await smtp.sendMail({ from: "donotreply@incometax.gov.in", to: office, subject: `Acknowledgement of TDS statement ${tag}`, text: `TAN ${tan}\nQuarter: Q2 2026-27\nToken number: ${token}\nUploaded on 12/11/2026`, headers: { "Authentication-Results": auth } });
  await readMail();
  // Offered with its number, never filed by the mail itself.
  expect(await query(local.dbUrl, "select details->>'ack' as ack from public.requests where kind = 'form_confirmation' and entity_id = $1", [form])).toEqual([{ ack: token }]);
  expect((await query(local.dbUrl, "select prepared->>'status' as status from public.documents where id = $1", [form]))[0].status).toBe("approved");
  // Today's card opens the quarter's TDS return at its File step.
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on) values ($1, $2, $3, 'TDS_RET', '2026-09', '2026-10-31') on conflict (firm_id, registration_id, code, period_key) do nothing", [firm.firmId, client, registration]);
  await owner.goto("/app");
  await owner.getByRole("region", { name: "Your list" }).getByRole("listitem").filter({ hasText: "The acknowledgement arrived" }).getByRole("link", { name: /^Mark filed/ }).click();
  await expect(owner).toHaveURL(/\/returns\/[0-9a-f-]{36}\?step=file$/);
  await owner.goto(`/app/clients/${client}?tab=outputs`);
  const card = owner.locator("li.rf-card").filter({ hasText: "Form No. 140" });
  await expect(card).toContainText(`acknowledgement number ${token}`);
  await card.getByRole("button", { name: "Mark filed", exact: true }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select prepared->>'status' as status, prepared->>'ack' as ack from public.documents where id = $1", [form]))[0]).toEqual({ status: "filed", ack: token });
});
