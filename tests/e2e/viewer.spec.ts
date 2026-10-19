import { randomBytes, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { pdf } from "../fixtures/pdf";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

test("PDFs and spreadsheets arrive as personal page images, with no file controls", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `viewer-${randomUUID()}@example.test`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("Viewer Test Firm", email, key);
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
    const [client] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `Viewer Client ${randomUUID().slice(0, 8)}`]);
    const clientUrl = `/app/clients/${client.id}`;
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    for (const file of [
      { name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented viewer statement")) },
      { name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Amount\nInvented Client,1200") },
      { name: "sample.xls", mimeType: "application/vnd.ms-excel", buffer: (await import("node:fs/promises")).readFile("tests/fixtures/statement.xls") },
      { name: "sample.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: (await import("node:fs/promises")).readFile("tests/fixtures/clients.xlsx") },
    ]) {
      await page.goto(`${clientUrl}?tab=files`);
      await page.getByRole("link", { name: "Upload a file" }).click();
      await page.getByLabel("File", { exact: true }).setInputFiles({ ...file, buffer: await file.buffer });
      await page.getByLabel("Type", { exact: true }).selectOption("Other");
      await page.getByLabel("Name for Other").fill("Sample statement");
      await page.getByLabel("Work", { exact: true }).selectOption("income_tax");
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Saved as");
      const [doc] = await query(local.dbUrl, "select id from public.documents where firm_id = $1 and name like $2", [firm.firmId, `%${file.name.slice(file.name.lastIndexOf('.'))}`]);
      const route = `/app/files/${doc.id}`;
      await page.goto(`${route}/view`);
      await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
      await expect.poll(() => page.getByRole("img", { name: "Page 1", exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await expect(page.getByRole("link", { name: /download|print|copy|share/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /download|print|copy|share/i })).toHaveCount(0);
      const image = await page.request.get(`${route}/pages/1`);
      expect(image.headers()).toMatchObject({ "content-type": "image/png", "cache-control": "private, no-store" });
      expect((await image.body()).subarray(1, 4).toString()).toBe("PNG");
      expect((await page.request.get(`${route}/pages/0`)).status()).toBe(422);
      const outsider = await browser.newContext();
      const response = await outsider.request.get(`${route}/pages/1`, { maxRedirects: 0 });
      expect([303, 307, 404]).toContain(response.status());
      await outsider.close();
      await query(local.dbUrl, "update public.firm_members set role='staff' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      try {
        expect((await page.request.get(`${route}?view=1`, { headers: { "x-inboxca-viewer": "1" } })).status()).toBe(404);
        expect((await page.request.get(`${route}/pages/1`)).headers()["content-type"]).toBe("image/png");
      } finally {
        await query(local.dbUrl, "update public.firm_members set role='owner' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      }
      await page.keyboard.press("PrintScreen");
      await expect(page.locator(".viewer-pages")).toHaveClass(/is-blank/);
      await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeHidden();
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".viewer-pages")).toBeHidden();
      await page.emulateMedia({ media: "screen" });
      expect(requests.some((url) => /pdf\.worker|\/files\/[^/]+\?view=/.test(url))).toBe(false);
    }
    await expect.poll(async () => (await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and action='document.viewed'", [firm.firmId]))[0].n).toBeGreaterThanOrEqual(6);
  } finally {
    await firm.remove();
  }
});
