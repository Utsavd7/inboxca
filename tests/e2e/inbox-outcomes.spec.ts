import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { addPerson, appKey, connectTestMailbox, localSupabase, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp as smtp } from "./local-supabase";

// Every email InboxCA read, with what it did: answered with a paper, waiting for approval,
// papers filed, a notice recorded, waiting for a person and why, answered by the team, or no
// reply needed; each a filter of its own, with the client filter too, and the week on Today.
// Another firm's email and a client hidden from a person never show. The mail arrives in the
// firm's mailbox on the local GreenMail server. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `outcomes-owner-${tag}@example.test`;
const staffEmail = `outcomes-staff-${tag}@example.test`;
const ownerKey = appKey();
const staffKey = appKey();
const office = `outcomes-office-${tag}@firm.test`;
const shah = { name: `Shah Traders ${tag}`, email: `shah-${tag}@shah.test`, id: "" };
const hidden = { name: `Hidden Exports ${tag}`, email: `hidden-${tag}@hidden.test`, id: "" };
const otherClient = `Other Firm Client ${tag}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let other: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
const list = (page: Page) => page.getByRole("list", { name: "Emails" });
const pane = (page: Page) => page.getByRole("article", { name: "Open email" });
const row = (page: Page, subject: string) => list(page).getByRole("listitem").filter({ hasText: subject });

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Outcomes Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
  for (const client of [shah, hidden]) {
    await owner.goto("/app/clients?panel=add");
    await owner.getByLabel("Name", { exact: true }).fill(client.name);
    await owner.getByLabel("Email", { exact: true }).fill(client.email);
    await owner.getByRole("button", { name: "Add client" }).click();
    await expect(owner.locator(".page-head")).toContainText(client.name);
    client.id = new URL(owner.url()).pathname.split("/").at(-1)!;
  }
  // Two filed papers of Shah's: a routine ITR-V that goes at once, and a private balance sheet.
  for (const [type, name] of [["ITR-V", "Shah ITR-V FY 2025-26.pdf"], ["Balance sheet", "Shah Balance sheet FY 2025-26.pdf"]])
    await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, drive_file_id, name, size, sha256) values ($1, $2, 'income_tax', $3, '2026', $4, $5, 1, $6)", [firm.firmId, shah.id, type, `nowhere-${randomUUID()}`, name, randomUUID()]);
  // A staff member who, with clients restricted, sees only Shah.
  const staffId = await addPerson(firm.firmId, staffEmail, "staff", staffKey);
  await query(local.dbUrl, "update public.firms set settings = settings || '{\"client_visibility\":\"restricted\"}' where id = $1", [firm.firmId]);
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm.firmId, shah.id, staffId]);
  staff = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(staff, staffEmail, staffKey);
  // Another firm's email from its own client, kept by InboxCA just the same.
  other = await seedFirm(`Other Outcomes Firm ${tag}`, `outcomes-other-${tag}@example.test`);
  const [{ id: otherAccount }] = await query(local.dbUrl, "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc, status) values ($1, 'mail', 'imap', 'x', 'x', 'needs_reconnect') returning id", [other.firmId]);
  const [{ id: otherId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [other.firmId, otherClient]);
  await query(local.dbUrl, "insert into public.email_events (firm_id, account_id, provider_message_id, sender_bidx, client_id, received_at, label, decision_source, reason_code) values ($1, $2, $3, 'invented', $4, now(), 'data_gst', 'rule', 'data_words_with_files')", [other.firmId, otherAccount, `<other-${tag}@else.test>`, otherId]);
});
test.afterAll(async () => {
  await firm.remove(staffEmail);
  await other.remove();
});

test("each email shows what InboxCA did, and each outcome is a filter of its own", async () => {
  const send = (from: string, subject: string, text: string, attachments?: { filename: string; content: string }[]) => smtp.sendMail({ from, to: office, subject, text, attachments });
  await send(shah.email, `ITR copy ${tag}`, "Please send my ITR for FY 2025-26.");
  await send(shah.email, `Statements ${tag}`, "Can you share the financial statements for FY 2025-26?");
  await send(shah.email, `Bills ${tag}`, "Please find the September bills attached.", [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }]);
  await send(shah.email, `Notice ${tag}`, "Notice under section 148 of the Income-tax Act. DIN: ITBA/AST/F/148/2026-27/1050012345(1). Please respond on or before 24/12/2026.");
  await send(shah.email, `Meeting ${tag}`, "Can we meet next week about the audit?");
  await send(shah.email, `Thanks ${tag}`, "Thank you for the update.");
  await send(shah.email, `Question ${tag}`, "When is our next meeting?");
  await send(hidden.email, `Hidden ${tag}`, "Hello from the hidden client.");
  await pollFirmMail(owner.request, firm.firmId);
  await runJobs(owner.request, firm.firmId);

  // The team answers one and says another needs no reply.
  await owner.goto("/app/inbox");
  await row(owner, `Question ${tag}`).getByText(`Question ${tag}`).click();
  await expect(pane(owner).getByRole("heading", { name: `Question ${tag}` })).toBeVisible();
  await owner.getByLabel("Your reply").fill("Next Tuesday at 11.");
  await owner.getByRole("button", { name: "Send reply" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible();
  await owner.goto("/app/inbox");
  await row(owner, `Thanks ${tag}`).hover();
  await row(owner, `Thanks ${tag}`).getByRole("button", { name: "No reply needed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Moved out of Needs reply." })).toBeVisible();

  const outcomes: [string, string, string[]][] = [
    ["answered", "Answered by InboxCA", [`ITR copy ${tag}`]],
    ["approval", "Waiting for approval", [`Statements ${tag}`]],
    ["filed", "Papers saved", [`Bills ${tag}`]],
    ["notice", "Notice recorded", [`Notice ${tag}`]],
    ["reply", "Needs reply", [`Meeting ${tag}`, `Hidden ${tag}`]],
    ["none", "No reply needed", [`Thanks ${tag}`]],
    ["replied", "Answered by your team", [`Question ${tag}`]],
  ];
  await owner.goto("/app/inbox");
  await expect(list(owner).getByRole("listitem")).toHaveCount(8);
  for (const [, words, subjects] of outcomes) for (const subject of subjects) await expect(row(owner, subject)).toContainText(words);
  await expect(list(owner)).not.toContainText(otherClient);
  for (const [status, words, subjects] of outcomes) {
    await owner.goto(`/app/inbox?status=${status}`);
    await expect(owner.locator("summary", { hasText: words })).toBeVisible();
    await expect(list(owner).getByRole("listitem")).toHaveCount(subjects.length);
    for (const subject of subjects) await expect(row(owner, subject)).toContainText(words);
    await expect(list(owner)).not.toContainText(otherClient);
  }
  // With the client filter, only that client's.
  await owner.goto(`/app/inbox?client=${shah.id}&status=reply`);
  await expect(list(owner).getByRole("listitem")).toHaveCount(1);
  await expect(row(owner, `Meeting ${tag}`)).toBeVisible();

  // The open email says the same, with a link to what was sent or recorded.
  await owner.goto("/app/inbox?status=answered");
  await row(owner, `ITR copy ${tag}`).getByText(`ITR copy ${tag}`).click();
  await expect(pane(owner)).toContainText("InboxCA sent Shah ITR-V FY 2025-26.pdf as a secure link.");
  await expect(pane(owner).getByRole("link", { name: "View the paper" })).toHaveAttribute("href", /^\/app\/files\/[0-9a-f-]{36}\/view$/);
  await owner.goto("/app/inbox?status=approval");
  await row(owner, `Statements ${tag}`).getByText(`Statements ${tag}`).click();
  await expect(pane(owner)).toContainText("InboxCA found Shah Balance sheet FY 2025-26.pdf. It goes to the client once someone approves it.");
  await owner.goto("/app/inbox?status=notice");
  await row(owner, `Notice ${tag}`).getByText(`Notice ${tag}`).click();
  const [{ id: notice }] = await query(local.dbUrl, "select id from public.tasks where firm_id = $1 and kind = 'notice'", [firm.firmId]);
  await expect(pane(owner).getByRole("link", { name: "Open the notice" })).toHaveAttribute("href", `/app/notices?notice=${notice}`);
  await owner.goto("/app/inbox?status=filed");
  await row(owner, `Bills ${tag}`).getByText(`Bills ${tag}`).click();
  await expect(pane(owner)).toContainText(`InboxCA filed its paper into ${shah.name}'s folders.`);
  await owner.goto("/app/inbox?status=reply");
  await row(owner, `Meeting ${tag}`).getByText(`Meeting ${tag}`).click();
  await expect(pane(owner)).toContainText("Asks something InboxCA could not answer");
});

