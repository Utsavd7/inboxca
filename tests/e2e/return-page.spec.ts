import {createHash,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect,type Page} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {inventedGstin} from "../fixtures/portal";
import {addPerson,appKey,localSupabase,query,seedFirm,signIn} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// The step the return's own page stands at, from its stepper.
const now=(page:Page)=>page.getByRole("navigation",{name:"Steps of this return"}).locator(".is-now");
const next=(page:Page)=>page.getByRole("region",{name:"Next step"});

// One GSTR-1 on its own page, from papers in to filed: Prepare fills it, its one open figure is
// checked there, a staff member sees the approval wait and why, the manager approves, the owner
// downloads the file and marks it filed, and the stepper moves at each step. Invented data only.
test("a GSTR-1 goes from papers in to filed on its own page",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const email=`return-page-${randomUUID()}@invented.test`,key=appKey(),managerEmail=`return-page-manager-${randomUUID()}@invented.test`,managerKey=appKey(),staffEmail=`return-page-staff-${randomUUID()}@invented.test`,staffKey=appKey();
  const firm=await seedFirm("Return Page Browser Firm",email,key),client=randomUUID(),registration=randomUUID(),source=randomUUID(),draft=randomUUID(),account=randomUUID();
  const crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),files:string[]=[],name=`Invented Return Page Client ${randomUUID().slice(0,8)}`;
  const others=await Promise.all([browser.newContext(),browser.newContext()]);
  try {
    const manager=await addPerson(firm.firmId,managerEmail,"manager",managerKey);await addPerson(firm.firmId,staffEmail,"staff",staffKey);
    await query(local.dbUrl,"update public.firms set settings=settings||'{\"second_form_approval\":true}' where id=$1",[firm.firmId]);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,name]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'manager')",[firm.firmId,client,manager]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,inventedGstin()),await crypto.blindIndex(firm.firmId,"gstin",inventedGstin())]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    // Due in 10 days: before the firm's 5 days, so InboxCA does not fill it by itself.
    const [{id:task}]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+10) returning id",[firm.firmId,client,registration]);
    // The client's sales register is in, read into the official GSTR-1 B2B headings with one
    // invented sale; its taxable value is not checked yet.
    const values=[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","INV/7","2026-09-12","236.00","24-Gujarat","N","","Regular B2B","","18.00","200.00","0.00"];
    const bytes=Buffer.from(`${salesSections.b2b.headings.join(",")}\n${values.join(",")}`),sha256=createHash("sha256").update(bytes).digest("hex");
    const saved=await drive.save(await drive.ensureFolder([firm.firmId]),"Invented return page register.csv",bytes);
    if(saved==="taken") throw new Error("Test collision");files.push(saved.id);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented return page register.csv',$4,$5,$6)",[source,firm.firmId,client,bytes.length,sha256,saved.id]);
    const lines:Draft["lines"]=[];
    for(let column=0;column<values.length;column++) if(values[column]) {
      const id=randomUUID(),open=column===11;
      lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},...(open ? {state:"pending" as const} : {state:"confirmed" as const,by:firm.ownerId,at:new Date().toISOString()})});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);
    const prepared="select id,size,drive_file_id,prepared from public.documents where firm_id=$1 and prepared is not null order by (prepared->>'version')::int";

    // From the client's Returns row to the return's page, at Draft with Papers and Figures done.
    await signIn(page,email,key);
    await page.goto(`/app/clients/${client}?tab=returns`);
    await page.getByRole("link",{name:"GSTR-1 Sep 2026",exact:true}).click();
    const here=new RegExp(`/app/clients/${client}/returns/${task}`);
    await expect(page).toHaveURL(here);await expect(now(page)).toContainText("Draft");
    await page.screenshot({path:test.info().outputPath("draft.png"),fullPage:true});
    // Prepare fills it and the page moves to Check, with the open figure to check.
    await next(page).getByRole("button",{name:"Prepare GSTR-1"}).click();
    await expect(now(page)).toContainText("Check",{timeout:60_000});await expect(page).toHaveURL(here);
    expect(await query(local.dbUrl,prepared,[firm.firmId])).toHaveLength(1);
    // Its figures are checked a group at a time right there: one All correct for the invoice.
    await page.getByRole("region",{name:"Figures not checked yet"}).getByRole("button",{name:"All correct"}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    await expect(page).toHaveURL(here);
    // The last check makes the checked draft by itself; it waits for the second approval.
    await expect.poll(async()=>(await query(local.dbUrl,prepared,[firm.firmId])).filter(form=>Number(form.size)>0).length,{timeout:60_000}).toBe(2);
    await page.goto(`/app/clients/${client}/returns/${task}`);await expect(now(page)).toContainText("Approve");

    // Staff may not approve: the step waits, and says why.
    const [staff,boss]=await Promise.all(others.map(context=>context.newPage()));
    await signIn(staff,staffEmail,staffKey);await staff.goto(`/app/clients/${client}/returns/${task}`);
    await expect(now(staff)).toContainText("Approve");await expect(next(staff)).toContainText("Only the firm's owner, a partner or a manager");
    await expect(staff.getByRole("button",{name:"Give second approval"})).toBeDisabled();
    // The manager approves on the same page, and it moves to File.
    await signIn(boss,managerEmail,managerKey);await boss.goto(`/app/clients/${client}/returns/${task}`);
    await boss.getByRole("button",{name:"Give second approval"}).click();
    await expect(now(boss)).toContainText("File");await expect(boss).toHaveURL(here);

    // The owner downloads the file for the portal, then marks it filed with its ARN.
    await page.reload();await expect(now(page)).toContainText("File");
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download for filing"}).click();expect((await download).suggestedFilename()).toBeTruthy();
    await page.locator("summary",{hasText:"Mark filed"}).click();await page.getByLabel("Acknowledgement number, if known").fill("AA2409260054321");
    await page.getByRole("button",{name:"Mark filed",exact:true}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select status from public.tasks where id=$1",[task]))[0].status,{timeout:30_000}).toBe("filed");
    await page.goto(`/app/clients/${client}/returns/${task}`);
    await expect(page.getByRole("navigation",{name:"Steps of this return"}).locator(".is-done")).toHaveCount(6);
    await page.screenshot({path:test.info().outputPath("filed.png"),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally {
    await Promise.all(others.map(context=>context.close().catch(()=>{})));
    for(const file of (await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId]))) if(file.drive_file_id) files.push(file.drive_file_id);
    for(const id of new Set(files)) if(id) await drive.trash(id).catch(()=>{});
    await firm.remove(managerEmail,staffEmail);
  }
});

