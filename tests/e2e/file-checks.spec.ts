import { randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import nodemailer from "nodemailer";
import { TEST_DRIVE, TEST_WORKER_SECRET } from "../../playwright.config";
import { zip } from "@/src/lib/firm-download";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";
import { EICAR } from "../fixtures/fake-clamd";
import { lockedPdf, pdf } from "../fixtures/pdf";

// The file worker's checks through the real pages: the virus check (against the test stand
// in for ClamAV), ZIPs opened within their limits, programs refused, a PDF's password typed
// once, and Word letters in the viewer.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `checks-${tag}@example.test`;
const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let clientId: string;
const clientName = `Checked Traders ${tag}`;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("File Checks Firm", ownerEmail, key);
  owner = await (await browser.newContext()).newPage();
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(key));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
  await owner.goto("/app/settings");
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
  [{ id: clientId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, clientName]);
});
test.afterAll(() => firm.remove());

// Uploads one file on the client's Files tab as a named paper of the firm's own.
async function upload(file: { name: string; mimeType: string; buffer: Buffer }, type = "Other") {
  await owner.goto(`/app/clients/${clientId}?tab=files`);
  await owner.getByRole("link", { name: "Upload papers" }).click();
  await owner.getByLabel("Files", { exact: true }).setInputFiles(file);
  await owner.getByLabel("Paper type", { exact: true }).selectOption(type);
  if (type === "Other") await owner.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Invented paper");
  await owner.getByLabel("Type of work", { exact: true }).selectOption("gst");
  await owner.getByLabel("Period", { exact: true }).selectOption({ label: "No period" });
  await owner.getByRole("button", { name: "Upload", exact: true }).click();
}
const papers = () => query(local.dbUrl, "select name, scanned_at from public.documents where client_id = $1 order by name", [clientId]);

test("a file with a virus is kept out of InboxCA, put in the owner's folder for it, and shown on Today", async () => {
  await upload({ name: "statement.txt", mimeType: "text/plain", buffer: Buffer.from(`Invented statement\n${EICAR}\n`) });
  await expect(owner.getByRole("alert").filter({ hasText: "found a virus in this file" })).toBeVisible();
  expect(await papers()).toEqual([]);
  expect(await readdir(path.join(TEST_DRIVE, "InboxCA", "Files with a virus"))).toContain(`${clientName} - statement.txt`);
  const [alert] = await query(local.dbUrl, "select id, status, details from public.requests where firm_id = $1 and kind = 'alert' and reason_code = 'virus'", [firm.firmId]);
  expect(alert).toMatchObject({ status: "pending", details: { name: `${clientName} - statement.txt`, found: "Eicar-Test-Signature" } });
  expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id = $1 and action = 'document.virus' and entity_id = $2", [firm.firmId, alert.id]))[0].n).toBe(1);
  await owner.goto("/app");
  const card = owner.locator("section[aria-labelledby=t-now]");
  await expect(card).toContainText(`${clientName} - statement.txt had a virus.`);
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(owner.locator("section[aria-labelledby=t-now]")).not.toContainText("had a virus");
  expect((await query(local.dbUrl, "select status from public.requests where id = $1", [alert.id]))[0].status).toBe("done");
  expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where entity_id = $1 and action = 'request.changed' and actor_id = $2", [alert.id, firm.ownerId]))[0].n).toBe(1);
});

