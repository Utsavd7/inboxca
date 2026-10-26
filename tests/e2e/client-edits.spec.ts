import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
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
const contactEmail = `contact-${tag}@patel.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staffId = "";
const clients: Record<string, string> = {};
const logged = async (action: string) => (await query(local.dbUrl, "select entity_id from public.activity_log where firm_id = $1 and action = $2", [firm.firmId, action])).map((row) => row.entity_id);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Edits Firm ${tag}`, ownerEmail, ownerKey);
  staffId = await addPerson(firm.firmId, staffEmail, "staff", appKey());
  for (const name of ["Mehta Traders", "Mehta Exports"])
    [{ id: clients[name] }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `${name} ${tag}`]);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
});
test.afterAll(() => firm.remove(staffEmail));

test("a number added by mistake is removed from the client", async () => {
  await owner.goto(`/app/clients/${clients["Mehta Traders"]}`);
  await owner.getByRole("link", { name: "Change numbers" }).click();
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

test("a contact is taken off one client and still acts for the other", async () => {
  for (const name of ["Mehta Traders", "Mehta Exports"]) {
    await owner.goto(`/app/clients/${clients[name]}`);
    await owner.getByRole("link", { name: "Change contacts" }).click();
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
