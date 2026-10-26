import {createHash,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {inventedGstin} from "../fixtures/portal";
import {addPerson,appKey,localSupabase,query,runJobs,seedFirm,signIn} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// A GSTR-1 from papers to filed: Fill (pressed twice) makes one draft with the figure still to
// check, the automatic fill finds that draft, Today shows it in red before the due date, the last
// check makes the checked draft for the manager to approve, then it is filed. Invented data only.
test("Fill makes one draft, the last check makes the file to approve, and filing closes it",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const email=`returns-${randomUUID()}@invented.test`,key=appKey(),managerEmail=`returns-manager-${randomUUID()}@invented.test`,managerKey=appKey();
  const firm=await seedFirm("Return Work Browser Firm",email,key),client=randomUUID(),registration=randomUUID(),source=randomUUID(),draft=randomUUID(),account=randomUUID();
  const crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),files:string[]=[],name=`Invented Pipeline Client ${randomUUID().slice(0,8)}`;
  const managerContext=await browser.newContext();
  try {
    const manager=await addPerson(firm.firmId,managerEmail,"manager",managerKey);
    await query(local.dbUrl,"update public.firms set settings=settings||'{\"second_form_approval\":true}' where id=$1",[firm.firmId]);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,name]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'manager')",[firm.firmId,client,manager]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,inventedGstin()),await crypto.blindIndex(firm.firmId,"gstin",inventedGstin())]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    // Due in 10 days: before the firm's 5 days, so InboxCA does not fill it by itself yet.
    const [{id:task}]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+10) returning id",[firm.firmId,client,registration]);
    // The official GSTR-1 B2B headings with one invented sale; its taxable value is not checked yet.
    const values=[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","INV/7","2026-09-12","236.00","24-Gujarat","N","","Regular B2B","","18.00","200.00","0.00"];
    const bytes=Buffer.from(`${salesSections.b2b.headings.join(",")}\n${values.join(",")}`),sha256=createHash("sha256").update(bytes).digest("hex");
    const saved=await drive.save(await drive.ensureFolder([firm.firmId]),"Invented pipeline register.csv",bytes);
    if(saved==="taken") throw new Error("Test collision");files.push(saved.id);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented pipeline register.csv',$4,$5,$6)",[source,firm.firmId,client,bytes.length,sha256,saved.id]);
    const lines:Draft["lines"]=[];
    for(let column=0;column<values.length;column++) if(values[column]) {
      const id=randomUUID(),open=column===11;
      lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},...(open ? {state:"pending" as const} : {state:"confirmed" as const,by:firm.ownerId,at:new Date().toISOString()})});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);

    await signIn(page,email,key);
    const now=page.getByRole("region",{name:"Your list"});
    await expect(now.getByText(`GSTR-1 for ${name}, Sep 2026`)).toHaveCount(0);
    await page.goto("/app/calendar?view=month");await expect(page.getByRole("button",{name:`Fill ${name} GSTR-1 (monthly)`})).toBeVisible();
    // Fill by hand, pressed twice: one draft, made from the figures read so far.
    const returns=`/app/clients/${client}?tab=returns`;
    await page.goto(returns);const row=page.locator("li").filter({hasText:"GSTR-1 (monthly) Sep 2026"});
    await expect(row.getByText("Papers in, not filled yet. 1 figure not checked yet")).toBeVisible();
    await page.screenshot({path:test.info().outputPath("returns.png")});
    await row.getByRole("button",{name:/^Fill /}).dblclick();await expect(page).toHaveURL(/\/files\/.*\/view/,{timeout:60_000});
    const checks=page.getByRole("region",{name:"Figures not checked yet"});
    await expect(checks).toContainText("1 figure not checked yet.");await expect(checks.getByRole("listitem")).toContainText("200.00");
    await page.screenshot({path:test.info().outputPath("fill.png"),fullPage:true});
    const prepared="select id,name,size,drive_file_id,prepared from public.documents where firm_id=$1 and prepared is not null order by (prepared->>'version')::int";
    let forms=await query(local.dbUrl,prepared,[firm.firmId]);
    expect(forms).toHaveLength(1);expect(forms[0].name).toBe(`${name} - GSTR-1 - Sep 2026 - v1 (to check).xlsx`);expect(forms[0].prepared).toMatchObject({status:"draft",filled:true});expect(Number(forms[0].size)).toBeGreaterThan(0);
    // Five days before the due date: the morning run and the automatic fill find the same draft.
    await query(local.dbUrl,"update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date+3 where id=$1",[task]);
    await query(local.dbUrl,"insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values($1,'fill_return','task',$2,$3)",[firm.firmId,task,`fill_return:${task}:test`]);
    await runJobs(page.request,firm.firmId);
    expect(await query(local.dbUrl,prepared,[firm.firmId])).toHaveLength(1);
    // Pinned to the people who look after the client, to check; nothing can be downloaded yet.
    await page.goto("/app");await expect(now.getByText("Due in 3 days. Filled, 1 figure not checked yet")).toBeVisible();
    await page.goto(`/app/clients/${client}?tab=outputs`);
    const fill=page.locator("li").filter({has:page.getByRole("link",{name:forms[0].name,exact:true})});
    await expect(fill.getByRole("button",{name:"Download for filing"})).toBeDisabled();await expect(fill).toContainText("1 figure not checked yet.");
    // The last check: InboxCA makes the checked draft by itself. It waits for the manager's approval.
    await page.goto(`/app/files/${forms[0].id}/view`);await checks.getByRole("link",{name:"Check"}).click();
    await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    await expect.poll(async()=>(await query(local.dbUrl,prepared,[firm.firmId])).filter(form=>Number(form.size)>0).length,{timeout:60_000}).toBe(2);
    forms=await query(local.dbUrl,prepared,[firm.firmId]);files.push(...forms.map(form=>form.drive_file_id));
    expect(forms).toHaveLength(2);expect(forms[1].name).not.toContain("to check");expect(forms[1].prepared.status).toBe("draft");expect(forms[1].prepared.filled).toBeUndefined();
    await page.goto(returns);await expect(row.getByText("Checked, waiting for approval")).toBeVisible();
    await page.goto("/app");await expect(now.getByText("Checked and ready for your approval")).toHaveCount(0);
    // The manager approves from Today.
    const other=await managerContext.newPage();await signIn(other,managerEmail,managerKey);
    const managerNow=other.getByRole("region",{name:"Your list"});
    await expect(managerNow.getByText("Checked and ready for your approval")).toBeVisible();
    await managerNow.getByRole("link",{name:/Review and approve/}).click();await expect(other).toHaveURL(/tab=outputs/);
    await other.getByRole("button",{name:"Give second approval"}).click();
    await expect(other.getByRole("button",{name:"Download for filing"}).and(other.locator(":enabled"))).toBeVisible();
    // Approved: pinned to the client's people to download and file; filing closes it.
    await page.goto("/app");await expect(now.getByText("Approved. Download it and file on the portal")).toBeVisible();
    await page.screenshot({path:test.info().outputPath("today.png"),fullPage:true});
    await page.goto(returns);await expect(row.getByText("Approved. Download it and file on the portal")).toBeVisible();
    await page.goto(`/app/clients/${client}?tab=outputs`);
    const filing=page.locator("li").filter({has:page.getByRole("link",{name:forms[1].name,exact:true})});
    await filing.getByText("Record filing",{exact:true}).click();await filing.getByLabel("Acknowledgement number, if known").fill("AA2409260012345");await filing.getByRole("button",{name:"Mark filed",exact:true}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select status from public.tasks where firm_id=$1",[firm.firmId]))[0].status,{timeout:30_000}).toBe("filed");
    await page.goto(`${returns}&show=filed`);await expect(page.locator("li").filter({hasText:"GSTR-1 (monthly) Sep 2026"})).toContainText("AA2409260012345");
    await page.goto("/app");await expect(now.getByText(`GSTR-1 for ${name}, Sep 2026`)).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally {
    await managerContext.close().catch(()=>{});
    for(const file of (await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId]))) if(file.drive_file_id) files.push(file.drive_file_id);
    for(const id of new Set(files)) if(id) await drive.trash(id).catch(()=>{});
    await firm.remove(managerEmail);
  }
});
