import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { pdf } from "../fixtures/pdf";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

const newKey = () => Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
async function signIn(page: Page, email: string, key: string) {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
}
// A file put straight into the test drive, below InboxCA's folder, as a person would by hand.
async function put(parts: string[], bytes: Uint8Array) {
  await mkdir(path.join(TEST_DRIVE, "InboxCA", ...parts.slice(0, -1)), { recursive: true });
  await writeFile(path.join(TEST_DRIVE, "InboxCA", ...parts), bytes);
  return path.join("InboxCA", ...parts);
}

test("the drive's folders as the drive shows them: a hand placed file is filed in place, papers preview, and restricted staff see only their clients", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = randomUUID().slice(0, 8);
  const ownerEmail = `folders-${tag}@example.test`;
  const staffEmail = `folders-staff-${tag}@example.test`;
  const ownerKey = newKey();
  const staffKey = newKey();
  const firm = await seedFirm(`Folders Firm ${tag}`, ownerEmail, ownerKey);
  try {
    await signIn(page, ownerEmail, ownerKey);
    await page.goto("/app/settings");
    const drive = page.locator("section#drive");
    await drive.getByLabel("Test drive on this computer").check();
    await drive.getByLabel(/I have read this and I agree/).check();
    await drive.getByRole("button", { name: "Connect drive" }).click();
    await expect(drive.getByRole("status")).toContainText("Connected:");

    const patel = `Patel Textiles ${tag}`;
    const mehta = `Mehta Exports ${tag}`;
    const [mine] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, patel]);
    await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business')", [firm.firmId, mehta]);
    // A paper InboxCA filed, one put in the client's folder by hand, and another client's.
    const bills = Buffer.from(pdf("Invented purchase bills"));
    const filedName = `${patel} - Purchase bills - Sep 2026.pdf`;
    const filedId = await put(["FY 2026-27", patel, "GST", filedName], bills);
    await query(
      local.dbUrl,
      "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, status, drive_file_id, name, size, sha256) values ($1, $2, 'gst', 'Purchase bills', '2026-09', 'filed', $3, $4, $5, $6)",
      [firm.firmId, mine.id, filedId, filedName, bills.length, createHash("sha256").update(bills).digest("hex")],
    );
    await put(["FY 2026-27", patel, "GST", "scan 0042.pdf"], Buffer.from(pdf("Invented sales bills scan")));
    await put(["FY 2026-27", mehta, "GST", "mehta.pdf"], Buffer.from(pdf("Invented other client")));

    // Browse in from InboxCA's folder: the tree, the list and the path move together.
    await page.goto("/app/documents?view=folders");
    const main = page.getByRole("region", { name: "Folder" });
    const tree = page.getByRole("navigation", { name: "Folders" });
    await expect(tree.getByRole("link", { name: "InboxCA" })).toHaveAttribute("aria-current", "page");
    await main.getByRole("link", { name: "FY 2026-27", exact: true }).click();
    await main.getByRole("link", { name: patel, exact: true }).click();
    await main.getByRole("link", { name: "GST", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`path=FY\\+2026-27%2F${encodeURIComponent(patel).replace(/%20/g, "\\+")}%2FGST`));
    await expect(main.getByRole("navigation", { name: "Folder path" })).toContainText(`InboxCA${"FY 2026-27"}${patel}GST`);
    await expect(tree.locator("[aria-current=page]")).toHaveText("GST");

    // The hand placed file is listed and marked; filing it moves it under InboxCA's name.
    const scan = main.getByRole("row", { name: /scan 0042\.pdf/ });
    await expect(scan).toContainText("Not filed in InboxCA");
    await expect(main.getByRole("row", { name: new RegExp(filedName) })).toContainText("Purchase bills, GST, Sep 2026");
    await scan.getByRole("button").click();
    const details = page.getByRole("complementary", { name: "Details" });
    const form = details.getByRole("form", { name: "File this paper" });
    await expect(form).toContainText(`For ${patel}`);
    await form.getByLabel("Type").selectOption("Sales bills");
    await form.getByLabel("Period").selectOption({ label: "Sep 2026" });
    await form.getByRole("button", { name: "File this paper" }).click();
    const sales = `${patel} - Sales bills - Sep 2026.pdf`;
    await expect(page.getByRole("status").filter({ hasText: `Filed as ${sales}` })).toBeVisible();
    await expect(main.getByRole("row", { name: /scan 0042\.pdf/ })).toHaveCount(0);
    await expect(main.getByRole("row", { name: new RegExp(sales) })).toContainText("Sales bills, GST, Sep 2026");
    // Chosen, it says who filed it from the drive, and when, beside its path.
    await main.getByRole("row", { name: new RegExp(sales) }).getByRole("button").click();
    await expect(details).toContainText(/Found in the drive and saved by Folders, \d{1,2} \w{3}, \d\d:\d\d/);
    await expect(details).toContainText(`/InboxCA/FY 2026-27/${patel}/GST/${sales}`);
    const [filed] = await query(local.dbUrl, "select status, drive_file_id from public.documents where firm_id = $1 and name = $2", [firm.firmId, sales]);
    expect(filed).toEqual({ status: "filed", drive_file_id: path.join("InboxCA", "FY 2026-27", patel, "GST", sales) });
    await access(path.join(TEST_DRIVE, filed.drive_file_id));
    await expect(access(path.join(TEST_DRIVE, "InboxCA", "FY 2026-27", patel, "GST", "scan 0042.pdf"))).rejects.toThrow();

    // A filed paper previews its first page, with where it came from and what can be done.
    await main.getByRole("row", { name: new RegExp(filedName) }).getByRole("button").click();
    await expect(details.getByRole("img", { name: "Page 1" })).toBeVisible();
    await expect(details).toContainText("From the drive");
    await expect(details.getByRole("link", { name: "Download" })).toBeVisible();
    await expect(details.getByRole("link", { name: "Open client" })).toHaveAttribute("href", `/app/clients/${mine.id}`);

    // A paper dropped from the computer onto the folder is filed for its client there.
    const dropped = await page.evaluateHandle((bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], "GSTR-3B Sep 2026.pdf", { type: "application/pdf" }));
      return transfer;
    }, [...Buffer.from(pdf("Invented GSTR-3B"))]);
    await main.dispatchEvent("dragover", { dataTransfer: dropped });
    await expect(main.locator(".fb-drop")).toHaveText("Drop to upload to GST");
    await main.dispatchEvent("drop", { dataTransfer: dropped });
    await expect(page.getByRole("status").filter({ hasText: `1 paper filed for ${patel}.` })).toBeVisible();
    await expect(main.getByRole("row", { name: new RegExp(`${patel} - GSTR-3B - Sep 2026\\.pdf`) })).toContainText("GSTR-3B, GST, Sep 2026");

    // Restricted staff see their own client's folder only, and cannot ask for another's.
    const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
    const { data } = await admin.auth.admin.createUser({ email: staffEmail, email_confirm: true });
    await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, data.user!.id]);
    await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())", [data.user!.id, staffKey]);
    await query(local.dbUrl, "update public.firms set settings = settings || '{\"client_visibility\": \"restricted\"}' where id = $1", [firm.firmId]);
    await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm.firmId, mine.id, data.user!.id]);
    const staff = await (await browser.newContext()).newPage();
    await signIn(staff, staffEmail, staffKey);
    await staff.goto(`/app/documents?view=folders&path=${encodeURIComponent(`FY 2026-27/${mehta}/GST`)}`);
    const staffMain = staff.getByRole("region", { name: "Folder" });
    // The other client's folder opens the nearest folder the person may see instead.
    await expect(staffMain.getByRole("navigation", { name: "Folder path" }).locator("[aria-current]")).toHaveText("FY 2026-27");
    await expect(staffMain.getByRole("link", { name: patel, exact: true })).toBeVisible();
    await expect(staff.getByText(mehta)).toHaveCount(0);
    expect((await staff.request.get(`/app/documents/folders?path=${encodeURIComponent(`FY 2026-27/${mehta}`)}`)).status()).toBe(404);
    expect((await staff.request.get(`/app/documents/folders?path=Incoming`)).status()).toBe(404);
    const root = await (await staff.request.get("/app/documents/folders?path=")).json();
    expect(root.entries.map((entry: { name: string }) => entry.name)).not.toContain("Deleted and old versions");
    await staffMain.getByRole("link", { name: patel, exact: true }).click();
    await staffMain.getByRole("link", { name: "GST", exact: true }).click();
    await expect(staffMain.getByRole("row", { name: new RegExp(sales) })).toBeVisible();
  } finally {
    await firm.remove(staffEmail);
  }
});
