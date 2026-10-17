import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { emailStep, localSupabase, seedFirm, totp } from "./local-supabase";

// Adding and finding clients, with numbers encrypted by the firm's key. Skipped when local
// Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ownerEmail = `clients-${randomUUID().slice(0, 8)}@example.test`;
const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Client Test Firm", ownerEmail, key);
  owner = await (await browser.newContext()).newPage();
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(key));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);
});
test.afterAll(() => firm.remove());

test("a client added with only a GSTIN gets its PAN too, and opens with both", async () => {
  await owner.getByRole("link", { name: "Clients" }).click();
  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles");
  await owner.getByLabel("Kind", { exact: true }).selectOption("business");
  await owner.getByLabel("GSTIN", { exact: true }).fill("27aapfu0939f1zv");
  await owner.getByLabel("Email", { exact: true }).fill("Accounts@Patel.example");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Patel Textiles");
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("accounts@patel.example");
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "PAN" })).toContainText("AAPFU0939F");
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "GSTIN" })).toContainText("27AAPFU0939F1ZV");
});

test("services on a client's GSTIN give it its due dates", async () => {
  const gstin = owner.locator("section[aria-labelledby=services]").getByRole("listitem").filter({ hasText: "GSTIN" });
  await gstin.getByLabel("GSTR-1 (monthly)").check();
  await gstin.getByLabel("GSTR-3B (monthly)").check();
  await gstin.getByRole("button", { name: "Save services" }).click();
  const due = owner.locator("section[aria-labelledby=due]").getByRole("listitem");
  await expect(due.filter({ hasText: "GSTR-3B (monthly)" }).first()).toContainText("*");
  await expect(owner.locator("section[aria-labelledby=due]")).toContainText("not yet confirmed by a CA");
  await expect(due).toHaveCount(12);
});

test("a return is marked filed with its acknowledgement on the calendar", async () => {
  await owner.getByRole("link", { name: "Calendar" }).click();
  const row = owner.getByRole("row").filter({ hasText: "GSTR-3B (monthly)" }).first();
  await row.getByRole("checkbox").check();
  await row.getByLabel(/Acknowledgement for/).fill("AA240925123456X");
  await owner.getByRole("button", { name: "Mark chosen as filed" }).click();
  await owner.getByLabel("Show").selectOption({ label: "Filed in the last 30 days" });
  await owner.getByRole("button", { name: "Show", exact: true }).click();
  await expect(owner.getByRole("row").filter({ hasText: "Patel Textiles" })).toContainText("AA240925123456X");
});

test("Home shows what needs the owner today and the next setup step", async () => {
  await owner.getByRole("link", { name: "Home" }).click();
  await expect(owner.getByRole("link", { name: /returns due in 7 days/ })).toBeVisible();
  const start = owner.locator("section[aria-labelledby=start]");
  await expect(start.getByRole("listitem").filter({ hasText: "Add your clients" }).getByLabel("Done")).toBeVisible();
  await expect(start.getByRole("link", { name: "Connect email" })).toHaveAttribute("href", "/app/settings#mailbox");
});

test("search finds a client by name, email or whole PAN, and the same PAN is refused twice", async () => {
  await owner.goto("/app/clients");
  for (const search of ["patel", "aapfu0939f", "ACCOUNTS@patel.example"]) {
    await owner.getByLabel("Find by name, email, PAN or GSTIN").fill(search);
    await owner.getByRole("button", { name: "Find" }).click();
    await expect(owner.getByRole("link", { name: "Patel Textiles" })).toBeVisible();
  }
  await owner.getByLabel("Name", { exact: true }).fill("Copy");
  await owner.getByLabel("PAN", { exact: true }).fill("AAPFU0939F");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already in your firm" })).toBeVisible();
  await owner.getByLabel("GSTIN", { exact: true }).fill("27AAPFU0939F1ZW");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "GSTIN is not valid" })).toBeVisible();
});