test("a ZIP's papers are each filed and checked; unsafe ZIPs and programs are refused", async () => {
  await upload({ name: "Sep bills.zip", mimeType: "application/zip", buffer: zip([{ name: "Sep/bill 1.pdf", text: pdf("Invented bill 1") }, { name: "bill 2.pdf", text: pdf("Invented bill 2") }, { name: "__MACOSX/._bill 2.pdf", text: "x" }]) }, "Purchase bills");
  await expect(owner.getByRole("status")).toContainText("2 filed");
  const filed = await papers();
  expect(filed).toHaveLength(2);
  expect(filed.every((paper: { name: string; scanned_at: Date | null }) => paper.name.includes("Purchase bills") && paper.name.endsWith(".pdf") && paper.scanned_at)).toBe(true);
  await upload({ name: "nested.zip", mimeType: "application/zip", buffer: zip([{ name: "inner.zip", text: zip([{ name: "a.pdf", text: pdf("Invented") }]) }]) });
  await expect(owner.getByRole("alert").filter({ hasText: "holds another archive" })).toBeVisible();
  await upload({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ invented") });
  await expect(owner.getByRole("alert").filter({ hasText: "does not take programs" })).toBeVisible();
  expect(await papers()).toHaveLength(2);
});

test("a PDF with a password opens once a person types it, and the team need not type it again", async () => {
  await upload({ name: "bank.pdf", mimeType: "application/pdf", buffer: Buffer.from(lockedPdf("Invented bank statement", "invented-pass")) });
  await expect(owner.getByRole("status")).toContainText("Saved as");
  const [document] = await query(local.dbUrl, "select id from public.documents where client_id = $1 and name like '%.pdf' and name not like '%Purchase bills%'", [clientId]);
  await owner.goto(`/app/files/${document.id}/view`);
  await expect(owner.getByText("Not checked for viruses yet.")).toHaveCount(0);
  await owner.getByLabel("This PDF has a password. Type it to open the file.").fill("wrong-pass");
  await owner.getByRole("button", { name: "Open", exact: true }).click();
  await owner.getByLabel("That password did not open it. Type it again.").fill("invented-pass");
  await owner.getByRole("button", { name: "Open", exact: true }).click();
  await expect(owner.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  const [saved] = await query(local.dbUrl, "select password_enc from public.documents where id = $1", [document.id]);
  expect(saved.password_enc).toBeTruthy();
  expect(saved.password_enc).not.toContain("invented-pass");
  expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where entity_id = $1 and action = 'document.password_saved'", [document.id]))[0].n).toBe(2);
  // A file InboxCA did not check itself, as from the first import, says so plainly.
  await query(local.dbUrl, "update public.documents set scanned_at = null where id = $1", [document.id]);
  await owner.reload();
  await expect(owner.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  await expect(owner.getByText("Not checked for viruses yet.")).toBeVisible();
});

test("a Word letter is shown as its words, view only", async () => {
  const letter = zip([{ name: "[Content_Types].xml", text: "<Types/>" }, { name: "word/document.xml", text: "<w:document><w:body><w:p><w:r><w:t>Invented engagement letter</w:t></w:r></w:p></w:body></w:document>" }]);
  await upload({ name: "letter.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: letter });
  await expect(owner.getByRole("status")).toContainText("Saved as");
  const [document] = await query(local.dbUrl, "select id from public.documents where client_id = $1 and name like '%.docx'", [clientId]);
  await owner.goto(`/app/files/${document.id}/view`);
  await expect(owner.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  await expect(owner.getByText("This kind of file cannot be shown here.")).toHaveCount(0);
});

test("an email's ZIP is filed paper by paper, its virus is kept out and a program is left out", async ({ request }) => {
  const mailbox = `checks-office-${tag}@firm.test`, from = `client-${tag}@checked.test`, mailClient = `Mail Checked ${tag}`;
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  // The test mail server makes a mailbox when its first email arrives.
  await smtp.sendMail({ from, to: mailbox, subject: "Invented test mailbox", text: "Test setup" });
  await owner.goto("/app/settings");
  const card = owner.locator("section#mailbox");
  await card.getByLabel("The firm's email address").fill(mailbox);
  await card.getByLabel("Its password").fill(mailbox);
  await card.getByText("Change server settings").click();
  await card.getByLabel("Incoming mail server (IMAP)").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing mail server (SMTP)").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${mailbox}`);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(mailClient);
  await owner.getByLabel("Email", { exact: true }).fill(from);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(mailClient);
  const [{ id: client }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, mailClient]);
  const bills = zip([{ name: "purchase_bills_sep_2026_a.pdf", text: pdf("Invented bill A") }, { name: "purchase_bills_sep_2026_b.pdf", text: pdf("Invented bill B") }]);
  await smtp.sendMail({
    from, to: mailbox, subject: "GST data", text: "Bills attached.",
    attachments: [{ filename: "bills.zip", content: bills }, { filename: "notes.txt", content: `Invented notes\n${EICAR}` }, { filename: "tool.exe", content: "MZ invented" }],
  });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  // A sweep reads the mail, a later one files its attachments, behind this firm's other jobs.
  const filed = () => query(local.dbUrl, "select name, scanned_at is not null as scanned from public.documents where client_id = $1 order by name", [client]);
  await expect.poll(async () => { await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } }); return (await filed()).length; }, { timeout: 30_000 }).toBe(2);
  expect((await filed()).every((paper: { name: string; scanned: boolean }) => paper.name.startsWith(`${mailClient} - Purchase bills - Sep 2026`) && paper.scanned)).toBe(true);
  expect(await readdir(path.join(TEST_DRIVE, "InboxCA", "Files with a virus"))).toContain(`${mailClient} - notes.txt`);
  expect(await query(local.dbUrl, "select status from public.requests where client_id = $1 and kind = 'alert' and reason_code = 'virus'", [client])).toEqual([{ status: "pending" }]);
  expect(await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'document.refused'", [firm.firmId])).toEqual([{ details: { reason: "program" } }]);
});
