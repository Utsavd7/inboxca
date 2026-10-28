import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { addDays, dueLabel, todayInIndia } from "@/src/lib/calendar";
import { exampleClient } from "@/src/lib/clients";
import { xlsxEntries } from "@/src/lib/sheet";
import { craft } from "../fixtures/zip";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

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
  await owner.getByRole("link", { name: "Clients", exact: true }).click();
  // A missing name is shown under the Name field, which is marked.
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(owner.locator("#client-name + .field-error")).toHaveText("Enter the client's name.");
  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles");
  await owner.getByLabel("Client type", { exact: true }).selectOption("business");
  await owner.getByLabel("GSTIN", { exact: true }).fill("27aapfu0939f1zv");
  await owner.getByLabel("Email", { exact: true }).fill("Accounts@Patel.example");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText("Patel Textiles");
  await expect(owner.locator("section[aria-labelledby=details-card]")).toContainText("accounts@patel.example");
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "PAN" })).toContainText("AAPFU0939F");
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "GSTIN" })).toContainText("27AAPFU0939F1ZV");
});

test("services on a client's GSTIN give it its due dates", async () => {
  await owner.getByRole("link", { name: "Change services" }).click();
  // A plain business is offered the 31 August ITR on its PAN, not the 31 July one or a tax audit.
  const pan = owner.getByRole("dialog", { name: "Services" }).getByRole("listitem").filter({ hasText: "PAN" });
  await expect(pan.getByLabel("ITR (business, no audit)")).toBeVisible();
  await expect(pan.getByLabel("ITR (no business, no audit)")).toHaveCount(0);
  await expect(pan.getByLabel("Tax audit report")).toHaveCount(0);
  const gstin = owner.getByRole("dialog", { name: "Services" }).getByRole("listitem").filter({ hasText: "GSTIN" });
  await gstin.getByLabel("GSTR-1 (monthly)").check();
  await gstin.getByLabel("GSTR-3B (monthly)").check();
  // Wait for the save: it is what adds the due dates.
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("dialog", { name: "Services" }).getByRole("button", { name: "Save services" }).click()]);
  await owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: /^Returns/ }).click();
  const due = owner.locator("section[aria-labelledby=due] li");
  await expect(due.filter({ hasText: "GSTR-3B (monthly)" }).first()).toContainText("*");
  await expect(owner.locator(".client-pane")).toContainText("InboxCA has not yet checked");
  const [{n}]=await query(local.dbUrl,"select count(*)::int n from public.tasks t join public.clients c on c.id=t.client_id where c.firm_id=$1 and c.name='Patel Textiles' and t.kind='compliance' and t.status<>'filed'",[firm.firmId]);
  expect(n).toBeGreaterThan(12);
  await expect(due).toHaveCount(n);
});

// The bulk buttons each carry their own intent: "in progress" must not reopen the return.
test("returns chosen on the calendar are marked in progress", async () => {
  await owner.goto("/app/calendar");
  const box = owner.getByRole("row").filter({ hasText: "GSTR-1 (monthly)" }).first().getByRole("checkbox");
  const id = await box.getAttribute("value");
  await box.check();
  await owner.getByRole("button", { name: "Mark chosen as in progress" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "marked in progress" })).toBeVisible();
  const [{ status }] = await query(local.dbUrl, "select status from public.tasks where id = $1", [id]);
  expect(status).toBe("in_progress");
});

test("a return is marked filed with its acknowledgement on the calendar", async () => {
  await owner.goto("/app/calendar");
  await expect(owner.getByRole("navigation", { name: "Days" }).getByRole("link")).toHaveCount(31);
  const row = owner.getByRole("row").filter({ hasText: "GSTR-3B (monthly)" }).first();
  await row.getByRole("checkbox").check();
  await owner.getByRole("button", { name: "Mark chosen as filed" }).click();
  const panel = owner.getByRole("dialog", { name: "Mark filed" });
  await panel.getByLabel(/ARN for/).fill("AA240925123456X");
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "1 return marked filed." })).toBeVisible();
  const filed = owner.getByRole("link", { name: /^Filed in the last 30 days/ });
  await expect(filed).toContainText("1");
  await filed.click();
  await expect(filed).toHaveAttribute("aria-current", "page");
  await expect(owner.getByRole("row").filter({ hasText: "Patel Textiles" })).toContainText("AA240925123456X");
});

