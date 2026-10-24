import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test, expect } from "@playwright/test";
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
    await mkdir(`${tmpdir()}/inboxca-test-drive/InboxCA`, { recursive: true });
    await writeFile(`${tmpdir()}/inboxca-test-drive/${file}`, Buffer.from(pdf("Invented purchase bills")));
    const insert = "insert into public.documents (firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, $3, $4, $5, $6, 1, $7) returning id";
    const [bills] = await query(local.dbUrl, insert, [firm.firmId, patel.id, "gst", "Purchase bills", file, `Patel Textiles ${tag} - Purchase bills.pdf`, randomUUID()]);
    await query(local.dbUrl, insert, [firm.firmId, mehta.id, "income_tax", "Form 16", "nowhere", `Mehta Traders ${tag} - Form 16.pdf`, randomUUID()]);
    await query(local.dbUrl, "insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'document.uploaded', 'document', $3)", [firm.firmId, firm.ownerId, bills.id]);

    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
    const papers = page.getByRole("region", { name: "Papers" });
    await expect(papers.getByRole("row")).toHaveCount(3);
    await expect(papers.getByRole("row", { name: /Form 16/ })).toContainText("Brought in from the drive");

    // Filter by kind: only GST papers.
    await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /GST/ }).click();
    await expect(page).toHaveURL(/kind=gst/);
    await expect(papers.getByRole("row")).toHaveCount(2);
    await expect(papers.getByRole("row", { name: /Purchase bills/ })).toContainText("Uploaded by Owner");

    // Open a paper: its drive path, where it came from and the first page.
    await papers.getByRole("link", { name: /Purchase bills/ }).click();
    await expect(page).toHaveURL(new RegExp(`file=${bills.id}`));
    const detail = page.getByRole("complementary", { name: "Paper" });
    await expect(detail).toContainText(`InboxCA / FY`);
    await expect(detail).toContainText(`Patel Textiles ${tag} / GST / Patel Textiles ${tag} - Purchase bills.pdf`);
    await expect(detail.getByRole("img", { name: "Page 1" })).toBeVisible();
    await expect(detail.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/app/files/${bills.id}`);

    // Upload papers finds the client and opens their upload form.
    await page.getByRole("link", { name: "Upload papers" }).click();
    const sheet = page.getByRole("complementary", { name: "Upload papers" });
    await sheet.getByLabel("Client name").fill("Mehta");
    await sheet.getByLabel("Client name").press("Enter");
    await expect(sheet.getByRole("link", { name: "Choose" })).toHaveAttribute("href", `/app/clients/${mehta.id}?tab=files&upload=1`);
    await sheet.getByRole("link", { name: "Close" }).click();

    await detail.getByRole("link", { name: "Open client" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${patel.id}$`));
    await expect(page.getByRole("heading", { name: `Patel Textiles ${tag}`, level: 1 })).toBeVisible();
  } finally {
    await firm.remove();
  }
});
