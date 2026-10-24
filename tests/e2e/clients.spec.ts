import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
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
  await owner.getByRole("link", { name: "Clients" }).click();
  await owner.getByLabel("Name", { exact: true }).fill("Patel Textiles");
  await owner.getByLabel("Kind", { exact: true }).selectOption("business");
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
  const gstin = owner.getByRole("dialog", { name: "Services" }).getByRole("listitem").filter({ hasText: "GSTIN" });
  await gstin.getByLabel("GSTR-1 (monthly)").check();
  await gstin.getByLabel("GSTR-3B (monthly)").check();
  // Wait for the save: it is what adds the due dates.
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), gstin.getByRole("button", { name: "Save services" }).click()]);
  await owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: /^Returns/ }).click();
  const due = owner.locator("section[aria-labelledby=due] li");
  await expect(due.filter({ hasText: "GSTR-3B (monthly)" }).first()).toContainText("*");
  await expect(owner.locator(".client-pane")).toContainText("not yet confirmed by a CA");
  const [{n}]=await query(local.dbUrl,"select count(*)::int n from public.tasks t join public.clients c on c.id=t.client_id where c.firm_id=$1 and c.name='Patel Textiles' and t.kind='compliance' and t.status<>'filed'",[firm.firmId]);
  expect(n).toBeGreaterThan(12);
  await expect(due).toHaveCount(n);
});

test("a return is marked filed with its acknowledgement on the calendar", async () => {
  await owner.goto("/app/calendar");
  const row = owner.getByRole("row").filter({ hasText: "GSTR-3B (monthly)" }).first();
  await row.getByRole("checkbox").check();
  await row.getByLabel(/Acknowledgement for/).fill("AA240925123456X");
  await owner.getByRole("button", { name: "Mark chosen as filed" }).click();
  await owner.getByRole("link", { name: "Filed in the last 30 days" }).click();
  await expect(owner.getByRole("heading", { name: /^Filed in the last 30 days/ })).toBeVisible();
  await expect(owner.getByRole("row").filter({ hasText: "Patel Textiles" })).toContainText("AA240925123456X");
});

test("Today shows what needs the owner today and the next setup step", async () => {
  // One return falls due today and two are 4 days late: the client's late returns are one row.
  await query(local.dbUrl,"update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date where id=(select id from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and code='GSTR3B_M' order by due_on desc limit 1)",[firm.firmId]);
  await query(local.dbUrl,"update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date-4 where id in (select id from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and code='GSTR1_M' order by due_on desc limit 2)",[firm.firmId]);
  const [{n}]=await query(local.dbUrl,"select count(*)::int n from public.tasks where firm_id=$1 and kind='compliance' and status<>'filed' and due_on<(now() at time zone 'Asia/Kolkata')::date",[firm.firmId]);
  await owner.getByRole("link", { name: "Today" }).click();
  await expect(owner.locator(".page-head")).toContainText(/\d+ things? needs? you today\./);
  const late = owner.locator("section[aria-labelledby=t-late]").getByRole("listitem");
  await expect(late).toHaveCount(1);
  await expect(late).toContainText("Patel Textiles");
  await expect(late).toContainText(`and ${n-1} more`);
  await expect(owner.locator("section[aria-labelledby=t-week]").getByRole("listitem").filter({ hasText: "GSTR-3B (monthly)" })).toContainText("1 client");
  await late.getByRole("link", { name: "See returns for Patel Textiles" }).click();
  await expect(owner).toHaveURL(/\/app\/clients\/[^/]+\?tab=due$/,{timeout:15_000});
  await owner.getByRole("link", { name: "Today" }).click();
  const start = owner.getByRole("region", { name: "Finish setting up" });
  await expect(start.getByRole("listitem").filter({ hasText: "Clients" }).getByLabel("Done")).toBeVisible();
  await expect(start.getByRole("link", { name: "Connect the firm's email" })).toHaveAttribute("href", "/app/settings#mailbox");
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
  await owner.getByLabel("Number", { exact: true }).selectOption("gstin");
  await owner.getByLabel("Value").fill("29AAGCB7383J1Z4"); // a valid GSTIN with another PAN
  await owner.getByRole("button", { name: "Add number" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "holds a different PAN" })).toBeVisible();
  await owner.getByLabel("Number", { exact: true }).selectOption("tan");
  await owner.getByLabel("Value").fill("muma12345b");
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
  const problems = owner.locator("section[aria-labelledby=import]").getByRole("table");
  for (const text of ["PAN is not valid", "not a kind InboxCA knows", "on an earlier row", "Enter the client's name", "already in your firm", "email address is not valid"])
    await expect(problems).toContainText(text);

  await owner.getByRole("button", { name: "Import 500 clients" }).click();
  await expect(owner.getByText("Imported 500 clients.")).toBeVisible({ timeout: 30_000 });
  await owner.goto(`/app/clients?q=${pan(321).toLowerCase()}`);
  await expect(owner.getByRole("link", { name: "Client 321" })).toBeVisible();
  await owner.goto("/app/clients?q=client42@example.test");
  await expect(owner.getByRole("link", { name: "Client 42", exact: true })).toBeVisible();
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
  await owner.goto("/app/people");
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
  const panel = owner.getByRole("dialog", { name: "Contact people" });
  await owner.getByLabel("Contact's name").fill("Ramesh Patel");
  await owner.getByLabel("Contact's email").fill("ramesh@patel.example");
  await owner.getByLabel("Who they are, if known").fill("Director");
  await owner.getByRole("button", { name: "Add contact" }).click();
  const row = panel.getByRole("listitem").filter({ hasText: "Ramesh Patel" });
  await expect(row).toContainText("ramesh@patel.example, Director");
  await row.getByLabel("Receives documents").check();
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await owner.reload();
  await expect(panel.getByRole("listitem").filter({ hasText: "Ramesh Patel" }).getByLabel("Receives documents")).toBeChecked();

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
  await owner.getByRole("link", { name: "Upload papers" }).click();
  const drop = (files: { name: string; buffer: Buffer }[]) =>
    owner.getByLabel("Add portal files").setInputFiles(files.map((file) => ({ ...file, mimeType: "application/json" })));
  await drop([
    { name: "returns.json", buffer: gstr2b },
    { name: "GSTR2B_september.json", buffer: other },
  ]);
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText("1 filed in its client's folder; 1 not filed");
  await owner.goto("/app?panel=upload");
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
  await expect(notices).toContainText("Invented notice");await expect(notices).toContainText("Review by 22 Oct 2026");
  await expect(notices).not.toContainText("24 Dec 2026");
  await owner.getByRole("navigation",{name:"Client",exact:true}).getByRole("link",{name:"Overview"}).click();
  await owner.getByRole("link",{name:"Activity",exact:true}).click();
  await expect(owner.locator("section[aria-labelledby=client-activity]")).toContainText("Client added");
  await expect(owner.getByRole("link",{name:"Figures",exact:true})).toHaveCount(0);
  await expect(owner.getByRole("link",{name:"Prepared forms",exact:true})).toHaveCount(0);
  // The client's oldest late return leads Today's late returns until the client is archived.
  await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-01',current_date-300)",[firm.firmId,client]);
  await owner.goto("/app");
  const late=owner.locator("section[aria-labelledby=t-late]").getByRole("listitem").filter({hasText:"Tabs Test Client"});
  await expect(late).toContainText("GSTR-1 (monthly) for Jan 2026");
  await query(local.dbUrl,"update public.clients set archived_at=now() where id=$1",[client]);
  await owner.reload();
  await expect(late).toHaveCount(0);
});
