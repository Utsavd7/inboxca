import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {todayInIndia} from "@/src/lib/calendar";
import {emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// Form No. 140 end to end: the TAN and its statement details, a payment register read with the
// columns a person chose, a challan typed by hand, the figures checked at once, the statement
// prepared, a second person's approval and the file downloaded for the FVU. Every TAN, PAN and
// name is invented (ggignore: invented test identifiers, not secrets).
test("prepares a Form No. 140 statement from a register and a challan, approved by a second person",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const key=()=>Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const email=`tds-${randomUUID()}@invented.test`,secret=key(),managerEmail=`tds-manager-${randomUUID()}@invented.test`,managerKey=key();
  const firm=await seedFirm("TDS Browser Firm",email,secret),client=randomUUID(),account=randomUUID(),source=randomUUID(),tan="ZZZZ99999Z",pan="ZZZPZ0001Z";
  const crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),files:string[]=[];
  const managerContext=await browser.newContext();
  try {
    const admin=createClient(local.url,local.secretKey,{auth:{persistSession:false}}),{data,error}=await admin.auth.admin.createUser({email:managerEmail,email_confirm:true});
    if(error) throw error;const manager=data.user.id;
    await query(local.dbUrl,"insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'manager','active')",[firm.firmId,manager]);
    await query(local.dbUrl,"insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values(gen_random_uuid(),$1,'Test app','totp','verified',$2,now(),now())",[manager,managerKey]);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented TDS Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'manager')",[firm.firmId,client,manager]);
    await query(local.dbUrl,"insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,'pan',$3,$4)",[firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/pan`,pan),await crypto.blindIndex(firm.firmId,"pan",pan)]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    await query(local.dbUrl,"update public.firms set settings=settings||'{\"second_form_approval\":true}' where id=$1",[firm.firmId]);
    // The client's payment register, with its own column names.
    const register=["Party PAN,Party,Code,Paid on,Gross,TDS,Rate %,Challan no","ZZZPZ0002Z,Invented Contractor,1024,10/07/2026,100000.00,2000.00,2,123","ZZZPZ0003Z,Invented Consultant,1027,05/08/2026,50000.00,5000.00,10,123"].join("\n");
    const bytes=Buffer.from(register),sha256=createHash("sha256").update(bytes).digest("hex");
    const saved=await drive.save(await drive.ensureFolder([firm.firmId]),"Invented TDS register.csv",bytes);
    if(saved==="taken") throw new Error("Test collision");files.push(saved.id);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'income_tax','Document','2026-09','Invented TDS register.csv',$4,$5,$6)",[source,firm.firmId,client,bytes.length,sha256,saved.id]);

    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(secret));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    // The TAN, then its statement details on the client's Details.
    await page.goto(`/app/clients/${client}?tab=numbers`);
    await page.getByLabel("Type").selectOption("tan");await page.getByRole("textbox",{name:"Number"}).fill(tan);await page.getByRole("button",{name:"Add number"}).click();
    await expect(page).toHaveURL(/changed=add-number/);
    const [{id:registration}]=await query(local.dbUrl,"select id from public.client_registrations where client_id=$1 and kind='tan'",[client]);
    await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'TDS_RET','2026-09','2026-10-31')",[firm.firmId,client,registration]);
    await page.getByRole("link",{name:"TDS statement details"}).click();
    await page.locator('[name="type"]').selectOption("F");
    for(const [name,value] of [["d_flat","12 Invented Lane"],["d_district","Invented District"],["d_pin","380001"],["d_email","tds@invented.test"],["d_phone","9000000001"],["p_name","Invented Partner"],["p_designation","Partner"],["p_pan","ZZZPZ0009Z"],["p_flat","12 Invented Lane"],["p_pin","380001"],["p_phone","9000000002"]]) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('[name="d_state"]').selectOption("24");await page.locator('[name="p_state"]').selectOption("24");
    await page.getByRole("button",{name:"Save statement details"}).click();await expect(page).toHaveURL(/changed=tds/);
    // The quarter's TDS return opens its statement in the Draft step of the return's own page.
    await page.goto(`/app/clients/${client}?tab=returns`);await page.getByRole("link",{name:/^Prepare TDS returns/}).click();
    const here=/\/app\/clients\/[0-9a-f-]{36}\/returns\/[0-9a-f-]{36}/;
    await expect(page).toHaveURL(new RegExp(`${here.source}\\?step=draft$`));await expect(page.getByText(/^Form No\. 140: Statement of/)).toBeVisible();
    // Read the register with the columns a person chose.
    await page.getByRole("link",{name:"Read Invented TDS register.csv as payments"}).click();
    for(const [field,column] of [["Deductee PAN","A: Party PAN"],["Deductee name","B: Party"],["Section code","C: Code"],["Date of payment or credit","D: Paid on"],["Amount paid or credited","E: Gross"],["Tax deducted","F: TDS"],["Rate","G: Rate %"],["Challan serial number","H: Challan no"]] as const)
      await page.getByLabel(new RegExp(`^${field}`)).first().selectOption({label:column});
    await page.getByRole("button",{name:"Confirm columns and read payments"}).click();await expect(page.getByText("Figures read. Check them below.")).toBeVisible();
    await page.getByLabel("Was a regular Form No. 140 filed for an earlier quarter?").selectOption("N");await page.getByRole("button",{name:"Save answer"}).click();await expect(page.getByText("Saved for checking.")).toBeVisible();
    for(const [name,value] of [["bsr","0510308"],["date","2026-08-07"],["number","123"],["tax","7000"]]) await page.locator(`form [name="${name}"]`).fill(value);
    await page.getByRole("button",{name:"Add challan"}).click();await expect(page.getByText("Saved for checking.")).toBeVisible();
    await expect(page.getByRole("button",{name:"Prepare Form No. 140"})).toBeDisabled();
    await page.getByRole("button",{name:"Yes, these figures are right"}).click();await expect(page.getByText("Every figure is checked. Prepare the statement below.")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Prepare Form No. 140"}).click();await expect(page).toHaveURL(new RegExp(`${here.source}$`));
    const [made]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='TDS140'",[firm.firmId]);files.push(made.drive_file_id);
    expect(made.prepared.status).toBe("draft");expect(made.name).toBe("Invented TDS Client - Form No. 140 - Jul to Sep 2026 - v1.txt");
    // The owner checked the figures, so a second person approves.
    const card=page.locator("li").filter({has:page.getByRole("link",{name:made.name,exact:true})});
    await expect(card.getByText(/Validate this file with Protean/)).toBeVisible();
    await card.getByRole("button",{name:"Give second approval"}).click();await expect(page.getByRole("status")).toContainText("Another person must approve");
    const other=await managerContext.newPage();await emailStep(other,managerEmail);await other.getByLabel("6 digit code from the app").fill(totp(managerKey));await other.getByRole("button",{name:"Continue"}).click();await expect(other).toHaveURL(/\/app$/);
    await other.goto(new URL(page.url()).pathname);const approved=other.locator("li").filter({has:other.getByRole("link",{name:made.name,exact:true})});
    await approved.getByRole("button",{name:"Give second approval"}).click();
    const download=other.waitForEvent("download",{timeout:20_000});await approved.getByRole("button",{name:"Download for filing"}).click();const downloaded=await download;
    expect(downloaded.suggestedFilename()).toBe(made.name);
    const text=await readFile((await downloaded.path())!,"latin1"),records=text.split("\r\n");
    const today=todayInIndia(),created=`${today.slice(8,10)}${today.slice(5,7)}${today.slice(0,4)}`;
    expect(records.slice(0,3)).toEqual([`1^FH^NS1^R^${created}^1^D^${tan}^1^InboxCA^^^^^^^^`,
      `2^BH^1^1^140^^^^^^^^${tan}^^${pan}^202728^202627^Q2^Invented TDS Client^India^12 Invented Lane^^^^Invented District^24^380001^tds@invented.test^91^9000000001^^F^Invented Partner^Partner^12 Invented Lane^^^^^24^380001^^India^91^9000000002^^7000.00^^^^^N^^^^^^^ZZZPZ0009Z^^^^^^^^^^^^^`,
      "3^CD^1^1^2^N^^7000.00^0.00^0.00^0.00^7000.00^C^^0510308^^00123^^07082026^^7000.00^7000.00^200^0.00^0.00^^^^^"]);
    expect(records[3]).toMatch(/^4\^DD\^1\^1\^1\^O\^\^ZZZPZ0002Z\^Invented Contractor\^/);expect(records.at(-1)).toBe("");expect(records).toHaveLength(6);
    await other.screenshot({path:test.info().outputPath("tds.png"),fullPage:true});
  } finally {
    await managerContext.close().catch(()=>{});
    for(const file of (await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId]))) if(file.drive_file_id) files.push(file.drive_file_id);
    for(const id of new Set(files)) await drive.trash(id).catch(()=>{});
    await firm.remove(managerEmail);
  }
});