test("Today shows what needs the owner today and the next setup step", async () => {
  // One return falls due today and two are 4 days late: the client's late returns are one row.
  await query(local.dbUrl,"update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date where id=(select id from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and code='GSTR3B_M' order by due_on desc limit 1)",[firm.firmId]);
  await query(local.dbUrl,"update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date-4 where id in (select id from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and code='GSTR1_M' order by due_on desc limit 2)",[firm.firmId]);
  const [{n}]=await query(local.dbUrl,"select count(*)::int n from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and due_on<(now() at time zone 'Asia/Kolkata')::date",[firm.firmId]);
  await owner.getByRole("link", { name: "Today", exact: true }).click();
  await expect(owner.locator(".page-head")).toContainText(/\d+ things? needs? you\./);
  // One row for the client's late returns (the return due today has its own row).
  const late = owner.locator("section[aria-labelledby=t-list]").getByRole("listitem").filter({ hasText: "Patel Textiles" }).filter({ hasText: /\d+ days? late/ });
  await expect(late).toHaveCount(1);
  await expect(late).toContainText(`and ${n-1} more late return`);
  await expect(owner.getByRole("region", { name: "This week" }).getByRole("link", { name: /^Returns this month/ })).toHaveAttribute("href", "/app/calendar?view=month");
  await late.getByRole("link", { name: "See returns: Patel Textiles" }).click();
  await expect(owner).toHaveURL(/\/app\/clients\/[^/]+\?tab=due$/,{timeout:15_000});
  await owner.getByRole("link", { name: "Today", exact: true }).click();
  // Setup is one line until every step is done, its next step a button.
  const start = owner.getByRole("region", { name: "Setup" });
  await expect(start).toContainText(/Setup: [1-4] of 5 done\./);
  await expect(start.getByRole("link", { name: "Connect the firm's email" })).toHaveAttribute("href", "/app/settings#mailbox");
  // With returns late, the Calendar opens on them; a link to another view still works.
  await owner.goto("/app/calendar");
  const views = owner.getByRole("navigation", { name: "Show" });
  await expect(views.getByRole("link", { name: /^Late/ })).toHaveAttribute("aria-current", "page");
  await expect(owner.getByRole("row").filter({ hasText: "GSTR-1 (monthly)" }).first()).toContainText("Late");
  await owner.goto("/app/calendar?view=month");
  await expect(views.getByRole("link", { name: /^Due in 30 days/ })).toHaveAttribute("aria-current", "page");
});

test("late returns: the week's numbers, a preview before reminding, Mark filed with an undo and Assign to me", async () => {
  const [{ n }] = await query(local.dbUrl, "select count(*)::int n from public.tasks t join public.clients c on c.id=t.client_id where c.firm_id=$1 and c.name='Patel Textiles' and t.kind='compliance' and t.status<>'filed' and t.due_on<(now() at time zone 'Asia/Kolkata')::date", [firm.firmId]);
  const [{ id: anand }] = await query(local.dbUrl, "insert into public.clients(firm_id,name,kind) values ($1,'Anand Late','individual') returning id", [firm.firmId]);
  await query(local.dbUrl, "insert into public.tasks(firm_id,client_id,kind,code,period_key,due_on) values ($1,$2,'compliance','ITR_NA','2026',(now() at time zone 'Asia/Kolkata')::date-2)", [firm.firmId, anand]);
  await owner.goto("/app");
  // This week's Late opens the late returns in the full list.
  const week = owner.getByRole("region", { name: "This week" });
  await expect(week.getByRole("link", { name: /^Late 2 clients have a late return/ })).toHaveAttribute("href", "/app/work?show=late");
  await week.getByRole("link", { name: /^Late / }).click();
  await expect(owner).toHaveURL(/\/app\/work\?show=late$/);
  // Remind all late clients shows who gets what first; with no firm email nothing can go.
  await owner.getByRole("link", { name: "Remind all late clients" }).click();
  const preview = owner.getByRole("dialog", { name: "Remind 2 late clients" });
  await expect(preview.getByRole("listitem").filter({ hasText: "Patel Textiles" })).toContainText("Will be emailed");
  await expect(preview.getByRole("listitem").filter({ hasText: "Anand Late" })).toContainText("No email address");
  await expect(preview.getByRole("alert")).toContainText("Connect the firm's email");
  await expect(preview.getByRole("button", { name: "Send 1 reminder" })).toBeDisabled();
  await preview.getByRole("link", { name: "Cancel" }).click();
  await expect(preview).toHaveCount(0);
  // Mark filed opens the client's late returns; Undo puts them back.
  const late = owner.locator("section[aria-labelledby=w-list]");
  await late.getByRole("listitem").filter({ hasText: "Patel Textiles" }).hover();
  await late.getByRole("link", { name: "Mark filed for Patel Textiles" }).click();
  const panel = owner.getByRole("dialog", { name: `Mark ${n} returns filed` });
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: `${n} returns marked filed.` })).toBeVisible();
  await owner.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(owner.getByRole("status").filter({ hasText: `${n} returns marked not filed.` })).toBeVisible();
  await expect(late.getByRole("listitem").filter({ hasText: "Patel Textiles" })).toBeVisible();
  // A late client nobody looks after can be taken on in one click (once the redraw after Undo
  // has faded its earlier row out).
  await expect(late.getByRole("listitem").filter({ hasText: "Anand Late" })).toHaveCount(1);
  await late.getByRole("listitem").filter({ hasText: "Anand Late" }).hover();
  await late.getByRole("button", { name: "Assign Anand Late to me" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Assigned to you." })).toBeVisible();
  await expect(late.getByRole("button", { name: "Assign Anand Late to me" })).toHaveCount(0);
  expect((await query(local.dbUrl, "select user_id from public.client_assignments where client_id=$1", [anand]))[0].user_id).toBe(firm.ownerId);
  await query(local.dbUrl, "delete from public.clients where id=$1", [anand]);
});

