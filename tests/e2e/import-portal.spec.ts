import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { emailStep, localSupabase, query, runJobs, seedFirm, totp } from "./local-supabase";
import { gstr2a, inventedGstin } from "../fixtures/portal";

// Portal files dropped in from Documents and from a client's Returns, and old files sent from
// a disk into the drive's Incoming folder, then sorted. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `import-${tag}@example.test`;
const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const clientName = `Patel Textiles ${tag}`;
const drive = TEST_DRIVE;
const statement = (rtnprd: string) => Buffer.from(JSON.stringify({ data: { gstin: "27AAPFU0939F1ZV", rtnprd, version: "1.0", docdata: { b2b: [] } } }));
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let clientId: string;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Import Test Firm", ownerEmail, key);
  owner = await (await browser.newContext()).newPage();
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(key));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
  await owner.goto("/app/settings");
  const section = owner.locator("section#drive");
  await section.getByLabel("Test drive on this computer").check();
  await section.getByLabel(/I have read this and I agree/).check();
  await section.getByRole("button", { name: "Connect drive" }).click();
  await expect(section.getByRole("status")).toContainText("Connected");
  await owner.goto("/app/clients");
  await owner.getByLabel("Name", { exact: true }).fill(clientName);
  await owner.getByLabel("Kind", { exact: true }).selectOption("business");
  await owner.getByLabel("GSTIN", { exact: true }).fill("27AAPFU0939F1ZV");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(clientName);
  [{ id: clientId }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, clientName]);
});
test.afterAll(() => firm.remove());

test("a GSTR-2B added on Documents comes back to Documents and closes what was asked for", async () => {
  const [{ id: ask }] = await query(
    local.dbUrl,
    `insert into public.requests (firm_id, kind, client_id, entity_type, entity_id, expires_at, details)
     values ($1, 'documents', $2, 'checklist', gen_random_uuid(), now() + interval '30 days', '{"period": "2026-09", "items": [{"type": "GSTR 2B", "work": "other", "received": []}], "link_hash": "invented"}') returning id`,
    [firm.firmId, clientId],
  );
  await owner.goto("/app/documents");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  await owner.getByLabel("Add portal files").setInputFiles({ name: "download.json", mimeType: "application/json", buffer: statement("092026") });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?dropped=1-0-0$/);
  await expect(owner.getByRole("status")).toContainText("1 filed in its client's folder");
  const [request] = await query(local.dbUrl, "select status, details from public.requests where id = $1", [ask]);
  expect(request.status).toBe("done");
  expect(request.details.items[0].received).toHaveLength(1);
});

test("a GSTR-2A added on Documents closes the GSTR-2A asked for", async () => {
  const name = `Mehta Agencies ${tag}`;
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(name);
  await owner.getByLabel("Kind", { exact: true }).selectOption("business");
  await owner.getByLabel("GSTIN", { exact: true }).fill(inventedGstin());
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(name);
  const [{ id: client }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, name]);
  const [{ id: ask }] = await query(
    local.dbUrl,
    `insert into public.requests (firm_id, kind, client_id, entity_type, entity_id, expires_at, details)
     values ($1, 'documents', $2, 'checklist', gen_random_uuid(), now() + interval '30 days', '{"period": "2026-09", "items": [{"type": "GSTR 2A", "work": "other", "received": []}], "link_hash": "invented-2a"}') returning id`,
    [firm.firmId, client],
  );
  await owner.goto("/app/documents");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  await owner.getByLabel("Add portal files").setInputFiles({ name: "download.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr2a())) });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?dropped=1-0-0$/);
  const [request] = await query(local.dbUrl, "select status from public.requests where id = $1", [ask]);
  expect(request.status).toBe("done");
  const [document] = await query(local.dbUrl, "select document_type, period_key from public.documents where client_id = $1", [client]);
  expect(document).toEqual({ document_type: "GSTR-2A", period_key: "2026-09" });
});

test("each open monthly GSTR-3B says whether its GSTR-2B is in, with the box beside it", async () => {
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'GSTR3B_M', '2026-09', current_date + 5), ($1, $2, 'GSTR3B_M', '2026-08', current_date + 4)", [firm.firmId, clientId]);
  await owner.goto(`/app/clients/${clientId}?tab=returns`);
  const rows = owner.locator("section[aria-labelledby=due] li");
  await expect(rows.filter({ hasText: "GSTR-2B for Sep 2026: added" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "GSTR-2B for Aug 2026: not added yet" })).toHaveCount(1);
  await owner.getByLabel("Add portal files").setInputFiles({ name: "august.json", mimeType: "application/json", buffer: statement("082026") });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/tab=returns&dropped=1-0-0$/);
  await expect(rows.filter({ hasText: "GSTR-2B for Aug 2026: added" })).toHaveCount(1);
  await expect(owner.getByLabel("Add portal files")).toHaveCount(0);
});

