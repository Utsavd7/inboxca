import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TEST_DRIVE } from "../../playwright.config";
import { emailStep, localSupabase, query, runJobs, seedFirm, totp } from "./local-supabase";
import { gstr2a, inventedGstin } from "../fixtures/portal";
import { ais, form16, form26asText, itrVerification, pan, tan } from "../fixtures/tax-papers";
import { localDrive } from "@/src/lib/drive";

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
  await owner.getByLabel("Client type", { exact: true }).selectOption("business");
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
  await owner.goto("/app/documents?view=papers");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  await owner.getByLabel("Add portal files").setInputFiles({ name: "download.json", mimeType: "application/json", buffer: statement("092026") });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?dropped=1-0-0$/);
  await expect(owner.getByRole("status")).toContainText("1 saved in its client's folder");
  const [request] = await query(local.dbUrl, "select status, details from public.requests where id = $1", [ask]);
  expect(request.status).toBe("done");
  expect(request.details.items[0].received).toHaveLength(1);
});

test("a GSTR-2A added on Documents closes the GSTR-2A asked for", async () => {
  const name = `Mehta Agencies ${tag}`;
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(name);
  await owner.getByLabel("Client type", { exact: true }).selectOption("business");
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
  await owner.goto("/app/documents?view=papers");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  await owner.getByLabel("Add portal files").setInputFiles({ name: "download.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr2a())) });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?dropped=1-0-0$/);
  const [request] = await query(local.dbUrl, "select status from public.requests where id = $1", [ask]);
  expect(request.status).toBe("done");
  const [document] = await query(local.dbUrl, "select document_type, period_key from public.documents where client_id = $1", [client]);
  expect(document).toEqual({ document_type: "GSTR-2A", period_key: "2026-09" });
});

test("a Form 26AS text file and a Form 16 added on Documents are filed under the client by PAN, and the 26AS rows reach the year's figures; each ITR lists what its year still needs", async ({ request }) => {
  const name = `Iyer Consultants ${tag}`;
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(name);
  await owner.getByLabel("Client type", { exact: true }).selectOption("individual");
  await owner.getByLabel("PAN", { exact: true }).fill(pan);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(name);
  const [{ id: client }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, name]);
  await owner.goto("/app/documents?view=papers");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  await owner.getByLabel("Add portal files").setInputFiles([{ name: "download.txt", mimeType: "text/plain", buffer: form26asText() }, { name: "certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from(form16()) }]);
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?dropped=2-0-0$/);
  const papers = await query(local.dbUrl, "select id, document_type, period_key, work_type, name from public.documents where client_id = $1 order by document_type", [client]);
  expect(papers.map(({ document_type, period_key, work_type, name }) => ({ document_type, period_key, work_type, name }))).toEqual([
    { document_type: "Form 16", period_key: "2026", work_type: "income_tax", name: `${name} - Form 16 - FY 2025-26.pdf` },
    { document_type: "Form 26AS", period_key: "2026", work_type: "income_tax", name: `${name} - Form 26AS - FY 2025-26.txt` },
  ]);
  expect(await readFile(path.join(drive, "InboxCA", "FY 2025-26", name, "Income tax", `${name} - Form 26AS - FY 2025-26.txt`))).toEqual(form26asText());
  // Each says it was added as a portal file, by whom and when.
  await owner.goto(`/app/clients/${client}?tab=documents`);
  await expect(owner.locator("section[aria-labelledby=files] tbody tr").filter({ hasText: "Form 16" })).toContainText("Added as a portal file by Import, ");
  await runJobs(request, firm.firmId);
  // Each paper's figures wait in a draft of its own for the year, every one to be checked.
  const drafts = await query(local.dbUrl, "select id, form_code, period_key, data from public.datasets where client_id = $1 order by id", [client]);
  expect(drafts.map((draft) => [draft.id, draft.form_code, draft.period_key]).sort()).toEqual(papers.map((paper) => [paper.id, "ITR", "2026"]).sort());
  expect(drafts.every((draft) => draft.data.lines.every((line: { state: string }) => line.state === "pending"))).toBe(true);
  await owner.goto(`/app/clients/${client}?tab=extraction&draft=${papers[1].id}`);
  await expect(owner.getByRole("row").filter({ has: owner.getByRole("link", { name: `${tan}: total tax deducted`, exact: true }) })).toContainText(/64,?480/);
  await owner.goto(`/app/clients/${client}/itr?form=ITR1&year=2026`);
  // The return holds both papers; the 26AS rows are there to check it against, not to fill it.
  const held = owner.getByRole("region", { name: "Already filled" });
  await expect(held).toContainText(`${name} - Form 26AS - FY 2025-26.txt`);
  await expect(held).toContainText(`${name} - Form 16 - FY 2025-26.pdf`);
  await expect(owner.getByText("Choose a field from this official form")).toHaveCount(0);
  // Each open ITR lists the portal files its year still needs, by that year's names; the AIS dropped on Returns closes its item.
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'ITR_NA', '2026-03', current_date + 5), ($1, $2, 'ITR_NA', '2027-03', current_date + 270)", [firm.firmId, client]);
  await owner.goto(`/app/clients/${client}?tab=returns`);
  const itr = owner.locator("section[aria-labelledby=due] li");
  await expect(itr.filter({ hasText: "AIS for FY 2025-26: not added yet" })).toHaveCount(1);
  await expect(itr.filter({ hasText: "Form No. 130 (was Form 16), Form No. 168 (was Form 26AS) and AIS for Tax year 2026-27: not added yet" })).toHaveCount(1);
  await owner.getByLabel("Add portal files").setInputFiles({ name: "ais.pdf", mimeType: "application/pdf", buffer: Buffer.from(ais()) });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner).toHaveURL(/tab=returns&dropped=1-0-0$/);
  await expect(itr.filter({ hasText: "Form 16, Form 26AS and AIS for FY 2025-26: added" })).toHaveCount(1);
});

test("a locked ITR-V under a client's To check is filed as soon as a person types its password", async () => {
  const name = `Desai Associates ${tag}`, who = "ZZZPZ0006Z"; // ggignore: an invented PAN.
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(name);
  await owner.getByLabel("Client type", { exact: true }).selectOption("individual");
  await owner.getByLabel("PAN", { exact: true }).fill(who);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(name);
  const [{ id: client }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, name]);
  // As a client's email leaves it: under To check, its type and year not known, since the lock hides them.
  const bytes = Buffer.from(itrVerification("invented-pass", who)), store = localDrive(drive);
  const saved = await store.save(await store.ensureFolder(["FY 2026-27", name, "Other", "To check"]), `${name} - Document.pdf`, bytes);
  if (saved === "taken") throw new Error("Test file collision");
  const [{ id }] = await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, status, name, size, sha256, drive_file_id) values ($1, $2, 'other', 'Document', 'to_check', $3, $4, $5, $6) returning id", [firm.firmId, client, `${name} - Document.pdf`, bytes.length, createHash("sha256").update(bytes).digest("hex"), saved.id]);
  await owner.goto(`/app/files/${id}/view`);
  await owner.getByLabel("This PDF has a password. Type it to open the file.").fill("invented-pass");
  await owner.getByRole("button", { name: "Open", exact: true }).click();
  await expect(owner.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  const [paper] = await query(local.dbUrl, "select document_type, period_key, work_type, status, name from public.documents where id = $1", [id]);
  expect(paper).toEqual({ document_type: "ITR-V", period_key: "2026", work_type: "income_tax", status: "filed", name: `${name} - ITR-V - FY 2025-26.pdf` });
  expect(await readFile(path.join(drive, "InboxCA", "FY 2025-26", name, "Income tax", paper.name))).toEqual(bytes);
  expect((await query(local.dbUrl, "select actor_id from public.activity_log where entity_id = $1 and action = 'document.renamed'", [id]))).toEqual([{ actor_id: firm.ownerId }]);
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
  // Each moved paper says it came from the old files, and where it used to be.
  await owner.goto("/app/documents?view=papers");
  const moved = owner.getByRole("region", { name: "Papers" }).getByRole("row", { name: /GSTR-1 - Sep 2026/ });
  await expect(moved).toContainText("From your old files");
  await moved.getByRole("link").click();
  await expect(owner.getByRole("complementary", { name: "Paper" })).toContainText(`It used to be at ${unknown}/GSTR-1 Sep 2026.pdf`);
});