test("late clients lead the list, and a client's return is marked filed from its Returns tab with an undo", async () => {
  const [{ id: patel }] = await query(local.dbUrl, "select id from public.clients where firm_id=$1 and name='Patel Textiles'", [firm.firmId]);
  const [{ id: other }] = await query(local.dbUrl, "insert into public.clients(firm_id,name,kind) values ($1,'Anand Dairy','individual') returning id", [firm.firmId]);
  await query(local.dbUrl, "insert into public.requests(firm_id,client_id,kind,entity_type,entity_id,expires_at) values ($1,$2,'documents','client',gen_random_uuid(),now()+interval '7 days')", [firm.firmId, patel]);
  const [{ n }] = await query(local.dbUrl, "select count(*)::int n from public.tasks where client_id=$1 and kind='compliance' and status<>'filed' and due_on<(now() at time zone 'Asia/Kolkata')::date", [patel]);
  await owner.goto("/app/clients");
  const rows = owner.locator(".clients-table tbody tr");
  await expect(rows.first()).toContainText("Patel Textiles");
  await expect(rows.first().locator(".badge")).toHaveText([`Late: ${n} returns`, "Missing papers"]);
  // The late return over the day it fell late, the pills one over the other.
  await expect(rows.first().locator(".clients-next")).toContainText(/^GSTR-1 \(monthly\) \w{3} \d{4}Late since \d{1,2} \w{3}( \d{4})?$/);
  await expect(rows.nth(1)).toContainText("Anand Dairy");
  // That request has no items list: Today, its count of clients waiting for papers, and the client page still open.
  await owner.goto("/app");
  await expect(owner.getByRole("region", { name: "This week" }).getByRole("link", { name: /^Waiting for papers [1-9]/ })).toHaveAttribute("href", "/app/clients?show=missing");
  await owner.goto(`/app/clients/${patel}`);
  await expect(owner.locator(".page-head")).toContainText("Patel Textiles");
  await query(local.dbUrl, "delete from public.clients where id=$1", [other]);
  await query(local.dbUrl, "delete from public.requests where client_id=$1 and kind='documents'", [patel]);

  // Mark filed only for returns late or due within 30 days.
  await owner.goto(`/app/clients/${patel}?tab=returns`);
  const due = owner.locator("section[aria-labelledby=due] li");
  const [{ soon }] = await query(local.dbUrl, "select count(*)::int soon from public.tasks where client_id=$1 and kind='compliance' and status<>'filed' and due_on<=(now() at time zone 'Asia/Kolkata')::date+30", [patel]);
  await expect(due.getByRole("link", { name: /^Mark .* filed$/ })).toHaveCount(soon);
  await expect(due.last().getByRole("link")).toHaveCount(0);
  const late = due.filter({ has: owner.locator(".badge", { hasText: "Late" }) }).first();
  const title = (await late.locator(".grow > strong").textContent())!;
  await late.getByRole("link", { name: `Mark ${title} filed` }).click();
  const panel = owner.getByRole("dialog", { name: "Mark filed" });
  await expect(panel.getByLabel("Filed on")).toHaveValue(todayInIndia());
  await panel.getByLabel(/ARN for/).fill("AB0000000000001");
  await panel.getByRole("button", { name: "Mark filed" }).click();
  const toast = owner.getByRole("status").filter({ hasText: `${title} marked filed.` });
  await expect(toast).toBeVisible();
  await expect(due.filter({ hasText: title })).toHaveCount(0);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(owner.getByRole("status").filter({ hasText: `${title} marked not filed.` })).toBeVisible();
  await expect(due.filter({ hasText: title })).toHaveCount(1);

  // Filed returns say when, by whom and the ARN, and can be put back.
  await due.filter({ hasText: title }).getByRole("link", { name: `Mark ${title} filed` }).click();
  const filedOn = addDays(todayInIndia(), -1);
  await panel.getByLabel("Filed on").fill(filedOn);
  await panel.getByLabel(/ARN for/).fill("AB0000000000001");
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect(owner.getByRole("status").filter({ hasText: `${title} marked filed.` })).toBeVisible();
  await owner.getByRole("link", { name: "Show filed returns" }).click();
  const filed = due.filter({ hasText: title });
  await expect(filed).toContainText(`Filed ${dueLabel(filedOn)} by Clients, ARN AB0000000000001`);
  await filed.getByRole("button", { name: "Not filed after all" }).click();
  await expect(owner.getByRole("status").filter({ hasText: `${title} marked not filed.` })).toBeVisible();
  await expect(due.filter({ hasText: title })).toHaveCount(0);
});

test("search finds a client by name, email or whole PAN, and the same PAN is refused twice", async () => {
  await owner.goto("/app/clients");
  for (const search of ["patel", "aapfu0939f", "ACCOUNTS@patel.example"]) {
    await owner.getByLabel("Find by name, email, PAN or GSTIN").fill(search);
    await owner.getByRole("button", { name: "Find" }).click();
    await expect(owner.getByRole("link", { name: "Patel Textiles" })).toBeVisible();
  }
  await owner.getByRole("link", { name: "New client" }).click();
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
  await owner.getByRole("link", { name: "Change numbers" }).click();
  await owner.getByLabel("Type", { exact: true }).selectOption("gstin");
  await owner.getByLabel("Number", { exact: true }).fill("29AAGCB7383J1Z4"); // a valid GSTIN with another PAN
  await owner.getByRole("button", { name: "Add number" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "holds a different PAN" })).toBeVisible();
  await owner.getByLabel("Type", { exact: true }).selectOption("tan");
  await owner.getByLabel("Number", { exact: true }).fill("muma12345b");
  await owner.getByRole("button", { name: "Add number" }).click();
  await expect(owner.locator("section[aria-labelledby=numbers]").getByRole("listitem").filter({ hasText: "TAN" })).toContainText("MUMA12345B");
  await owner.getByRole("dialog").getByRole("link", { name: "Close" }).click();

  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles Pvt Ltd");
  await owner.getByRole("button", { name: "Save details" }).click();
  await expect(owner.locator(".page-head")).toContainText("Patel Textiles Pvt Ltd");
  // Saving closes the panel; archiving is in the same panel.
  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.getByRole("button", { name: "Archive client" }).click();
  await expect(owner.locator(".page-head")).toContainText("Archived");

  await owner.goto("/app/clients");
  await expect(owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" })).toHaveCount(0);
  await owner.getByRole("link", { name: "Show archived clients" }).click();
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.getByRole("button", { name: "Restore client" }).click();
  await expect(owner.locator(".page-head")).not.toContainText("Archived");
});