test("old files on a disk go into Incoming by checksum, and a folder's client is found by search", async ({ request }) => {
  // Nine clients that all match "Shah", one more than a page of the picker.
  await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) select $1, 'Shah ' || n || ' ' || $2, 'individual' from generate_series(1, 9) n", [firm.firmId, tag]);
  const disk = path.join(tmpdir(), `inboxca-disk-${tag}`, `Old files ${tag}`);
  await mkdir(path.join(disk, clientName, "GST"), { recursive: true });
  await mkdir(path.join(disk, "Unknown Traders"), { recursive: true });
  await writeFile(path.join(disk, clientName, "GST", "GSTR-3B Sep 2026.pdf"), "%PDF-1.4 invented return");
  await writeFile(path.join(disk, "Unknown Traders", "GSTR-1 Sep 2026.pdf"), "%PDF-1.4 invented return");
  // A year old: the firm is in its first 14 days, so this one waits.
  await writeFile(path.join(disk, clientName, "ITR-V AY 2025-26.pdf"), "%PDF-1.4 invented ITR-V");

  await owner.goto("/app/import");
  await expect(owner.getByRole("status").filter({ hasText: "In your first 14 days" })).toBeVisible();
  // The folder picker answers once the page's script has loaded.
  await owner.waitForLoadState("networkidle");
  await owner.getByLabel("Choose a folder").setInputFiles(disk);
  const disked = owner.locator("section[aria-labelledby=disk]");
  await expect(disked.getByText("Final papers only (recommended)")).toContainText(/2 files, 1 MB, under 2 minutes/);
  await disked.getByRole("button", { name: "Send to your drive" }).click();
  await expect(disked.getByRole("status")).toContainText("2 of 2 files are in your drive's Incoming folder.");
  const incoming = path.join(drive, "InboxCA", "Incoming", `Old files ${tag}`);
  expect(await readFile(path.join(incoming, clientName, "GST", "GSTR-3B Sep 2026.pdf"), "utf8")).toBe("%PDF-1.4 invented return");

  // Sending the same folder again finds both already there.
  await owner.getByLabel("Choose a folder").setInputFiles(disk);
  await disked.getByRole("button", { name: "Send to your drive" }).click();
  await expect(disked.getByRole("status")).toContainText("2 of 2 files are in your drive's Incoming folder.");

  await disked.getByRole("link", { name: "Sort them into client folders" }).click();
  const unknown = `InboxCA/Incoming/Old files ${tag}/Unknown Traders`;
  await owner.getByRole("link", { name: `Choose the client for ${unknown}` }).click();
  const panel = owner.getByRole("dialog", { name: "Choose the client" });
  await panel.getByLabel("Find a client").fill(`Shah`);
  await panel.getByLabel("Find a client").press("Enter");
  await expect(panel.getByRole("link", { name: /^Choose Shah/ })).toHaveCount(8);
  await panel.getByRole("link", { name: "More clients" }).click();
  await expect(panel.getByRole("link", { name: /^Choose Shah/ })).toHaveCount(1);
  await panel.getByLabel("Find a client").fill(clientName);
  await panel.getByLabel("Find a client").press("Enter");
  await panel.getByRole("link", { name: `Choose ${clientName}` }).click();
  await expect(owner.locator(".import-map").filter({ hasText: unknown })).toContainText(clientName);
  await owner.getByRole("button", { name: "Move these files" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Moving your files now" })).toBeVisible();
  await runJobs(request, firm.firmId);
  const gst = path.join(drive, "InboxCA", "FY 2026-27", clientName, "GST");
  expect(await readFile(path.join(gst, `${clientName} - GSTR-3B - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented return");
  expect(await readFile(path.join(gst, `${clientName} - GSTR-1 - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented return");
});