test("Today counts the week's email, each figure opening its list in the Inbox", async () => {
  await owner.goto("/app");
  const week = owner.locator("section[aria-labelledby=t-mail]");
  for (const [label, count] of [["Emails read", 8], ["Answered by InboxCA", 1], ["Answered by your team", 1], ["Waiting for a reply", 2]] as const)
    await expect(week.getByRole("link", { name: label })).toContainText(String(count));
  await week.getByRole("link", { name: "Answered by InboxCA" }).click();
  await expect(owner).toHaveURL(/\/app\/inbox\?when=week&status=answered$/);
  await expect(list(owner).getByRole("listitem")).toHaveCount(1);
  await expect(row(owner, `ITR copy ${tag}`)).toContainText("Answered by InboxCA");
  await owner.goto("/app");
  await week.getByRole("link", { name: "Emails read" }).click();
  await expect(owner).toHaveURL(/\/app\/inbox\?when=week&show=in$/);
  await expect(list(owner).getByRole("listitem")).toHaveCount(8);
});

test("a person sees only the email of clients they may see, everywhere", async () => {
  await staff.goto("/app");
  const week = staff.locator("section[aria-labelledby=t-mail]");
  await expect(week.getByRole("link", { name: "Emails read" })).toContainText("7");
  await expect(week.getByRole("link", { name: "Waiting for a reply" })).toContainText("1");
  for (const path of ["/app/inbox", "/app/inbox?status=reply", "/app/inbox?status=none", "/app/inbox?when=week"]) {
    await staff.goto(path);
    await expect(list(staff).getByRole("listitem").first()).toBeVisible();
    await expect(list(staff)).not.toContainText(hidden.name);
    await expect(list(staff)).not.toContainText(`Hidden ${tag}`);
    await expect(list(staff)).not.toContainText(otherClient);
  }
  await staff.goto("/app/inbox?status=reply");
  await expect(list(staff).getByRole("listitem")).toHaveCount(1);
  await expect(row(staff, `Meeting ${tag}`)).toContainText("Needs reply");
});