test("importing 500 clients with emails adds them all and reports every bad row", async () => {
  test.setTimeout(120_000);
  // 500 good rows with distinct, valid PANs, then five rows with a problem each.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pan = (n: number) => `QRS${letters[Math.floor(n / 26) % 26]}${letters[n % 26]}${String(n).padStart(4, "0")}Z`;
  const lines = ["Client name,Constitution,PAN,GST No,Email ID"];
  for (let n = 0; n < 500; n++) lines.push(`Client ${n},${n % 2 ? "Proprietor" : "Individual"},${pan(n)},,client${n}@example.test`);
  lines.push("Bad PAN,Individual,ABC123,,", "Odd kind,Martian,QRSZZ9998Z,,", `Repeat,Individual,${pan(7)},,`, ",Individual,QRSZZ9997Z,,", "Patel again,Business,,27AAPFU0939F1ZV,", "Bad email,Individual,QRSZZ9996Z,,nobody@");

  await owner.goto("/app/clients?panel=import");
  await owner.getByLabel("CSV or Excel file").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await owner.getByRole("button", { name: "Check the file" }).click();
  await expect(owner.getByText("500 ready to import, 6 with a problem and left out.")).toBeVisible({ timeout: 30_000 });
  // The first rows show as they will be saved, the kind read from the sheet's own words.
  const first = owner.locator("section[aria-labelledby=import]").getByRole("table").first();
  await expect(first.locator("tbody tr")).toHaveCount(5);
  await expect(first.locator("tbody tr").nth(1)).toContainText("Client 1Business");
  const problems = owner.locator("section[aria-labelledby=import]").getByRole("table").last();
  for (const text of ["PAN is not valid", "not a client type InboxCA knows", "on an earlier row", "Enter the client's name", "already in your firm", "email address is not valid"])
    await expect(problems).toContainText(text);

  await owner.getByRole("button", { name: "Import 500 clients" }).click();
  await expect(owner.getByText("Imported 500 clients.")).toBeVisible({ timeout: 30_000 });
  await owner.goto(`/app/clients?q=${pan(321).toLowerCase()}`);
  await expect(owner.getByRole("link", { name: "Client 321" })).toBeVisible();
  await owner.goto("/app/clients?q=client42@example.test");
  await expect(owner.getByRole("link", { name: "Client 42", exact: true })).toBeVisible();
});

