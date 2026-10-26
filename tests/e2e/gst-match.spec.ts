import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { emailStep, localSupabase, query, runJobs, seedFirm, totp } from "./local-supabase";
import { inventedGstin, statement, supplierInvoices } from "../fixtures/portal";

// GSTR-2B against the purchase register: an invented register uploaded on the client and an
// invented GSTR-2B (the pinned GSTN layout) added as a portal file. The person confirms the
// columns once; the lists show what to ask suppliers about, and the next month is matched by
// itself with the remembered columns. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");

const own = inventedGstin(), one = inventedGstin("ZZZPZ0002Z"), two = inventedGstin("ZZZPZ0003Z");
const register = (month: string) => Buffer.from([
  `Invented Traders purchase register ${month},,,,,,,`,
  "Party GSTIN,Bill No,Bill Date,Taxable,IGST,CGST,SGST,Cess",
  `${one},INV/001,05-09-2026,1000.00,0,90.00,90.00,0`,
  `${one},INV/002,06-09-2026,500.00,0,45.00,45.00,0`,
  `${two},T-17,08-09-2026,"2,000.00",360.00,0,0,0`,
  ",CASH-1,09-09-2026,100.00,0,0,0,0",
  "Total,,,3600.00,360.00,135.00,135.00,0",
].join("\n"));
// Matches INV/001 as INV-0001, has INV/002 with less tax, and INV/003 the books do not have.
const twoB = (rtnprd: string) => {
  const value = statement(own, { b2b: [supplierInvoices(one, [{ number: "INV-0001", dt: "05-09-2026", txval: 1000, cgst: 90, sgst: 90 }, { number: "INV/002", dt: "06-09-2026", txval: 500, cgst: 40, sgst: 40 }, { number: "INV/003", dt: "07-09-2026", txval: 300, cgst: 27, sgst: 27 }])] });
  return Buffer.from(JSON.stringify({ ...value, data: { ...value.data, rtnprd } }));
};

