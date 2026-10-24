import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createClient} from "@supabase/supabase-js";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {writeWorkbook} from "../../worker/workbook";
import {inventedGstin} from "../fixtures/portal";
import {pdf} from "../fixtures/pdf";
import {emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// M6: checked sources, approval reset, a different second approver and the filing exception.
test("prepared files keep versions and checked sources, then file with an acknowledgement",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const key=()=>Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const email=`prepared-${randomUUID()}@invented.test`,secret=key(),managerEmail=`prepared-manager-${randomUUID()}@invented.test`,managerKey=key();
  const firm=await seedFirm("Prepared Browser Firm",email,secret),client=randomUUID(),registration=randomUUID(),source=randomUUID(),draft=randomUUID(),account=randomUUID();
  const crypto=serverCrypto(),drive=localDrive(`${tmpdir()}/inboxca-test-drive`),files:string[]=[];
  const managerContext=await browser.newContext();
  try {
    const admin=createClient(local.url,local.secretKey,{auth:{persistSession:false}}),{data,error}=await admin.auth.admin.createUser({email:managerEmail,email_confirm:true});
    if(error) throw error;const manager=data.user.id;
    await query(local.dbUrl,"insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'manager','active')",[firm.firmId,manager]);
    await query(local.dbUrl,"insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values(gen_random_uuid(),$1,'Test app','totp','verified',$2,now(),now())",[manager,managerKey]);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented Prepared Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'manager')",[firm.firmId,client,manager]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,inventedGstin()),await crypto.blindIndex(firm.firmId,"gstin",inventedGstin())]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    // Structure: the pinned official GSTR-1 B2B worksheet headings. All taxpayer data is invented.
    const values=[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","INV/1","2026-09-10","118.00","24-Gujarat","N","","Regular B2B","","18.00","100.00","0.00"];
    const bytes=Buffer.from(`${salesSections.b2b.headings.join(",")}\n${values.join(",")}`),sha256=createHash("sha256").update(bytes).digest("hex");
    const folder=await drive.ensureFolder([firm.firmId]),saved=await drive.save(folder,"Invented register.csv",bytes);
    if(saved==="taken") throw new Error("Test collision");files.push(saved.id);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented register.csv',$4,$5,$6)",[source,firm.firmId,client,bytes.length,sha256,saved.id]);
    const lines:Draft["lines"]=[];
    for(let column=0;column<values.length;column++) if(values[column]) {
      const id=randomUUID();lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},state:"confirmed",by:firm.ownerId,at:new Date().toISOString()});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);
    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(secret));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    const outputs=`/app/clients/${client}?tab=outputs`;
    await page.goto(outputs);await page.getByRole("button",{name:"Prepare Sep 2026",exact:true}).click();await expect(page).toHaveURL(/\/files\/.*\/view/);
    await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();await expect(page.getByRole("navigation",{name:"Form sheets"}).getByRole("link",{name:"B2B",exact:true})).toHaveAttribute("aria-current","page");
    const [first]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared is not null",[firm.firmId]);files.push(first.drive_file_id);
    expect(first.prepared.status).toBe("approved");expect(first.drive_file_id).toContain("/Prepared/");expect((await page.request.get(`/app/files/${first.id}`)).status()).toBe(404);
    // Changing a figure clears approval; the final check regenerates the next version.
    const line=lines.find(line=>line.field==="b2b.r2.c11")!;
    await page.goto(`/app/clients/${client}?tab=extraction&draft=${draft}&line=${line.id}`);await page.getByLabel("Correct figure").fill("101.00");await page.getByLabel("Why it changed").fill("Invented register correction");await page.getByRole("button",{name:"Save correction",exact:true}).click();
    await expect(page.getByRole("status")).toContainText("Your check was saved");
    expect((await query(local.dbUrl,"select prepared->>'status' status from public.documents where id=$1",[first.id]))[0].status).toBe("draft");
    await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',(select jsonb_agg(case when l->>'id'=$2 then l else l||jsonb_build_object('state','confirmed','by',$3::text,'at',$4::text) end) from jsonb_array_elements(data->'lines') l)) where id=$1",[draft,line.id,firm.ownerId,new Date().toISOString()]);
    await page.reload();await page.getByRole("button",{name:"Yes, this is right"}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select count(*)::int n from public.documents where firm_id=$1 and prepared->>'version'='2' and size>0",[firm.firmId]))[0].n,{timeout:30_000}).toBe(1);
    const [second]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'version'='2'",[firm.firmId]);files.push(second.drive_file_id);
    const corrected=writeWorkbook(Buffer.from(await drive.read(second.drive_file_id)),new Map([["xl/worksheets/sheet2.xml",new Map([["L5",{value:"102.00",number:true}]])]]));
    await page.goto(outputs);const row=page.locator("li").filter({has:page.getByRole("link",{name:second.name,exact:true})});
    await row.getByText("File corrected outside InboxCA",{exact:true}).click();await row.getByLabel("Filled official workbook").setInputFiles({name:"corrected.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:corrected});await row.getByRole("button",{name:"Add corrected version"}).click();await expect(page).toHaveURL(/tab=extraction&draft=/);
    const [external]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'external'='true'",[firm.firmId]);files.push(external.drive_file_id);
    const externalDraft=external.prepared.sources[0].id;
    expect(external.prepared.status).toBe("draft");await expect(page.getByText(/Sheet 2, cell/)).toBeVisible();await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
    await page.goto("/app/settings#permissions");await page.getByLabel(/Second approval before filing/).check();await page.getByRole("button",{name:"Save permissions",exact:true}).click();await expect(page).toHaveURL(/saved=permissions/);
    await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',(select jsonb_agg(l||jsonb_build_object('state','confirmed','by',$2::text,'at',$3::text)) from jsonb_array_elements(data->'lines') l)) where id=$1",[externalDraft,firm.ownerId,new Date().toISOString()]);
    await page.goto(outputs);const own=page.locator("li").filter({has:page.getByRole("link",{name:external.name,exact:true})});await own.getByRole("button",{name:"Give second approval"}).click();await expect(page.getByRole("status")).toContainText("Another person must approve");
    const other=await managerContext.newPage();await emailStep(other,managerEmail);await other.getByLabel("6 digit code from the app").fill(totp(managerKey));await other.getByRole("button",{name:"Continue"}).click();await expect(other).toHaveURL(/\/app$/);
    await other.goto(outputs);const approved=other.locator("li").filter({has:other.getByRole("link",{name:external.name,exact:true})});await approved.getByRole("button",{name:"Give second approval"}).click();
    await expect(approved.getByRole("button",{name:"Download for filing"})).toBeVisible();
    expect((await other.request.post(`/app/files/${external.id}/filing`,{headers:{Origin:"https://invented.invalid"}})).status()).toBe(403);
    await other.screenshot({path:test.info().outputPath("prepared.png"),fullPage:true});
    expect(await other.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const download=other.waitForEvent("download",{timeout:20_000});await approved.getByRole("button",{name:"Download for filing"}).click();const downloaded=await download;
    expect(createHash("sha256").update(await readFile((await downloaded.path())!)).digest("hex")).toBe(external.sha256);expect((await other.request.get(downloaded.url())).status()).toBe(410);
    await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'GSTR1_M','2026-09','2026-10-11')",[firm.firmId,client,registration]);
    await approved.getByText("Record filing",{exact:true}).click();
    await approved.getByLabel("Or upload the portal acknowledgement").setInputFiles({name:"invented-ack.pdf",mimeType:"application/pdf",buffer:Buffer.from(pdf("Invented filing acknowledgement"))});await approved.getByRole("button",{name:"Mark filed",exact:true}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select prepared->>'status' status from public.documents where id=$1",[external.id]))[0].status).toBe("filed");
    expect((await query(local.dbUrl,"select status from public.tasks where firm_id=$1 and code='GSTR1_M'",[firm.firmId]))[0].status).toBe("filed");
    expect((await query(local.dbUrl,"select count(*)::int n from public.activity_log where firm_id=$1 and action='form.downloaded'",[firm.firmId]))[0].n).toBe(1);
    const [filed]=await query(local.dbUrl,"select prepared from public.documents where id=$1",[external.id]);expect(filed.prepared.status).toBe("filed");expect(filed.prepared.acknowledgement).toBeTruthy();
    // A second GST number: each register is given its number before its GSTR-1 is offered.
    const otherGstin=inventedGstin("ZZZPZ0003Z");
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[randomUUID(),firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,otherGstin),await crypto.blindIndex(firm.firmId,"gstin",otherGstin)]);
    await page.goto(outputs);await expect(page.getByRole("heading",{name:"Which GST number is each register for?"})).toBeVisible();
    const choice=page.locator("form").filter({has:page.locator(`a[href*="draft=${draft}"]`)}).filter({has:page.getByRole("combobox")});
    await choice.getByRole("combobox").selectOption({label:inventedGstin()});await choice.getByRole("button",{name:"Save",exact:true}).click();
    await expect(page.getByRole("heading",{name:`Prepare GSTR-1 for ${inventedGstin()}`})).toBeVisible();
    expect((await query(local.dbUrl,"select data->>'registration' registration from public.datasets where id=$1",[draft]))[0].registration).toBe(registration);
  } finally {
    await managerContext.close().catch(()=>{});
    for(const file of (await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId]))) if(file.drive_file_id) files.push(file.drive_file_id);
    for(const id of new Set(files)) await drive.trash(id).catch(()=>{});
    await firm.remove(managerEmail);
  }
});