test("the client list template, filled in, and a Tally export both import", async () => {
  const tag = randomUUID().slice(0, 6), panel = owner.locator("section[aria-labelledby=import]");
  await owner.goto("/app/clients?panel=import");
  const download = owner.waitForEvent("download");
  await owner.getByRole("link", { name: "Download the client list template" }).click();
  const template = xlsxEntries(await readFile((await (await download).path())!));
  // Two clients typed under the template's headings, then an empty row and the example row
  // copied from How to fill, which are left out.
  const typed = [[`Template Mehta ${tag}`, "Company", "TMPLA1234B"], [`Template Joshi ${tag}`, "", "", "", `joshi-${tag}@example.test`], [], Object.values(exampleClient)];
  const rows = typed.map((cells, at) => `<row r="${at + 2}">${cells.map((text, column) => text && `<c r="${"ABCDE"[column]}${at + 2}" t="inlineStr"><is><t>${text}</t></is></c>`).join("")}</row>`).join("");
  const filled = craft([...template].map(([name, read]) => ({ name, bytes: name === "xl/worksheets/sheet1.xml" ? Buffer.from(read().toString().replace("</sheetData>", `${rows}</sheetData>`)) : read() })));
  await owner.getByLabel("CSV or Excel file").setInputFiles({ name: "clients.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: filled });
  await owner.getByRole("button", { name: "Check the file" }).click();
  await expect(owner.getByText("2 ready to import.")).toBeVisible();
  await expect(panel.getByRole("table")).toContainText(`Template Mehta ${tag}Company`);
  await owner.getByRole("button", { name: "Import 2 clients" }).click();
  await expect(owner.getByText("Imported 2 clients.")).toBeVisible();

  // Tally's column names, below the title rows its export puts on top.
  const tally = ["Sharma & Co", "List of Ledgers", "", "Name of Party,GSTIN/UIN,PAN/IT No.,E-mail,Constitution", `Tally Kapoor ${tag},,TLYAB1234C,kapoor-${tag}@example.test,Limited Liability Partnership`];
  await owner.goto("/app/clients?panel=import");
  await owner.getByLabel("CSV or Excel file").setInputFiles({ name: "tally.csv", mimeType: "text/csv", buffer: Buffer.from(tally.join("\n")) });
  await owner.getByRole("button", { name: "Check the file" }).click();
  await expect(owner.getByText("1 ready to import.")).toBeVisible();
  await expect(panel.getByRole("table")).toContainText(`Tally Kapoor ${tag}LLPkapoor-${tag}@example.testTLYAB1234C`);
  await owner.getByRole("button", { name: "Import 1 client" }).click();
  await expect(owner.getByText("Imported 1 client.")).toBeVisible();
  await owner.goto(`/app/clients?q=${tag}`);
  for (const name of [`Template Mehta ${tag}`, `Template Joshi ${tag}`, `Tally Kapoor ${tag}`]) await expect(owner.getByRole("link", { name, exact: true })).toBeVisible();
});

test("the client list shows its true count and a second page", async () => {
  await query(
    local.dbUrl,
    "insert into public.clients (id, firm_id, name, kind) select gen_random_uuid(), $1, 'Paging Client ' || lpad(n::text, 3, '0'), 'individual' from generate_series(1, 51) n",
    [firm.firmId],
  );
  await owner.goto("/app/clients?q=Client");
  const pager = owner.getByRole("navigation", { name: "Client pages" });
  await expect(pager).toContainText("Showing 1 to 50 of 551 clients");
  await expect(pager.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/clients?q=Client&page=2");
  await pager.getByRole("link", { name: "Next" }).click();
  await expect(owner).toHaveURL(/q=Client&page=2/);
  await expect(pager).toContainText("Showing 51 to 100 of 551 clients");

  // Upload papers on Documents finds a client among many, 8 at a time.
  await owner.goto("/app/documents?view=papers&upload=1&for=Paging%20Client");
  const picker = owner.getByRole("dialog", { name: "Upload papers" });
  await expect(picker.getByRole("link", { name: /^Choose Paging Client/ })).toHaveCount(8);
  await expect(picker.getByRole("navigation", { name: "Client pages" })).toContainText("1 to 8 of 51");
  await picker.getByRole("link", { name: "Next" }).click();
  await expect(picker.getByRole("navigation", { name: "Client pages" })).toContainText("9 to 16 of 51");
  await expect(picker.getByRole("link", { name: "Choose Paging Client 009" })).toBeVisible();
});

test("each pill counts every client it shows, and late clients fill the pages before the rest", async () => {
  const tag = randomUUID().slice(0, 6);
  const like = `Count ${tag} %`;
  // 120 invented clients: the first 60 have a late return, and every second one is missing papers.
  await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) select $1, 'Count ' || $2 || ' ' || lpad(n::text, 3, '0'), 'individual' from generate_series(1, 120) n", [firm.firmId, tag]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) select firm_id, id, 'GSTR1_M', '2026-08', (now() at time zone 'Asia/Kolkata')::date - 3 from public.clients where firm_id = $1 and name like $2 and right(name, 3)::int <= 60", [firm.firmId, like]);
  await query(local.dbUrl, "insert into public.requests (firm_id, client_id, kind, entity_type, entity_id, expires_at) select firm_id, id, 'documents', 'client', gen_random_uuid(), now() + interval '7 days' from public.clients where firm_id = $1 and name like $2 and right(name, 3)::int % 2 = 0", [firm.firmId, like]);
  try {
    const name = (n: number) => `Count ${tag} ${String(n).padStart(3, "0")}`;
    const pills = owner.getByRole("navigation", { name: "Show" });
    const pager = owner.getByRole("navigation", { name: "Client pages" });
    const rows = owner.locator(".clients-table tbody tr");
    await owner.goto(`/app/clients?q=Count%20${tag}`);
    for (const pill of ["All 120", "Late 60", "Missing papers 60", "Assigned to me 0"]) await expect(pills.getByRole("link", { name: pill })).toBeVisible();
    await expect(pager).toContainText("Showing 1 to 50 of 120 clients");
    await expect(rows.filter({ hasText: "Late: 1 return" })).toHaveCount(50);
    // Page 2 ends the late clients and starts the rest, each by name.
    await pager.getByRole("link", { name: "Next" }).click();
    await expect(pager).toContainText("Showing 51 to 100 of 120 clients");
    await expect(rows.first()).toContainText(name(51));
    await expect(rows.filter({ hasText: "Late: 1 return" })).toHaveCount(10);
    await expect(rows.nth(10)).toContainText(name(61));
    await pager.getByRole("link", { name: "Next" }).click();
    await expect(pager).toContainText("Showing 101 to 120 of 120 clients");
    await expect(pager.getByRole("link", { name: "Next" })).toHaveCount(0);

    await pills.getByRole("link", { name: "Late 60" }).click();
    await expect(pager).toContainText("Showing 1 to 50 of 60 clients");
    await pager.getByRole("link", { name: "Next" }).click();
    await expect(pager).toContainText("Showing 51 to 60 of 60 clients");
    await expect(rows.last()).toContainText(name(60));
    await pills.getByRole("link", { name: "Missing papers 60" }).click();
    await expect(pager).toContainText("Showing 1 to 50 of 60 clients");
    await expect(rows.first()).toContainText(name(2));
  } finally {
    await query(local.dbUrl, "delete from public.clients where firm_id = $1 and name like $2", [firm.firmId, like]);
  }
});

test("clients in one group are listed together", async () => {
  await owner.goto("/app/clients?q=patel");
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.getByLabel("Or a new group").fill("Patel family");
  await owner.getByRole("button", { name: "Save details" }).click();
  await expect(owner.locator("section[aria-labelledby=details-card]").getByRole("link", { name: "Patel family" })).toBeVisible();

  await owner.goto("/app/clients?q=Client 321");
  await owner.getByRole("link", { name: "Client 321" }).click();
  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.getByLabel("Group", { exact: true }).selectOption({ label: "Patel family" });
  await owner.getByRole("button", { name: "Save details" }).click();
  await owner.locator("section[aria-labelledby=details-card]").getByRole("link", { name: "Patel family" }).click();
  await expect(owner.locator(".page-head")).toContainText("Patel family: 2 clients");
  await expect(owner.getByRole("link", { name: "Client 321" })).toBeVisible();
});

test("a client is served from a branch, and the list filters by branch", async () => {
  await owner.goto("/app/people?panel=groups");
  await owner.getByLabel("New branch").fill("Surat");
  await owner.getByRole("button", { name: "Add branch" }).click();
  await expect(owner.locator("section[aria-labelledby=branches]").getByRole("listitem")).toContainText("Surat");
  await owner.goto("/app/clients?q=Client 42");
  await owner.getByRole("link", { name: "Client 42", exact: true }).click();
  await owner.getByRole("link", { name: "Edit details" }).click();
  await owner.locator("section[aria-labelledby=details]").getByLabel("Branch").selectOption({ label: "Surat" });
  await owner.getByRole("button", { name: "Save details" }).click();
  await owner.locator("section[aria-labelledby=details-card]").getByRole("link", { name: "Surat" }).click();
  await expect(owner.locator(".page-head")).toContainText("Surat: 1 client.");
});

test("a contact person can act for several clients, with what they may receive", async () => {
  await owner.goto("/app/clients?q=patel");
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByRole("link", { name: "Change contacts" }).click();
  const panel = owner.getByRole("dialog", { name: "Contacts" });
  await owner.getByLabel("Contact's name").fill("Ramesh Patel");
  await owner.getByLabel("Contact's email").fill("ramesh@patel.example");
  await owner.getByLabel("Who they are, if known").fill("Director");
  await owner.getByRole("button", { name: "Add contact" }).click();
  const row = panel.getByRole("listitem").filter({ hasText: "Ramesh Patel" });
  await expect(row).toContainText("ramesh@patel.example, Director");
  await row.getByLabel("Receives papers").check();
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await owner.reload();
  await expect(panel.getByRole("listitem").filter({ hasText: "Ramesh Patel" }).getByLabel("Receives papers")).toBeChecked();

  // The same email on another client links the same person.
  await owner.goto("/app/clients?q=Client 321");
  await owner.getByRole("link", { name: "Client 321" }).click();
  await owner.getByRole("link", { name: "Change contacts" }).click();
  await owner.getByLabel("Contact's name").fill("R Patel");
  await owner.getByLabel("Contact's email").fill("RAMESH@patel.example");
  await owner.getByRole("button", { name: "Add contact" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "ramesh@patel.example" })).toContainText("Ramesh Patel");
});

