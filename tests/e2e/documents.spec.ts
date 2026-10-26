import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { test, expect } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { serverCrypto } from "@/src/lib/crypto";
import { pdf } from "../fixtures/pdf";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// The firm's Documents page: every paper by year and work, one paper at a time on the right.
test("Documents lists the firm's papers by work, shows one, and opens its client", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `owner-${randomUUID()}@example.test`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("Documents Test Firm", email, key);
  try {
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings");
    const drive = page.locator("section#drive");
    await drive.getByLabel("Test drive on this computer").check();
    await drive.getByLabel(/I have read this and I agree/).check();
    await drive.getByRole("button", { name: "Connect drive" }).click();
    await expect(drive.getByRole("status")).toContainText("Connected:");

    const tag = randomUUID().slice(0, 8);
    const [patel] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `Patel Textiles ${tag}`]);
    const [mehta] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [firm.firmId, `Mehta Traders ${tag}`]);
    // A PDF in the test drive, uploaded by the owner; a paper from the first import with no file.
    const file = `InboxCA/documents-${tag}.pdf`;
    await mkdir(`${TEST_DRIVE}/InboxCA`, { recursive: true });
    await writeFile(`${TEST_DRIVE}/${file}`, Buffer.from(pdf("Invented purchase bills")));
    const insert = "insert into public.documents (firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, $3, $4, $5, $6, 1, $7) returning id";
    await query(local.dbUrl, insert, [firm.firmId, mehta.id, "income_tax", "Form 16", "nowhere", `Mehta Traders ${tag} - Form 16.pdf`, randomUUID()]);
    const [bills] = await query(local.dbUrl, insert, [firm.firmId, patel.id, "gst", "Purchase bills", file, `Patel Textiles ${tag} - Purchase bills.pdf`, randomUUID()]);
    await query(local.dbUrl, "insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'document.uploaded', 'document', $3)", [firm.firmId, firm.ownerId, bills.id]);

    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
    const papers = page.getByRole("region", { name: "Papers" });
    await expect(papers.getByRole("row")).toHaveCount(3);
    await expect(papers.getByRole("row", { name: /Form 16/ })).toContainText("From the drive");
    // The paper's whole name shows, with its work on a second line.
    await expect(papers.getByRole("link", { name: "Purchase bills.pdf", exact: true })).toBeVisible();
    // The first paper shows its first page at once, logged as a thumbnail, not as an opened view.
    const detail = page.getByRole("complementary", { name: "Paper" });
    await expect(detail.getByRole("img", { name: "Page 1" })).toBeVisible();
    const count = async (thumb: boolean) => (await query(local.dbUrl, "select count(*)::int as n from public.activity_log where entity_id = $1 and action = 'document.viewed' and (coalesce(details->>'thumb', 'false') = 'true') = $2", [bills.id, thumb]))[0].n;
    const views = () => count(false);
    await expect.poll(() => count(true)).toBe(1);
    expect(await views()).toBe(0);

    // Filter by kind: only GST papers.
    await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /GST/ }).click();
    await expect(page).toHaveURL(/kind=gst/);
    await expect(papers.getByRole("row")).toHaveCount(2);
    await expect(papers.getByRole("row", { name: /Purchase bills/ })).toContainText("Uploaded by Owner");

    // Open a paper: its drive path, where it came from and the first page.
    await papers.getByRole("link", { name: /Purchase bills/ }).click();
    await expect(page).toHaveURL(new RegExp(`file=${bills.id}`));
    await expect(detail).toContainText(`InboxCA / FY`);
    await expect(detail).toContainText(`Patel Textiles ${tag} / GST / Patel Textiles ${tag} - Purchase bills.pdf`);
    await expect(detail.getByRole("img", { name: "Page 1" })).toBeVisible();
    await expect.poll(views).toBe(1);
    await expect(detail.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/app/files/${bills.id}`);

    // Upload papers finds the client and opens their upload form, here beside the list.
    await page.getByRole("link", { name: "Upload papers" }).click();
    const sheet = page.getByRole("dialog", { name: "Upload papers" });
    await sheet.getByLabel("Client name").fill("Mehta");
    await sheet.getByLabel("Client name").press("Enter");
    await sheet.getByRole("link", { name: `Choose Mehta Traders ${tag}` }).click();
    const form = page.getByRole("dialog", { name: `Upload papers for Mehta Traders ${tag}` });
    await expect(form.getByLabel("Files", { exact: true })).toBeAttached();
    await form.getByRole("link", { name: "Close" }).click();
    await expect(form).toHaveCount(0);

    await detail.getByRole("link", { name: "Open client" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${patel.id}$`));
    await expect(page.getByRole("heading", { name: `Patel Textiles ${tag}`, level: 1 })).toBeVisible();

    // Upload papers on the client: one drop zone for several files, each typed from its name.
    await page.goto(`/app/clients/${patel.id}?tab=documents`);
    await page.getByRole("link", { name: "Upload papers" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("link", { name: "Add portal files" })).toHaveAttribute("href", "/app?panel=portal");
    await panel.getByLabel("Files", { exact: true }).setInputFiles([
      { name: "sales_bills_sep_2026.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented sales bills")) },
      { name: "Form16 FY 2025-26.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented form 16")) },
      { name: "IMG_0042.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented loan letter")) },
    ]);
    const sales = panel.getByRole("group", { name: "sales_bills_sep_2026.pdf" });
    await expect(sales.getByLabel("Type")).toHaveValue("Sales bills");
    await expect(sales.getByLabel("Work")).toHaveValue("gst");
    await expect(sales.getByLabel("Period")).toHaveValue("2026-09");
    const form16 = panel.getByRole("group", { name: "Form16 FY 2025-26.pdf" });
    await expect(form16.getByLabel("Type")).toHaveValue("Form 16");
    await expect(form16.getByLabel("Period")).toHaveValue("2026");
    // A name that says nothing is left for the person to choose, never Other.
    const scan = panel.getByRole("group", { name: "IMG_0042.pdf" });
    for (const field of ["Type", "Work", "Period"]) await expect(scan.getByLabel(field)).toHaveValue("");
    await scan.getByLabel("Type").selectOption("Other");
    await scan.getByLabel("Name", { exact: true }).fill("Loan sanction letter");
    await scan.getByLabel("Add to our list of paper types").check();
    await scan.getByLabel("Work").selectOption("other");
    await scan.getByLabel("Period").selectOption({ label: "No period" });
    await panel.getByRole("button", { name: "Upload 3 files" }).click();
    await expect(page.getByRole("status")).toContainText("3 filed in their clients' folders");
    const rows = page.locator("section[aria-labelledby=files] tbody tr");
    await expect(rows.filter({ hasText: "Sales bills - Sep 2026.pdf" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Form 16 - FY 2025-26.pdf" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Loan sanction letter.pdf" })).toHaveCount(1);
    expect((await query(local.dbUrl, "select settings->'document_types' as types from public.firms where id = $1", [firm.firmId]))[0].types).toEqual(["Loan sanction letter"]);
  } finally {
    await firm.remove();
  }
});