test("lists the bills to ask suppliers about, the amounts that differ and what only GSTR-2B has, and matches the next month by itself", async ({ page, request }) => {
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 8), email = `gst-match-${tag}@invented.test`, name = `Invented Traders ${tag}`;
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const firm = await seedFirm("GST Match Test Firm", email, key);
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
    await expect(drive.getByRole("status")).toContainText("Connected");
    await page.goto("/app/clients?panel=add");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Kind", { exact: true }).selectOption("business");
    await page.getByLabel("GSTIN", { exact: true }).fill(own);
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.locator(".page-head")).toContainText(name);
    const [{ id: client }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, name]);

    // The month's GSTR-2B as a portal file, and the register uploaded on the client.
    const add = async (file: Buffer, upload: string, registers: number) => {
      await page.goto("/app/documents?view=papers");
      await page.getByRole("link", { name: "Add portal files" }).click();
      await page.getByLabel("Add portal files").setInputFiles({ name: "download.json", mimeType: "application/json", buffer: file });
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page).toHaveURL(/dropped=1-0-0/);
      await page.goto(`/app/clients/${client}?tab=documents`);
      await page.getByRole("link", { name: "Upload papers" }).click();
      await page.getByRole("dialog").getByLabel("Files", { exact: true }).setInputFiles({ name: upload, mimeType: "text/csv", buffer: register(upload) });
      await expect(page.getByRole("group", { name: upload }).getByLabel("Type")).toHaveValue("Purchase bills");
      await page.getByRole("dialog").getByRole("button", { name: "Upload", exact: true }).click();
      await expect.poll(async () => (await query(local.dbUrl, "select count(*)::int n from public.documents where client_id = $1 and document_type = 'Purchase bills'", [client]))[0].n).toBe(registers);
      await runJobs(request, firm.firmId);
    };
    await add(twoB("092026"), "purchase_register_sep_2026.csv", 1);
    const [sep] = await query(local.dbUrl, "select id, period_key from public.documents where client_id = $1 and document_type = 'Purchase bills'", [client]);
    expect(sep.period_key).toBe("2026-09");
    // Nothing is matched until a person confirms the columns: none is guessed.
    expect(await query(local.dbUrl, "select 1 from public.gst_matches where firm_id = $1", [firm.firmId])).toHaveLength(0);

    await page.goto(`/app/clients/${client}?tab=extraction`);
    const section = page.locator("section#gst-match");
    await expect(section).toContainText("Not matched with GSTR-2B yet.");
    await section.getByRole("link", { name: "Choose columns" }).click();
    await section.getByLabel("Column names are on row").fill("2");
    await section.getByRole("button", { name: "Show columns" }).click();
    await expect(section.getByRole("combobox", { name: "Supplier GSTIN", exact: true }).locator("option").nth(1)).toHaveText("A: Party GSTIN");
    for (const [field, column] of [["Supplier GSTIN", "0"], ["Invoice number", "1"], ["Invoice date", "2"], ["Taxable value", "3"]] as const)
      await section.getByRole("combobox", { name: field, exact: true }).selectOption(column);
    // Columns named as the field are offered, for the person to confirm.
    await expect(section.getByRole("combobox", { name: "CGST", exact: true })).toHaveValue("5");
    await section.getByRole("button", { name: "Confirm columns and match" }).click();
    await expect(page).toHaveURL(/match=matched/);
    await expect(section.getByRole("status")).toContainText("Matched with the GSTR-2B for Sep 2026.");
    await expect(section).toContainText("Sep 2026: 1 matched, 1 not in GSTR-2B: ask the supplier, 1 in GSTR-2B but not in the books, 1 amount differs");
    await expect(section).toContainText("1 row has no supplier GSTIN or invoice number and was left out.");
    const list = (title: string) => section.locator("details").filter({ has: page.locator("summary", { hasText: title }) });
    await list("Not in GSTR-2B: ask the supplier").locator("summary").click();
    await expect(list("Not in GSTR-2B: ask the supplier").locator("tbody tr")).toHaveText([new RegExp(`${two}.*T-17.*8 Sep 2026.*2,000\\.00.*360\\.00`)]);
    await expect(list("Not in GSTR-2B: ask the supplier").locator("summary")).toContainText("1 bill, taxable value ₹2,000.00, tax ₹360.00");
    await list("Amounts that differ").locator("summary").click();
    // One row a bill: the books' amounts, and GSTR-2B's under each one that differs.
    await expect(list("Amounts that differ").locator("tbody tr")).toHaveText([/INV\/002.*6 Sep 2026500\.000\.0045\.00GSTR-2B 40\.0045\.00GSTR-2B 40\.000\.00$/]);
    await list("In GSTR-2B but not in the books").locator("summary").click();
    await expect(list("In GSTR-2B but not in the books").locator("tbody tr")).toHaveText([new RegExp(`${one}.*INVENTED SUPPLIER.*INV/003.*300\\.00`)]);
    await expect(list("Matched").locator("summary")).toContainText("1 bill, taxable value ₹1,000.00, tax ₹180.00");

    // The list for the CA, every bill in it, a formula never run; the lists are sealed.
    const download = page.waitForEvent("download");
    await section.getByRole("link", { name: "Download the list" }).click();
    const file = await readFile((await (await download).path())!, "utf8");
    expect(file.split("\r\n")[0]).toBe("List,Supplier GSTIN,Supplier name,Invoice number,Invoice date,Note,Taxable value in the books,IGST in the books,CGST in the books,SGST in the books,Cess in the books,Taxable value in GSTR-2B,IGST in GSTR-2B,CGST in GSTR-2B,SGST in GSTR-2B,Cess in GSTR-2B,Rows in the register");
    expect(file).toContain(`Not in GSTR-2B,${two},,T-17,2026-09-08,,2000.00,360.00,0.00,0.00,0.00,,,,,,5`);
    expect(file).toContain(`Amount differs,${one},INVENTED SUPPLIER,INV/002,2026-09-06,,500.00,0.00,45.00,45.00,0.00,500.00,0.00,40.00,40.00,0.00,4`);
    expect(file).toContain(`Matched,${one},INVENTED SUPPLIER,INV/001,2026-09-05,,1000.00`);
    const [match] = await query(local.dbUrl, "select counts, result_enc from public.gst_matches where register_id = $1", [sep.id]);
    expect(match.counts).toEqual({ matched: 1, missing: 1, extra: 1, differ: 1 });
    expect(match.result_enc).not.toContain(one.slice(2, 12));
    expect((await query(local.dbUrl, "select action, actor_id from public.activity_log where firm_id = $1 and action like 'gst_match.%' order by at", [firm.firmId])).map((row) => row.action)).toEqual(["gst_match.made", "gst_match.downloaded"]);
    // No GSTR-3B figure was changed: the credit draft holds only the statement's own figures.
    const [credit] = await query(local.dbUrl, "select data from public.datasets where client_id = $1 and form_code = 'GSTR3B'", [client]);
    expect(credit.data.lines.every((line: { state: string; source: { reader: string } }) => line.state === "pending" && line.source.reader === "gstr2b-v4.5")).toBe(true);

    // October: same columns, matched by the jobs alone once both papers are in.
    await add(twoB("102026"), "purchase_register_oct_2026.csv", 2);
    const [oct] = await query(local.dbUrl, "select id from public.documents where client_id = $1 and document_type = 'Purchase bills' and period_key = '2026-10'", [client]);
    await expect.poll(async () => (await query(local.dbUrl, "select counts from public.gst_matches where register_id = $1", [oct.id]))[0]?.counts).toEqual({ matched: 1, missing: 1, extra: 1, differ: 1 });

    // Staff see the lists but download only when the owner allows it.
    await query(local.dbUrl, "update public.firm_members set role = 'staff' where firm_id = $1 and user_id = $2", [firm.firmId, firm.ownerId]);
    await page.goto(`/app/clients/${client}?tab=extraction&purchases=${sep.id}`);
    await expect(section).toContainText("1 amount differs");
    await expect(section.getByRole("link", { name: "Download the list" })).toHaveCount(0);
    await page.goto(`/app/clients/${client}/gst-match?register=${sep.id}`);
    await expect(page.locator("section#gst-match").getByRole("alert")).toContainText("Ask your firm's owner to let you download this client's files.");
  } finally {
    await firm.remove();
  }
});