test("a GSTR-2B dropped on Home is filed under the client whose GSTIN is inside it", async () => {
  await owner.goto("/app/settings");
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected");

  // An invented download in the GST portal's layout, and a JSON file that is not one.
  const gstr2b = Buffer.from(JSON.stringify({ data: { gstin: "27AAPFU0939F1ZV", rtnprd: "092026", version: "1.0", docdata: { b2b: [] } } }));
  const other = Buffer.from(JSON.stringify({ gstin: "27AAPFU0939F1ZV", note: "not from the portal" }));
  await owner.goto("/app");
  // Upload papers is the Documents page's; portal files have their own box on Today.
  await expect(owner.getByRole("link", { name: "Upload papers" })).toHaveAttribute("href", "/app/documents?upload=1");
  await owner.getByRole("link", { name: "Add portal files" }).click();
  const drop = (files: { name: string; buffer: Buffer }[]) =>
    owner.getByLabel("Add portal files").setInputFiles(files.map((file) => ({ ...file, mimeType: "application/json" })));
  await drop([
    { name: "returns.json", buffer: gstr2b },
    { name: "GSTR2B_september.json", buffer: other },
  ]);
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText("1 saved in its client's folder; 1 not saved");
  await owner.goto("/app?panel=portal");
  await drop([{ name: "again.json", buffer: gstr2b }]);
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText("1 already there");

  await owner.goto("/app/clients?q=patel");
  await owner.getByRole("link", { name: "Patel Textiles Pvt Ltd" }).click();
  await owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: /^Documents/ }).click();
  await expect(owner.locator("section[aria-labelledby=files] tbody tr")).toContainText(["Patel Textiles Pvt Ltd - GSTR-2B - Sep 2026"]);
});

