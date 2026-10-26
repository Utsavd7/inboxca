import { randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { test, expect } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { serverCrypto } from "@/src/lib/crypto";
import { pdf } from "../fixtures/pdf";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// Decided 24 Oct 2026: a paper of the same client, type, period and GSTIN becomes current and
// the older one is kept as an earlier version; a GST paper names its GSTIN when the client
// has more than one; asking for papers starts from a list for the kind of client.
test("a newer paper becomes current, the older stays as an earlier version, each under its GSTIN", async ({ page, browser }) => {
  test.setTimeout(120_000);
  loadEnvConfig(process.cwd());
  const email = `owner-${randomUUID()}@example.test`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("Versions Test Firm", email, key);
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

    // A business with two invented GSTINs.
    const tag = randomUUID().slice(0, 8);
    const name = `Shah Fabrics ${tag}`;
    const crypto = serverCrypto();
    const [{ id: client }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, name]);
    const gstins: string[] = [];
    for (const number of ["24AAACS1234A1Z5", "27AAACS1234A1Z1"]) {
      const [{ id }] = await query(local.dbUrl, "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, 'gstin', $3, $4) returning id", [
        firm.firmId, client, await crypto.encrypt(firm.firmId, `clients/${client}/gstin`, number), `${tag}-${number}`,
      ]);
      gstins.push(id);
    }

    // Uploading GST papers asks which GSTIN they are for.
    await page.goto(`/app/clients/${client}?tab=documents`);
    const rows = page.locator("section[aria-labelledby=files] tbody tr");
    const upload = async (content: string, gstin?: string) => {
      await page.getByRole("link", { name: "Upload papers" }).click();
      await page.getByLabel("Files", { exact: true }).setInputFiles({ name: "bills.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf(content)) });
      await page.getByLabel("Paper type", { exact: true }).selectOption("Purchase bills");
      await page.getByLabel("Type of work", { exact: true }).selectOption("gst");
      await page.getByLabel("Period", { exact: true }).selectOption({ label: "Sep 2026" });
      if (gstin) await page.getByLabel("GSTIN, for GST papers").selectOption({ label: gstin });
      await page.getByRole("button", { name: "Upload", exact: true }).click();
    };
    await upload("Invented purchase bills, first copy");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Choose the GSTIN this GST paper is for.");
    await page.goto(`/app/clients/${client}?tab=documents`);
    await upload("Invented purchase bills, first copy", "24AAACS1234A1Z5");
    await expect(page.getByRole("status")).toContainText(`Saved as ${name} - Purchase bills - Sep 2026.pdf`);
    await upload("Invented purchase bills, corrected copy", "24AAACS1234A1Z5");
    await expect(page.getByRole("status")).toContainText("Saved as");
    // One row for the paper; the first copy is listed under Earlier versions, and both files stay in the drive.
    await expect(rows.filter({ hasText: "Purchase bills" })).toHaveCount(1);
    const papers = await query(local.dbUrl, "select name, status, registration_id from public.documents where client_id = $1 order by received_at", [client]);
    expect(papers.map((row) => [row.status, row.registration_id])).toEqual([["earlier", gstins[0]], ["filed", gstins[0]]]);
    expect((await readdir(path.join(TEST_DRIVE, "InboxCA", "FY 2026-27", name, "GST"))).sort()).toEqual(papers.map((row) => row.name).sort());
    await rows.getByRole("link", { name: /^Open/ }).click();
    await expect(page.getByRole("list", { name: "Earlier versions" })).toContainText(papers[0].name);

    // The Documents page lists the current paper only, with its GSTIN.
    await page.goto("/app/documents?year=all");
    const list = page.getByRole("region", { name: "Papers" });
    await expect(list.getByRole("row")).toHaveCount(2);
    await list.getByRole("link", { name: /Purchase bills/ }).click();
    await expect(page.getByRole("complementary", { name: "Paper" })).toContainText("24AAACS1234A1Z5");

    // Asking for papers starts from the list for a business, each paper once, the usual five
    // first, for the month of the next return due; it names the GSTIN for GST papers.
    const [{ due }] = await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'GSTR1_M', to_char(current_date - interval '2 months', 'YYYY-MM'), current_date + 3) returning period_key as due", [firm.firmId, client]);
    await page.goto(`/app/clients/${client}?tab=documents&ask=1`);
    const ask = page.getByRole("dialog");
    await expect(ask.getByRole("group", { name: "Papers" })).toContainText("Expense bills");
    await expect(ask.getByRole("checkbox", { name: "Bank statement" })).toHaveCount(1);
    await expect(ask.getByRole("checkbox", { name: "Trial balance" })).toBeHidden();
    await expect(ask.getByLabel("For", { exact: true })).toHaveValue(due);
    // Two items, so the link stays open while the client sends the sales bills twice.
    await ask.getByLabel("Sales bills").check();
    await ask.getByLabel("Expense bills").check();
    await ask.getByLabel("GSTIN, for GST papers").selectOption({ label: "27AAACS1234A1Z1" });
    await ask.getByLabel("For", { exact: true }).selectOption({ label: "Sep 2026" });
    await ask.getByRole("button", { name: "Ask for papers" }).click();
    const link = (await page.locator(".link-once").textContent())!;
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(link);
    for (const [content, received] of [["Invented sales bills", "Received: 1 file"], ["Invented sales bills, corrected", "Received: 2 files"]]) {
      const sales = visitor.getByRole("listitem").filter({ hasText: "Sales bills" });
      // A paper already received offers Add more in place of the large button.
      await sales.getByLabel(/^Add (more for )?Sales bills/).setInputFiles({ name: "sales.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf(content)) });
      await expect(sales).toContainText(received);
    }
    await visitor.close();
    expect((await query(local.dbUrl, "select status, registration_id from public.documents where client_id = $1 and document_type = 'Sales bills' order by received_at", [client])).map((row) => [row.status, row.registration_id])).toEqual([["earlier", gstins[1]], ["filed", gstins[1]]]);
    await page.goto(`/app/clients/${client}?tab=documents`);
    await expect(rows.filter({ hasText: "Sales bills" })).toHaveCount(1);

    // The firm changes its own list for businesses; an empty list goes back to the starting one.
    await page.goto(`/app/clients/${client}?tab=documents&ask=1`);
    await ask.getByText("Change the usual list for Business").click();
    await ask.getByLabel(/One paper on each line/).fill("Partnership deed\nBank statement");
    await ask.getByRole("button", { name: "Save list" }).click();
    await expect(ask.getByRole("group", { name: "Papers" })).toContainText("Partnership deed");
    await expect(ask.getByRole("group", { name: "Papers" })).not.toContainText("Expense bills");
    await ask.getByText("Change the usual list for Business").click();
    await ask.getByLabel(/One paper on each line/).fill("");
    await ask.getByRole("button", { name: "Save list" }).click();
    await expect(ask.getByRole("group", { name: "Papers" })).toContainText("Expense bills");
  } finally {
    await firm.remove();
  }
});