// An ITR and a TDS statement are prepared in the Draft step of their own page: their old pages
// open there with the form asked for, only the return's own forms are offered, and a quarter with
// no return on the calendar keeps its statement page. Invented data only.
test("the income tax and TDS pages open in their return's Draft step",async({page})=>{
  test.setTimeout(120_000);loadEnvConfig(process.cwd());
  const email=`return-draft-${randomUUID()}@invented.test`,key=appKey(),firm=await seedFirm("Return Draft Browser Firm",email,key),client=randomUUID(),pan=randomUUID(),tan=randomUUID(),crypto=serverCrypto();
  try {
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,`Invented Draft Client ${randomUUID().slice(0,8)}`]);
    for(const [id,kind,number] of [[pan,"pan","ZZZPZ0001Z"],[tan,"tan","ZZZZ99997Z"]]) // ggignore: invented PAN and TAN.
      await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,$4,$5,$6)",[id,firm.firmId,client,kind,await crypto.encrypt(firm.firmId,`clients/${client}/${kind}`,number),await crypto.blindIndex(firm.firmId,kind,number)]);
    const [itr,tds]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'ITR_NA','2026-03','2026-07-31'),($1,$2,$4,'TDS_RET','2026-09','2026-10-31') returning id",[firm.firmId,client,pan,tan]);
    await signIn(page,email,key);
    await page.goto(`/app/clients/${client}/itr?form=ITR2&year=2026`);
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client}/returns/${itr.id}\\?.*step=draft`));
    await expect(page.getByRole("navigation",{name:"Steps of this return"}).locator(".is-shown")).toContainText("Draft");
    await expect(page.getByLabel("Return",{exact:true})).toHaveValue("ITR2");await expect(page.getByRole("region",{name:"Still to fill"})).toBeVisible();
    await expect(page.getByRole("link",{name:"Computation sheet"})).toBeVisible();
    await page.goto(`/app/clients/${client}/tds?tan=${tan}&period=2026-09&form=TDS138`);
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client}/returns/${tds.id}\\?.*step=draft`));await expect(page.getByText(/^Form No\. 138: Statement of/)).toBeVisible();
    await expect(page.getByRole("navigation",{name:"Statement"}).getByRole("link")).toHaveText(["Form No. 140 (26Q)","Form No. 138 (24Q)","Form No. 144 (27Q)"]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.goto(`/app/clients/${client}/tds?tan=${tan}&period=2026-12`);
    await expect(page).toHaveURL(/\/tds\?/);await expect(page.getByRole("heading",{name:"Form No. 140, Oct to Dec 2026"})).toBeVisible();
  } finally {
    await firm.remove();
  }
});