// M1 acceptance: the available tabs use live records and counts, without M6 placeholders.
test("client tabs show all return pages, notices and recent activity; Today leaves out archived clients",async()=>{
  const client=randomUUID();
  await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Tabs Test Client','individual')",[client,firm.firmId]);
  await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,code,period_key,due_on) select $1,$2,'GSTR1_M','2026-09',current_date+n from generate_series(1,51) n",[firm.firmId,client]);
  await query(local.dbUrl,`insert into public.tasks(firm_id,client_id,kind,due_on,details) values ($1,$2,'notice','2026-10-22','{"authority":"income_tax","notice_type":"Invented notice","reference":"TEST-123","received_on":"2026-10-20","suggested_date":"2026-12-24"}')`,[firm.firmId,client]);
  await owner.goto(`/app/clients/${client}?tab=due`);
  await expect(owner.getByRole("navigation",{name:"Returns pages"})).toContainText("Showing 1 to 50 of 51 returns");
  await owner.getByRole("navigation",{name:"Returns pages"}).getByRole("link",{name:"Next"}).click();
  await expect(owner).toHaveURL(/tab=returns&page=2/);
  await expect(owner.locator("section[aria-labelledby=due] li")).toHaveCount(1);
  await owner.getByRole("navigation",{name:"Client",exact:true}).getByRole("link",{name:/^Notices/}).click();
  const notices=owner.locator("section[aria-labelledby=client-notices]");
  await expect(notices).toContainText("Invented notice");await expect(notices).toContainText("Check by 22 Oct 2026");
  await expect(notices).not.toContainText("24 Dec 2026");
  await owner.getByRole("navigation",{name:"Client",exact:true}).getByRole("link",{name:"Overview"}).click();
  await owner.getByRole("link",{name:"Activity",exact:true}).click();
  await expect(owner.locator("section[aria-labelledby=client-activity]")).toContainText("Client added");
  await expect(owner.getByRole("link",{name:"Figures",exact:true})).toHaveCount(0);
  await expect(owner.getByRole("link",{name:"Return files",exact:true})).toHaveCount(0);
  // The client's oldest late return leads Today's list until the client is archived.
  await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-01',current_date-300)",[firm.firmId,client]);
  await owner.goto("/app");
  const late=owner.locator("section[aria-labelledby=t-list]").getByRole("listitem").filter({hasText:"Tabs Test Client"}).filter({hasText:/days? late/});
  await expect(late).toContainText("File GSTR-1 (monthly) for Jan 2026");
  await query(local.dbUrl,"update public.clients set archived_at=now() where id=$1",[client]);
  await owner.reload();
  await expect(late).toHaveCount(0);
});

// The Notices page finds the client a page at a time, so a firm of any size can add a notice.
test("a notice is added from the Notices page by finding its client", async () => {
  await owner.goto("/app/notices");
  await owner.getByRole("link", { name: "Add a notice" }).first().click();
  const panel = owner.getByRole("dialog", { name: "Add a notice" });
  const pages = panel.getByRole("navigation", { name: "Client pages" });
  await expect(pages).toContainText(/^1 to 8 of \d/);
  await pages.getByRole("link", { name: "Next" }).click();
  await expect(pages).toContainText(/^9 to 16 of \d/);
  await panel.getByLabel("Client name").fill("patel textiles");
  await panel.getByRole("button", { name: "Find" }).click();
  await panel.getByRole("link", { name: /^Choose Patel Textiles/ }).first().click();
  await expect(panel).toContainText("Patel Textiles");
  await panel.getByLabel("Notice", { exact: true }).fill("Notice u/s 143(2)");
  await panel.getByLabel("Reference or DIN").fill("TEST-PICK-1");
  await panel.getByRole("button", { name: "Add notice" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Notice added." })).toBeVisible();
  await expect(owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: "TEST-PICK-1" })).toContainText("Patel Textiles");
});

test("the people looking after a client show by name, not email", async () => {
  const client = randomUUID();
  await query(local.dbUrl, "insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Names Test Client','individual')", [client, firm.firmId]);
  await owner.goto(`/app/clients/${client}?tab=team`);
  const panel = owner.getByRole("dialog", { name: "Looked after by" });
  await panel.getByLabel("Person or team").selectOption({ label: `Clients, ${ownerEmail}` });
  await panel.getByRole("button", { name: "Assign" }).click();
  await expect(panel.getByRole("listitem")).toContainText(["Clients"]);
  await expect(panel.getByRole("list")).not.toContainText("@");
  await owner.goto(`/app/clients/${client}`);
  await expect(owner.locator("section[aria-labelledby=team-card]")).toContainText("Clients");
  await expect(owner.locator("section[aria-labelledby=team-card]")).not.toContainText("@");
  await expect(owner.locator(".client-team")).toContainText("Looked after by Clients");
  await owner.goto("/app/clients?q=Names%20Test");
  const row = owner.getByRole("row").filter({ hasText: "Names Test Client" });
  await expect(row).toContainText("Clients");
  await expect(row).not.toContainText("@");
});

