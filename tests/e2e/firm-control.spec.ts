import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Page } from "@playwright/test";
import { serverCrypto } from "@/src/lib/crypto";
import { personName } from "@/src/lib/roles";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// A firm in control of its own dates and returns: the owner confirms a due date against its
// notification and client reminders stop being held; People shows who is behind; a company's
// AGM date puts its ROC returns on the calendar; a tax audit report keeps its UDIN; a return's
// working paper names its sources and who signed it off. Skipped when local Supabase is not
// running.
loadEnvConfig(process.cwd());
const local = localSupabase();
test.skip(!local.url, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `control-owner-${tag}@example.test`;
const staffEmail = `control-staff-${tag}@example.test`;
const ownerKey = appKey();
const code = `FC${tag.toUpperCase()}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let company = "", business = "", cin = "", audit = "", paper = "";

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Control Firm ${tag}`, ownerEmail, ownerKey);
  const staff = await addPerson(firm.firmId, staffEmail, "staff", appKey());
  const crypto = serverCrypto();
  // An invented monthly return with an official link that nobody has checked yet, on a
  // business the staff member looks after, due in 5 days.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url) values ($1, $2, 'monthly', '{\"for\": \"pan\", \"after\": 1, \"day\": 11}', 'https://example.test/notification')", [code, `Control test return ${tag}`]);
  [{ id: business }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `Control Business ${tag}`]);
  const pan = `CTRLP${tag.slice(0, 4).toUpperCase()}A`;
  await query(local.dbUrl, "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, services) values ($1, $2, 'pan', $3, $4, $5)", [firm.firmId, business, await crypto.encrypt(firm.firmId, `clients/${business}/pan`, pan), await crypto.blindIndex(firm.firmId, "pan", pan), [code, "TAX_AUDIT"]]);
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm.firmId, business, staff]);
  await query(local.dbUrl, "delete from public.tasks where client_id = $1", [business]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-10', (now() at time zone 'Asia/Kolkata')::date + 5)", [firm.firmId, business, code]);
  // A company with its CIN and the two returns that follow the AGM.
  [{ id: company }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'company') returning id", [firm.firmId, `Control Company ${tag}`]);
  const number = `U12345MH2020PTC${tag.replace(/\D/g, "0").slice(0, 6)}`;
  [{ id: cin }] = await query(local.dbUrl, "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, services) values ($1, $2, 'cin', $3, $4, '{AOC4,MGT7}') returning id", [firm.firmId, company, await crypto.encrypt(firm.firmId, `clients/${company}/cin`, number), await crypto.blindIndex(firm.firmId, "cin", number)]);
  // A prepared GSTR-1 the owner prepared and approved, for the working paper.
  [{ id: paper }] = await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, drive_file_id, name, size, sha256, prepared) values ($1, $2, 'gst', 'Prepared return', '2026-09', 'invented.xlsx', $3, 1, 'invented', $4) returning id", [firm.firmId, business, `Control Business ${tag} - GSTR-1 - Sep 2026.xlsx`, { form: "GSTR1", registration: randomUUID(), version: 1, template: "2.1", sources: [{ id: randomUUID(), revision: 1 }], status: "approved" }]);
  await query(local.dbUrl, "insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'form.prepared', 'document', $3), ($1, $2, 'form.approved', 'document', $3)", [firm.firmId, firm.ownerId, paper]);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
});
test.afterAll(async () => {
  await firm.remove(staffEmail);
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("the owner confirms a due date against its notification, and client reminders stop being held", async () => {
  // Today holds client reminders while the firm's only coming return is on an unchecked date.
  await owner.goto("/app");
  await expect(owner.getByRole("region", { name: "Client reminders" })).toContainText("Client reminders are paused");
  await owner.goto("/app/settings?group=reminders#due-dates");
  const card = owner.locator("section#due_dates");
  const row = card.getByRole("listitem").filter({ hasText: `Control test return ${tag}` });
  await expect(row).toContainText("Next: Oct 2026");
  await expect(row.getByRole("link", { name: "Open the notification" })).toHaveAttribute("href", "https://example.test/notification");
  await row.getByRole("button", { name: "I checked this date against the notification" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Date confirmed." })).toBeVisible();
  await expect(row).toContainText(`Confirmed by ${personName(ownerEmail)}`);
  expect(await query(local.dbUrl, "select code, confirmed_by, source_url from public.firm_due_dates where firm_id = $1", [firm.firmId])).toEqual([{ code, confirmed_by: firm.ownerId, source_url: "https://example.test/notification" }]);
  // Orelu's rule is untouched, and the firm's dates no longer carry the unchecked mark.
  expect((await query(local.dbUrl, "select verified_on from public.compliance_types where code = $1", [code]))[0].verified_on).toBeNull();
  await owner.goto("/app");
  await expect(owner.getByRole("region", { name: "Client reminders" })).toHaveCount(0);
  await owner.goto(`/app/clients/${business}?tab=returns`);
  await expect(owner.locator(".app-row").filter({ hasText: `Control test return ${tag}` })).not.toContainText("*");
  await expect(owner.getByText("InboxCA has not yet checked dates marked *")).toHaveCount(0);
});

test("People shows who is behind, by person", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("row").filter({ hasText: staffEmail });
  await expect(row).toContainText("1 return open");
  await expect(row).toContainText("0 clients asked for papers");
});

test("a company's AGM date puts its ROC returns on the calendar", async () => {
  await owner.goto(`/app/clients/${company}?tab=returns`);
  await owner.getByLabel("AGM date").fill("2026-09-29");
  await owner.getByLabel("Financial year").selectOption("2026-03");
  await owner.getByRole("button", { name: "Save AGM date" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "AGM date saved." })).toBeVisible();
  await expect(owner.getByRole("listitem").filter({ hasText: "AOC-4" })).toContainText("Due 29 Oct 2026");
  await expect(owner.getByRole("listitem").filter({ hasText: "MGT-7" })).toContainText("Due 28 Nov 2026");
  expect(await query(local.dbUrl, "select code, to_char(due_on, 'YYYY-MM-DD') due_on from public.tasks where registration_id = $1 order by code", [cin])).toEqual([{ code: "AOC4", due_on: "2026-10-29" }, { code: "MGT7", due_on: "2026-11-28" }]);
});

test("a tax audit report marked filed keeps its UDIN", async () => {
  [{ id: audit }] = await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, 'TAX_AUDIT', '2026-03', (now() at time zone 'Asia/Kolkata')::date + 20) returning id", [firm.firmId, business]);
  await owner.goto(`/app/clients/${business}?tab=returns&task=${audit}`);
  const panel = owner.getByRole("dialog", { name: "Mark filed" });
  await panel.getByLabel(/^UDIN/).fill("26123456ABCDEFGH12");
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "marked filed" })).toBeVisible();
  await owner.goto(`/app/clients/${business}?tab=returns&show=filed`);
  await expect(owner.locator(".app-row").filter({ hasText: "Tax audit report" })).toContainText("UDIN 26123456ABCDEFGH12");
  expect((await query(local.dbUrl, "select details->>'udin' udin from public.tasks where id = $1", [audit]))[0].udin).toBe("26123456ABCDEFGH12");
});

test("a return's working paper names who prepared and approved it, and prints from the browser", async () => {
  await owner.goto(`/app/files/${paper}/paper`);
  await expect(owner.locator(".wp")).toContainText("Working paper");
  await expect(owner.getByRole("row").filter({ hasText: "Prepared" })).toContainText(personName(ownerEmail));
  await expect(owner.getByRole("row", { name: /^Approved / })).toContainText(personName(ownerEmail));
  await expect(owner.getByRole("button", { name: "Print" })).toBeVisible();
  // The client's Return files show the same sign off line.
  await owner.goto(`/app/clients/${business}?tab=outputs`);
  await expect(owner.locator(".rf-card").first()).toContainText(`Prepared by ${personName(ownerEmail)}`);
});