// Each paper says how it got into the drive and when, from what InboxCA recorded: the email (which
// opens in the Inbox), who uploaded, added or filed it, the client's upload link, or the old
// files sorted in the first import. Papers waiting under To check are counted, say why, and open where they are checked.
test("each paper says how it came in and when, papers to check say why, and another firm's log never shows", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `owner-${randomUUID()}@example.test`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("Documents Origin Firm", email, key);
  const other = await seedFirm("Documents Other Firm", `other-${randomUUID()}@example.test`);
  try {
    const tag = randomUUID().slice(0, 8);
    const name = `Kapoor Enterprises ${tag}`;
    const [client] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, name]);
    const paper = async (type: string, period: string, status = "filed", mail: string | null = null) =>
      (await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, status, email_event_id, drive_file_id, name, size, sha256) values ($1, $2, 'gst', $3, $4, $5, $6, 'nowhere', $7, 1, $8) returning id", [firm.firmId, client.id, type, period, status, mail, `${name} - ${type}.pdf`, randomUUID()]))[0].id as string;
    const log = (firmId: string, actor: string | null, action: string, entity: string, details = {}) =>
      query(local.dbUrl, "insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details) values ($1, $2, $3, 'document', $4, $5)", [firmId, actor, action, entity, details]);
    loadEnvConfig(process.cwd());
    const crypto = serverCrypto();
    const account = randomUUID();
    await query(local.dbUrl, "insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc, status) values ($1, $2, 'mail', 'imap', $3, $4, 'needs_reconnect')", [account, firm.firmId, await crypto.encrypt(firm.firmId, `accounts/${account}/address`, "office@invented.test"), await crypto.encrypt(firm.firmId, `accounts/${account}/credentials`, "{}")]);
    const [{ id: mail }] = await query(local.dbUrl, "insert into public.email_events (firm_id, account_id, client_id, provider_message_id, sender_bidx, received_at) values ($1, $2, $3, $4, 'invented', now()) returning id", [firm.firmId, account, client.id, `<${tag}@client.test>`]);
    await paper("Sales bills", "2026-09", "filed", mail);
    await log(firm.firmId, firm.ownerId, "document.uploaded", await paper("Purchase bills", "2026-09"));
    await log(firm.firmId, firm.ownerId, "document.uploaded", await paper("GSTR-2B", "2026-09"), { from: "portal" });
    await log(firm.firmId, null, "document.uploaded", await paper("Bank statement", "2026-09"));
    await log(firm.firmId, firm.ownerId, "document.filed", await paper("Ledger", "2026-09"), { from: "drive" });
    const waiting = await paper("Document", "", "to_check");
    await log(firm.firmId, firm.ownerId, "document.uploaded", waiting);
    const moved = await paper("Trial balance", "2026");
    await query(local.dbUrl, "insert into public.requests (firm_id, kind, entity_type, entity_id, status, details) values ($1, 'import', 'import', gen_random_uuid(), 'done', $2)", [firm.firmId, { files: [], done: 1, moved: [{ document: moved, from: `Old files/${name}/TB 2025-26.pdf` }] }]);
    // Another firm's line about the same paper is never read as this firm's.
    await log(other.firmId, other.ownerId, "document.uploaded", moved, { from: "portal" });

    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/documents?year=all");
    const papers = page.getByRole("region", { name: "Papers" });
    const row = (type: string) => papers.getByRole("row", { name: new RegExp(type) });
    await expect(row("Sales bills")).toContainText(`Email from ${name}`);
    await expect(row("Purchase bills")).toContainText("Uploaded by Owner");
    await expect(row("GSTR-2B")).toContainText("Portal file, added by Owner");
    await expect(row("Bank statement")).toContainText("Client's upload link");
    await expect(row("Ledger")).toContainText("Filed from the drive by Owner");
    await expect(row("Trial balance")).toContainText("From your old files");
    await expect(row("Document")).toContainText("To checkInboxCA could not tell its type and period");

    // The paper's panel says it whole, and when; an email opens in the Inbox.
    const detail = page.getByRole("complementary", { name: "Paper" });
    await row("Trial balance").getByRole("link").click();
    await expect(detail).toContainText("Moved here from your old files, ");
    await expect(detail).toContainText(`It used to be at Old files/${name}/TB 2025-26.pdf`);
    await expect(detail).not.toContainText("Other");
    await row("Bank statement").getByRole("link").click();
    await expect(detail).toContainText("Sent by the client through their upload link, ");
    await row("Sales bills").getByRole("link").click();
    await expect(detail).toContainText(new RegExp(`Filed by InboxCA from ${name}'s email, \\d{1,2} \\w{3}, \\d\\d:\\d\\d`));
    await detail.getByRole("link", { name: "Open the email" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/inbox\\?mail=${mail}$`));

    // To check: counted beside the folders, each with why it waits, checked on the client's page.
    await page.goto("/app/documents");
    const check = page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /To check/ });
    await expect(check).toContainText("1");
    await check.click();
    await expect(page).toHaveURL(/show=check/);
    await expect(papers.getByRole("row")).toHaveCount(2);
    await expect(detail).toContainText("Uploaded by Owner, ");
    await expect(detail).toContainText("Waiting to be checked: InboxCA could not tell its type and period.");
    await detail.getByRole("link", { name: "Check and file" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client.id}\\?tab=documents&edit=${waiting}$`));
    await expect(page.getByRole("dialog")).toContainText("Waiting to be checked: InboxCA could not tell its type and period.");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Save", exact: true })).toBeVisible();

    // The client's Documents tab says the same, whole.
    await page.goto(`/app/clients/${client.id}?tab=documents`);
    const rows = page.locator("section[aria-labelledby=files] tbody tr");
    await expect(rows.filter({ hasText: "GSTR-2B" })).toContainText("Added as a portal file by Owner, ");
    await expect(rows.filter({ hasText: "Ledger" })).toContainText("Found in the drive and filed by Owner, ");
    await expect(rows.filter({ hasText: "Trial balance" })).toContainText("Moved here from your old files, ");
    await expect(rows.filter({ hasText: "Sales bills" }).getByRole("link", { name: "Open the email" })).toHaveAttribute("href", `/app/inbox?mail=${mail}`);
  } finally {
    await firm.remove();
    await other.remove();
  }
});

