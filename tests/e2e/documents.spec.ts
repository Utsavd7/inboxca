import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
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