test("keys: / opens search, j and k move through a table, and Esc keeps a panel being typed in", async () => {
  // A Windows PC is shown Ctrl K, not the Mac key.
  await owner.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" }));
  await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, 'Keys Client A', 'individual'), ($1, 'Keys Client B', 'individual')", [firm.firmId]);
  await owner.goto("/app/clients?q=Keys%20Client");
  await expect(owner.locator(".rail-search kbd")).toHaveText("Ctrl K");
  await owner.keyboard.press("/");
  await expect(owner.getByRole("dialog", { name: "Search" })).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(owner.getByRole("dialog", { name: "Search" })).toHaveCount(0);
  await expect(owner.locator(".rail-search")).toBeFocused();
  const links = owner.locator(".stage-body table tbody tr").locator("a.row-link");
  // The keys work once the page has loaded its script; a press before that is simply not heard.
  await expect(async () => {
    await owner.keyboard.press("j");
    await expect(links.first()).toBeFocused({ timeout: 1000 });
  }).toPass();
  await owner.keyboard.press("j");
  await expect(links.nth(1)).toBeFocused();
  await owner.keyboard.press("k");
  await expect(links.first()).toBeFocused();

  await owner.goto("/app/clients?panel=add");
  const panel = owner.getByRole("dialog", { name: "Add a client" });
  await panel.getByLabel("Name", { exact: true }).fill("Half typed");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Email", { exact: true }).focus();
  await owner.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("the menu's New and the search palette start things, and the bell lists updates", async () => {
  await owner.goto("/app");
  await owner.getByRole("button", { name: "New", exact: true }).click();
  await expect(owner.getByRole("menuitem", { name: "New client" })).toHaveAttribute("href", "/app/clients?panel=add");
  await expect(owner.getByRole("menuitem", { name: "Add a notice" })).toHaveAttribute("href", "/app/notices?add=1");
  // Ask for papers first asks which client, in the search palette.
  await owner.getByRole("menuitem", { name: "Ask for papers" }).click();
  const search = owner.getByRole("dialog", { name: "Search" });
  await expect(search.getByRole("textbox")).toHaveAttribute("placeholder", /Ask which client for papers/);
  await search.getByRole("textbox").fill("Patel Tex");
  await search.getByRole("option", { name: /Patel Textiles/ }).click();
  await expect(owner).toHaveURL(/\/app\/clients\/[^/]+\?tab=documents&ask=1$/);
  // The palette lists the same things to start.
  await owner.keyboard.press("Control+k");
  await search.getByRole("textbox").fill("upload");
  await expect(search.getByRole("option", { name: /Upload papers/ })).toBeVisible();
  await owner.keyboard.press("Escape");
  await owner.getByRole("button", { name: /^Notifications/ }).click();
  await expect(owner.getByRole("dialog", { name: "Notifications" })).toBeVisible();
});

test("a client's row offers Write and Ask for papers; its header copies numbers and the upload link and counts down to the next return", async () => {
  const [{ id }] = await query(local.dbUrl, "select id from public.clients where firm_id=$1 and name='Patel Textiles Pvt Ltd'", [firm.firmId]);
  await owner.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copied = () => owner.evaluate(() => navigator.clipboard.readText());
  // The quick actions wait on the row until it is pointed at.
  await owner.goto("/app/clients?q=patel");
  const row = owner.getByRole("row").filter({ hasText: "Patel Textiles Pvt Ltd" });
  await row.hover();
  await expect(row.getByRole("link", { name: "Write" })).toHaveAttribute("href", `/app/inbox?compose=${id}`);
  await row.getByRole("link", { name: "Ask for papers" }).click();
  await expect(owner).toHaveURL(new RegExp(`/app/clients/${id}\\?tab=documents&ask=1$`));

  // With no firm email the link is shown once; the header's More keeps a Copy for it while it is open.
  await owner.getByLabel("Anything else, by name").fill("Loan statement");
  await owner.getByRole("dialog").getByRole("button", { name: "Ask for papers" }).click();
  const link = (await owner.locator(".link-once").textContent())!;
  const head = owner.locator(".page-head");
  await head.getByRole("button", { name: "More" }).click();
  await owner.getByRole("menuitem", { name: "Copy upload link" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Upload link copied" })).toBeVisible();
  expect(await copied()).toBe(link);
  await head.getByRole("button", { name: "Copy GSTIN" }).click();
  expect(await copied()).toBe("27AAPFU0939F1ZV");
  await expect(head.getByRole("button", { name: "Copy PAN" })).toBeVisible();

  // The next return still to file, in days from today.
  const [next] = await query(local.dbUrl, "select due_on::text due from public.tasks where client_id=$1 and kind='compliance' and status<>'filed' and due_on>=(now() at time zone 'Asia/Kolkata')::date order by due_on limit 1", [id]);
  const days = Math.round((Date.parse(next.due) - Date.parse(todayInIndia())) / 86_400_000);
  await expect(head.getByRole("link", { name: /^Next due: / })).toContainText(days === 0 ? ", today" : days === 1 ? ", tomorrow" : `, in ${days} days`);
  await expect(head.getByRole("link", { name: /^Next due: / })).toHaveAttribute("href", `/app/clients/${id}?tab=returns`);

  // Papers show 50 at a time, each with its type and a Copy for its drive folder, with their
  // true count however many there are.
  await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, drive_file_id, name, size, sha256, received_at) select $1, $2, 'gst', 'Sales bills', '2026-09', 'paging/' || n, 'Paging paper ' || n || '.pdf', 10, md5('paging' || n), now() - n * interval '1 minute' from generate_series(1, 551) n", [firm.firmId, id]);
  const [{ papers }] = await query(local.dbUrl, "select count(*)::int papers from public.documents where client_id=$1 and status not in ('deleted', 'earlier')", [id]);
  await owner.goto(`/app/clients/${id}?tab=documents`);
  await expect(owner.locator("section[aria-labelledby=files] tbody tr")).toHaveCount(50);
  await expect(owner.locator("section[aria-labelledby=files] tbody tr").first().getByRole("button", { name: "Copy Drive folder" })).toHaveCount(1);
  await expect(owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: `Documents ${papers}` })).toBeVisible();
  const pages = owner.getByRole("navigation", { name: "Papers pages" });
  await expect(pages).toContainText(`Showing 1 to 50 of ${papers} papers`);
  await pages.getByRole("link", { name: "Next" }).click();
  await expect(pages).toContainText(`Showing 51 to 100 of ${papers} papers`);
  // The last page, past the 500 the page once stopped at, and a paper there opens.
  const last = Math.ceil(papers / 50);
  await owner.goto(`/app/clients/${id}?tab=documents&page=${last}`);
  await expect(pages).toContainText(`Showing ${(last - 1) * 50 + 1} to ${papers} of ${papers} papers`);
  await owner.getByRole("link", { name: "Open Paging paper 551.pdf" }).click();
  await expect(owner.getByRole("dialog", { name: "Paging paper 551.pdf" })).toBeVisible();
  await query(local.dbUrl, "delete from public.documents where client_id=$1 and drive_file_id like 'paging/%'", [id]);
});