// With no drive linked no paper can be read, so no page asks for one: no thumbnail, no preview.
test("with no drive linked, no page asks for a paper's preview or offers its download", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `owner-${randomUUID()}@example.test`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("Documents No Drive Firm", email, key);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/stream")) asked.push(request.url());
  });
  try {
    const [client] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, 'Invented Patel Textiles', 'business') returning id", [firm.firmId]);
    await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, 'gst', 'Purchase bills', 'nowhere', 'Invented bills.pdf', 1, $3)", [firm.firmId, client.id, randomUUID()]);
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.waitForLoadState("networkidle");
    await page.goto("/app/documents");
    await expect(page.getByRole("complementary", { name: "Paper" })).toContainText("The firm's drive is not linked yet, so papers cannot be shown.");
    // Nor is Download offered, which would leave the app for a bare error.
    await expect(page.getByRole("complementary", { name: "Paper" }).getByRole("link", { name: "Download" })).toHaveCount(0);
    await page.goto(`/app/clients/${client.id}?tab=documents`);
    await expect(page.getByRole("link", { name: "Invented bills.pdf", exact: true })).toBeVisible();
    await page.goto("/app/documents?view=folders");
    await expect(page.getByText("The firm's drive is not linked yet")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(asked).toEqual([]);
  } finally {
    await firm.remove();
  }
});