test("a client's page adds and checks numbers, renames, archives and restores", async () => {
  await owner.goto("/app/clients");
  await owner.getByRole("link", { name: "Patel Textiles" }).click();
  await owner.getByLabel("Number", { exact: true }).selectOption("gstin");
  await owner.getByLabel("Value").fill("29AAGCB7383J1Z4"); // a valid GSTIN with another PAN
  await owner.getByRole("button", { name: "Add number" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "holds a different PAN" })).toBeVisible();
  await owner.getByLabel("Number", { exact: true }).selectOption("tan");
  await owner.getByLabel("Value").fill("muma12345b");
  await owner.getByRole("button", { name: "Add number" }).click();
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "TAN" })).toContainText("MUMA12345B");

  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles Pvt Ltd");
  await owner.getByRole("button", { name: "Save details" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Patel Textiles Pvt Ltd");
  await owner.getByRole("button", { name: "Archive client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Archived");

  await owner.goto("/app/clients");
  await expect(owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" })).toHaveCount(0);
  await owner.getByRole("link", { name: "Show archived clients" }).click();
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByRole("button", { name: "Restore client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).not.toContainText("Archived");
});

test("importing 500 clients with emails adds them all and reports every bad row", async () => {
  test.setTimeout(120_000);
  // 500 good rows with distinct, valid PANs, then five rows with a problem each.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pan = (n: number) => `QRS${letters[Math.floor(n / 26) % 26]}${letters[n % 26]}${String(n).padStart(4, "0")}Z`;
  const lines = ["Client name,Constitution,PAN,GST No,Email ID"];
  for (let n = 0; n < 500; n++) lines.push(`Client ${n},${n % 2 ? "Proprietor" : "Individual"},${pan(n)},,client${n}@example.test`);
  lines.push("Bad PAN,Individual,ABC123,,", "Odd kind,Martian,QRSZZ9998Z,,", `Repeat,Individual,${pan(7)},,`, ",Individual,QRSZZ9997Z,,", "Patel again,Business,,27AAPFU0939F1ZV,", "Bad email,Individual,QRSZZ9996Z,,nobody@");

  await owner.goto("/app/clients");
  await owner.getByLabel("CSV or Excel file").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await owner.getByRole("button", { name: "Check the file" }).click();
  await expect(owner.getByText("500 ready to import, 6 with a problem and left out.")).toBeVisible({ timeout: 30_000 });
  const problems = owner.getByRole("table");
  for (const text of ["PAN is not valid", "not a kind InboxCA knows", "on an earlier row", "Enter the client's name", "already in your firm", "email address is not valid"])
    await expect(problems).toContainText(text);

  await owner.getByRole("button", { name: "Import 500 clients" }).click();
  await expect(owner.getByText("Imported 500 clients.")).toBeVisible({ timeout: 30_000 });
  await owner.goto(`/app/clients?q=${pan(321).toLowerCase()}`);
  await expect(owner.getByRole("link", { name: "Client 321" })).toBeVisible();
  await owner.goto("/app/clients?q=client42@example.test");
  await expect(owner.getByRole("link", { name: "Client 42", exact: true })).toBeVisible();
});

test("clients in one group are listed together", async () => {
  await owner.goto("/app/clients?q=patel");
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByLabel("Or a new group").fill("Patel family");
  await owner.getByRole("button", { name: "Save details" }).click();
  await expect(owner.getByRole("link", { name: "Group: Patel family" })).toBeVisible();

  await owner.goto("/app/clients?q=Client 321");
  await owner.getByRole("link", { name: "Client 321" }).click();
  await owner.getByLabel("Group", { exact: true }).selectOption({ label: "Patel family" });
  await owner.getByRole("button", { name: "Save details" }).click();
  await owner.getByRole("link", { name: "Group: Patel family" }).click();
  await expect(owner.getByRole("heading", { name: "Patel family: 2 clients" })).toBeVisible();
  await expect(owner.getByRole("link", { name: "Client 321" })).toBeVisible();
});

test("a client is served from a branch, and the list filters by branch", async () => {
  await owner.goto("/app/people");
  await owner.getByLabel("New branch").fill("Surat");
  await owner.getByRole("button", { name: "Add branch" }).click();
  await expect(owner.locator("section[aria-labelledby=branches]").getByRole("listitem")).toContainText("Surat");
  await owner.goto("/app/clients?q=Client 42");
  await owner.getByRole("link", { name: "Client 42", exact: true }).click();
  await owner.locator("section[aria-labelledby=details]").getByLabel("Branch").selectOption({ label: "Surat" });
  await owner.getByRole("button", { name: "Save details" }).click();
  await owner.getByRole("link", { name: "Branch: Surat" }).click();
  await expect(owner.getByRole("heading", { name: "Surat: 1 client" })).toBeVisible();
});

test("a contact person can act for several clients, with what they may receive", async () => {
  await owner.goto("/app/clients?q=patel");
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByLabel("Contact's name").fill("Ramesh Patel");
  await owner.getByLabel("Contact's email").fill("ramesh@patel.example");
  await owner.getByLabel("Who they are, if known").fill("Director");
  await owner.getByRole("button", { name: "Add contact" }).click();
  const row = owner.getByRole("listitem").filter({ hasText: "Ramesh Patel" });
  await expect(row).toContainText("ramesh@patel.example, Director");
  await row.getByLabel("Receives documents").check();
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await owner.reload();
  await expect(owner.getByRole("listitem").filter({ hasText: "Ramesh Patel" }).getByLabel("Receives documents")).toBeChecked();

  // The same email on another client links the same person.
  await owner.goto("/app/clients?q=Client 321");
  await owner.getByRole("link", { name: "Client 321" }).click();
  await owner.getByLabel("Contact's name").fill("R Patel");
  await owner.getByLabel("Contact's email").fill("RAMESH@patel.example");
  await owner.getByRole("button", { name: "Add contact" }).click();
  await expect(owner.getByRole("listitem").filter({ hasText: "ramesh@patel.example" })).toContainText("Ramesh Patel");
});
