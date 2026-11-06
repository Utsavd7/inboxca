import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import { readSheet } from "@/src/lib/sheet";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Undoing a client's details from its page: a number added by mistake is removed, a contact
// is taken off this client (and stays on the other it acts for), and a person stops looking
// after the client. Each is logged. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `edits-owner-${tag}@example.test`;
const staffEmail = `edits-staff-${tag}@example.test`;
const ownerKey = appKey();
const staffKey = appKey();
const contactEmail = `contact-${tag}@patel.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staffId = "";
const clients: Record<string, string> = {};
const logged = async (action: string) => (await query(local.dbUrl, "select entity_id from public.activity_log where firm_id = $1 and action = $2", [firm.firmId, action])).map((row) => row.entity_id);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Edits Firm ${tag}`, ownerEmail, ownerKey);
  staffId = await addPerson(firm.firmId, staffEmail, "staff", staffKey);
  for (const name of ["Mehta Traders", "Mehta Exports"])
    [{ id: clients[name] }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `${name} ${tag}`]);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
});
test.afterAll(() => firm.remove(staffEmail));

test("a number added by mistake is removed from the client", async () => {
  await owner.goto(`/app/clients/${clients["Mehta Traders"]}?tab=about`);
  await owner.getByRole("link", { name: "Edit tax numbers" }).click();
  const panel = owner.getByRole("dialog", { name: "Tax numbers" });
  await panel.getByLabel("Type", { exact: true }).selectOption("tan");
  await panel.getByLabel("Number", { exact: true }).fill("ahma12345c");
  await panel.getByRole("button", { name: "Add number" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "AHMA12345C" })).toBeVisible();
  await panel.getByRole("button", { name: "Remove AHMA12345C" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "AHMA12345C" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select kind from public.client_registrations where client_id = $1", [clients["Mehta Traders"]])).toEqual([]);
  expect(await logged("registration.removed")).toEqual([clients["Mehta Traders"]]);
});

test("a phone number saved on the client is kept encrypted and opens a WhatsApp chat", async () => {
  const id = clients["Mehta Exports"];
  await owner.goto(`/app/clients/${id}?tab=details`);
  const panel = owner.getByRole("dialog", { name: "Details" });
  await panel.getByLabel("Phone").fill("98765 43210");
  await panel.getByRole("button", { name: "Save details" }).click();
  const details = owner.locator("section").filter({ has: owner.locator("h2#details-card") });
  await expect(details).toContainText("+919876543210");
  await expect(details.getByRole("link", { name: "Message on WhatsApp" })).toHaveAttribute("href", "https://wa.me/919876543210");
  const [{ phone_enc }] = await query(local.dbUrl, "select phone_enc from public.clients where id = $1", [id]);
  expect(phone_enc).toBeTruthy();
  expect(phone_enc).not.toContain("9876543210");
});

test("a contact is taken off one client and still acts for the other", async () => {
  for (const name of ["Mehta Traders", "Mehta Exports"]) {
    await owner.goto(`/app/clients/${clients[name]}?tab=about`);
    await owner.getByRole("link", { name: "Edit contacts" }).click();
    await owner.getByLabel("Contact's name").fill("Kiran Mehta");
    await owner.getByLabel("Contact's email").fill(contactEmail);
    await owner.getByRole("button", { name: "Add contact" }).click();
    await expect(owner.getByRole("dialog", { name: "Contacts" }).getByRole("listitem").filter({ hasText: "Kiran Mehta" })).toBeVisible();
  }
  const links = async () => (await query(local.dbUrl, "select client_id from public.contact_clients where firm_id = $1", [firm.firmId])).map((row) => row.client_id);
  expect((await links()).sort()).toEqual([clients["Mehta Traders"], clients["Mehta Exports"]].sort());

  await owner.goto(`/app/clients/${clients["Mehta Traders"]}?tab=contacts`);
  const panel = owner.getByRole("dialog", { name: "Contacts" });
  await panel.getByRole("listitem").filter({ hasText: "Kiran Mehta" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "Kiran Mehta" })).toHaveCount(0);
  expect(await links()).toEqual([clients["Mehta Exports"]]);
  expect(await logged("contact_link.removed")).toEqual([clients["Mehta Traders"]]);
  await owner.goto(`/app/clients/${clients["Mehta Exports"]}?tab=contacts`);
  await expect(panel.getByRole("listitem").filter({ hasText: "Kiran Mehta" })).toContainText(contactEmail);
});

