import { randomBytes, randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { test, expect } from "@playwright/test";
import { pdf } from "../fixtures/pdf";
import { actionFields, emailStep, localSupabase, query, seedFirm, totp, workerReads } from "./local-supabase";

const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// #53: protected pixels, blank printing and capture logging, without file controls.
test("PDFs, spreadsheets and photos arrive as personal page images, with no file controls", async ({ page, browser }) => {
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
    const photo = createCanvas(800, 600);
    photo.getContext("2d").fillRect(0, 0, 800, 600);
    for (const file of [
      { name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented viewer statement", 3)) },
      { name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Amount\n" + Array.from({ length: 85 }, (_, n) => `Invented Client ${n},1200`).join("\n")) },
      { name: "sample.xls", mimeType: "application/vnd.ms-excel", buffer: (await import("node:fs/promises")).readFile("tests/fixtures/statement.xls") },
      { name: "sample.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: (await import("node:fs/promises")).readFile("tests/fixtures/clients.xlsx") },
      { name: "sample.jpg", mimeType: "image/jpeg", buffer: await photo.encode("jpeg") },
    ]) {
      // #19: an approved upload is used once; replaying its form cannot upload again.
      let grant: string | undefined;
      if (file.name === "sample.pdf") {
        grant = randomUUID();
        await query(local.dbUrl, "insert into public.requests (id,firm_id,kind,client_id,entity_type,entity_id,reason_code,status,expires_at,details) values ($1,$2,'permission',$3,'permission',$1,'upload','approved',now()+interval '1 hour',jsonb_build_object('by',$4::text))", [grant, firm.firmId, client.id, firm.ownerId]);
        await query(local.dbUrl, "update public.firm_members set role='staff' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      }
      await page.goto(`${clientUrl}?tab=files`);
      await page.getByRole("link", { name: "Upload papers" }).click();
      await page.getByLabel("Files", { exact: true }).setInputFiles({ ...file, buffer: await file.buffer });
      await page.getByLabel("Paper type", { exact: true }).selectOption("Other");
      await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Sample statement");
      await page.getByLabel("Type of work", { exact: true }).selectOption("income_tax");
      await page.getByLabel("Period", { exact: true }).selectOption({ label: "No period" });
      const uploadFields = grant ? await actionFields(page, page.url(), { client: client.id, file: "" }) : null;
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Saved as");
      if (grant && uploadFields) {
        expect((await query(local.dbUrl, "select status from public.requests where id=$1", [grant]))[0].status).toBe("used");
        const again = await page.request.post(`${clientUrl}?tab=files`, { multipart: { ...uploadFields, type: "Other", custom: "Another statement", work: "income_tax", period: "", file: { name: "second.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("A different invented statement")) } }, headers: { Origin: new URL(page.url()).origin } });
        expect(again.url()).toContain("error=needs");
        expect((await query(local.dbUrl, "select count(*)::int n from public.documents where firm_id=$1", [firm.firmId]))[0].n).toBe(1);
        await query(local.dbUrl, "update public.firm_members set role='owner' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      }
      const [doc] = await query(local.dbUrl, "select id, drive_file_id from public.documents where firm_id = $1 and name like $2", [firm.firmId, `%${file.name.slice(file.name.lastIndexOf('.'))}`]);
      const route = `/app/files/${doc.id}`;
      let openings = 0;
      const open = async () => {
        const before = await workerReads(doc.drive_file_id);
        await page.goto(`${route}/view`);
        await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
        const count = ["sample.pdf", "sample.csv"].includes(file.name) ? 3 : 1;
        await expect(page.locator(".viewer-pages img")).toHaveCount(count);
        await expect.poll(() => page.getByRole("img", { name: `Page ${count}`, exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
        expect(await workerReads(doc.drive_file_id)).toBe(before + 1);
        expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and entity_id=$2 and action='document.viewed'", [firm.firmId, doc.id]))[0].n).toBe(++openings);
      };
      await open();
      await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
      await expect.poll(() => page.getByRole("img", { name: "Page 1", exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await expect(page.getByRole("link", { name: /download|print|copy|share/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /download|print|copy|share/i })).toHaveCount(0);
      const outsider = await browser.newContext();
      const response = await outsider.request.get(`${route}/stream`, { maxRedirects: 0 });
      expect([303, 307, 404]).toContain(response.status());
      await outsider.close();
      await query(local.dbUrl, "update public.firm_members set role='staff' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      try {
        expect((await page.request.get(`${route}?view=1`, { headers: { "x-inboxca-viewer": "1" } })).status()).toBe(404);
        await open();
      } finally {
        await query(local.dbUrl, "update public.firm_members set role='owner' where firm_id=$1 and user_id=$2", [firm.firmId, firm.ownerId]);
      }
      if (file.name === "sample.pdf") {
        // #53: copying, dragging and the inactive window option also keep pages hidden.
        expect(await page.locator(".viewer-pages").evaluate((holder) => ["copy", "dragstart", "contextmenu"].every((type) => !holder.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))))).toBe(true);
        await query(local.dbUrl, "update public.firms set settings=jsonb_set(settings,'{viewer_hide_inactive}','true') where id=$1", [firm.firmId]);
        await open();
        await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeHidden();
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
        await query(local.dbUrl, "update public.firms set settings=jsonb_set(settings,'{viewer_hide_inactive}','false') where id=$1", [firm.firmId]);
        await open();
        await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
      }
      await page.keyboard.press("PrintScreen");
      await expect(page.locator(".viewer-pages")).toHaveClass(/is-blank/);
      await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeHidden();
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".viewer-pages")).toBeHidden();
      await page.emulateMedia({ media: "screen" });
      expect(requests.some((url) => /pdf\.worker|\/files\/[^/]+\?view=/.test(url))).toBe(false);
    }
    await expect.poll(async () => (await query(local.dbUrl, "select (details->>'count')::int n from public.requests where firm_id=$1 and reason_code='captures'", [firm.firmId]))[0]?.n).toBe(5);
    await page.goto("/app");
    await expect(page.getByRole("alert").filter({ hasText: `${email} tried to capture a document's screen 5 times today.` })).toBeVisible();
    await expect.poll(async () => (await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and action='document.viewed'", [firm.firmId]))[0].n).toBe(12);
    // With no drive linked a paper says so, not that it was moved or removed.
    const [paper] = await query(local.dbUrl, "select id from public.documents where firm_id = $1 limit 1", [firm.firmId]);
    await query(local.dbUrl, "delete from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId]);
    await page.goto(`/app/files/${paper.id}/view`);
    await expect(page.getByText("The firm's drive is not connected yet, so papers cannot be shown.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "could not be opened" })).toHaveCount(0);
  } finally {
    await firm.remove();
  }
});