test("a person assigned to a client is unassigned again", async () => {
  await owner.goto(`/app/clients/${clients["Mehta Traders"]}?tab=team`);
  const panel = owner.getByRole("dialog", { name: "Looked after by" });
  await panel.getByLabel("Person or team").selectOption(`person:${staffId}`);
  await panel.getByLabel("Does").selectOption("manager");
  await panel.getByRole("button", { name: "Assign", exact: true }).click();
  const assigned = panel.getByRole("listitem").filter({ hasText: "Manager" });
  await expect(assigned).toBeVisible();
  expect(await query(local.dbUrl, "select user_id, role from public.client_assignments where client_id = $1", [clients["Mehta Traders"]])).toEqual([{ user_id: staffId, role: "manager" }]);
  await assigned.getByRole("button", { name: "Unassign" }).click();
  await expect(panel.getByText("Nobody is assigned yet.")).toBeVisible();
  expect(await query(local.dbUrl, "select 1 from public.client_assignments where client_id = $1", [clients["Mehta Traders"]])).toEqual([]);
  expect(await logged("assignment.removed")).toEqual([clients["Mehta Traders"]]);
});

test("tags, a note and a licence date on the client; the list filters by tag; the export imports back with formulas disarmed", async () => {
  const id = clients["Mehta Traders"];
  const until = addDays(todayInIndia(), 10);
  // A client whose name a spreadsheet would run as a formula.
  const [{ id: formula }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [firm.firmId, `=HYPERLINK("https://x.test") ${tag}`]);
  await owner.goto(`/app/clients/${id}?tab=details`);
  const panel = owner.getByRole("dialog", { name: "Details" });
  await panel.getByLabel("Tags, separated by commas").fill("Priority, Audit 2027");
  await panel.getByLabel("What we do for them, and since when").fill("GST returns and ITR since 2019");
  await panel.getByRole("button", { name: "Save details" }).click();
  const details = owner.locator("section").filter({ has: owner.locator("h2#details-card") });
  await expect(details).toContainText("GST returns and ITR since 2019");
  await expect(details).toContainText("Priority");
  const [{ engagement_enc }] = await query(local.dbUrl, "select engagement_enc from public.clients where id = $1", [id]);
  expect(engagement_enc).not.toContain("since 2019");
  await owner.goto(`/app/clients/${id}?tab=details`);
  await panel.getByLabel("Licence or registration").fill("FSSAI licence");
  await panel.getByLabel("Valid until").fill(until);
  await panel.getByRole("button", { name: "Add expiry date" }).click();
  await expect(details).toContainText(`FSSAI licence: until ${dueLabel(until)}`);
  expect(await logged("licence.added")).toHaveLength(1);
  // On the Calendar and the person's list before the date, renewed in one press.
  await owner.goto(`/app/calendar?day=${until}`);
  const row = owner.getByRole("row").filter({ hasText: `Mehta Traders ${tag}` });
  await expect(row).toContainText("FSSAI licence");
  await expect(row).toContainText("Expires");
  await owner.goto("/app/work");
  await expect(owner.getByRole("listitem").filter({ hasText: `Mehta Traders ${tag}` }).filter({ hasText: "FSSAI licence" })).toBeVisible();
  await owner.goto(`/app/calendar?day=${until}`);
  await row.getByRole("button", { name: /Mark .* renewed/ }).click();
  await expect(owner.getByRole("row").filter({ hasText: `Mehta Traders ${tag}` })).toContainText("Renewed");
  // Undo keeps the licence's own label; only the renewal goes.
  await owner.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(row).toContainText("Expires");
  expect(await query(local.dbUrl, "select status, details from public.tasks where client_id = $1 and kind = 'licence'", [id])).toEqual([{ status: "upcoming", details: { label: "FSSAI licence" } }]);
  await row.getByRole("button", { name: /Mark .* renewed/ }).click();
  await expect(owner.getByRole("row").filter({ hasText: `Mehta Traders ${tag}` })).toContainText("Renewed");

  // The list filters by a tag; Add tags from the ticked bar keeps what each client had.
  await owner.goto(`/app/clients?q=${tag}&tag=Priority`);
  await expect(owner.getByRole("link", { name: `Mehta Traders ${tag}`, exact: true })).toBeVisible();
  await expect(owner.getByRole("link", { name: `Mehta Exports ${tag}`, exact: true })).toHaveCount(0);
  await owner.goto(`/app/clients?q=${tag}`);
  for (const name of [`Mehta Traders ${tag}`, `Mehta Exports ${tag}`]) await owner.getByLabel(`Choose ${name}`, { exact: true }).check();
  await owner.getByRole("link", { name: "Add tags" }).click();
  const tagging = owner.getByRole("dialog", { name: "Add tags" });
  await tagging.getByLabel("Tags, separated by commas").fill("Audit 2027, Mumbai");
  await tagging.getByRole("button", { name: "Add tags to 2 clients" }).click();
  await expect(owner.getByText(/^Tags added to 2 clients\./)).toBeVisible();
  expect((await query(local.dbUrl, "select name, tags from public.clients where id = any($1) order by name", [[id, clients["Mehta Exports"]]])).map((client) => client.tags)).toEqual([["Audit 2027", "Mumbai"], ["Priority", "Audit 2027", "Mumbai"]]);

  // The export holds every client under the template's headings, the formula name and the phone
  // behind an apostrophe; the import reads it back as data, and the export is logged.
  const download = owner.waitForEvent("download");
  await owner.getByRole("link", { name: "Export to Excel" }).click();
  const file = await readFile((await (await download).path())!);
  const sheet = readSheet(file, "clients.xlsx", { rows: 100, columns: 20 });
  expect(sheet[0]).toEqual(["Name", "Client type", "PAN", "GSTIN", "Email", "TAN", "GST returns", "TDS returns", "Income tax return", "Phone", "Looked after by", "Tags"]);
  const by = (name: string) => sheet.find((cells) => cells[0].includes(name))!;
  expect(by(`Mehta Traders ${tag}`)).toEqual([`Mehta Traders ${tag}`, "Business", "", "", "", "", "", "", "", "", "", "Priority, Audit 2027, Mumbai"]);
  expect(by(`Mehta Exports ${tag}`)[9]).toBe("'+919876543210");
  expect(by("HYPERLINK")[0]).toBe(`'=HYPERLINK("https://x.test") ${tag}`);
  expect(sheet.flat().some((cell) => /^[=+\-@]/.test(cell))).toBe(false);
  expect(await logged("clients.exported")).toEqual([firm.firmId]);
  await owner.goto("/app/clients?panel=import");
  await owner.getByLabel("CSV or Excel file").setInputFiles({ name: "export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await owner.getByRole("button", { name: "Check the file" }).click();
  await expect(owner.getByText("3 ready to import.")).toBeVisible();
  const check = owner.locator("section[aria-labelledby=import]").getByRole("table").first();
  await expect(check).toContainText(`=HYPERLINK("https://x.test") ${tag}`);
  await expect(check).not.toContainText("'=HYPERLINK");
  await expect(check).toContainText("+919876543210");
  await query(local.dbUrl, "delete from public.clients where id = $1", [formula]);
});

// A to-do on a client: on Today for its person, or the owner when it names nobody; its person
// and those who may change the client mark it done, and Undo opens it again.
test("a to-do on a client is on its person's Today, and its person and the owner mark it done and undo it", async ({ browser }) => {
  const id = clients["Mehta Exports"];
  const theirs = `Call about rent receipts ${tag}`;
  const ownerOnly = `Check the bank statement ${tag}`;
  await owner.goto(`/app/clients/${id}`);
  const card = owner.locator("section").filter({ has: owner.locator("h2#todos") });
  const add = owner.locator(".todo-add");
  for (const [words, person] of [[theirs, staffId], [ownerOnly, ""]]) {
    await add.locator("summary").click();
    await add.getByLabel("To-do", { exact: true }).fill(words);
    await add.getByRole("combobox", { name: "For", exact: true }).selectOption(person);
    await add.getByRole("button", { name: "Save to-do" }).click();
    await expect(card.getByRole("listitem").filter({ hasText: words })).toContainText("Today, for");
  }
  expect(await logged("todo.added")).toHaveLength(2);
  const row = (page: Page, words: string) => page.getByRole("listitem").filter({ hasText: words });
  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, staffEmail, staffKey);
  await expect(row(staff, theirs)).toContainText(`Mehta Exports ${tag}`);
  await expect(row(staff, ownerOnly)).toHaveCount(0);
  // Its own person marks it done and undoes it, whatever their role.
  await row(staff, theirs).getByRole("button", { name: `Done: ${theirs}` }).click();
  await expect(row(staff, theirs)).toHaveCount(0);
  await staff.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(row(staff, theirs)).toBeVisible();
  await owner.goto("/app");
  await expect(row(owner, ownerOnly)).toBeVisible();
  await row(owner, theirs).getByRole("button", { name: `Done: ${theirs}` }).click();
  await expect(owner.getByRole("status").filter({ hasText: `Done: ${theirs}.` })).toBeVisible();
  await expect(row(owner, theirs)).toHaveCount(0);
  await owner.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(row(owner, theirs)).toBeVisible();
  await owner.goto(`/app/clients/${id}`);
  await card.getByRole("button", { name: `Done: ${ownerOnly}` }).click();
  await expect(card.getByRole("listitem").filter({ hasText: ownerOnly })).toContainText("Done");
  await staff.context().close();
});
