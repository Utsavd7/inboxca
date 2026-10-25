import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";
import Ajv from "ajv";
import draft4 from "ajv/lib/refs/json-schema-draft-04.json";
import {loadEnvConfig} from "@next/env";
import {test,expect,type Page} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {place,type Draft} from "@/src/lib/datasets";
import {localDrive} from "@/src/lib/drive";
import {itrFieldName} from "@/src/lib/itr-fields";
import {itrRequest} from "../fixtures/itr";
import {pdf} from "../fixtures/pdf";
import {emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

const pan="ZZZPZ0001Z",key=()=>Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join(""); // ggignore: invented PAN.
type Figure={label:string;value:string;kind?:"number"|"text"|"date"};
// The pinned official schema, checked here as the file worker checks it.
const officialSchema=(file:string)=>{const ajv=new Ajv({schemaId:"auto",allErrors:true,extendRefs:true,logger:false});ajv.addMetaSchema(draft4);return ajv.compile(JSON.parse(readFileSync(`reference/official/${file}`,"utf8")));};
async function seedClient(name:string,email:string) {
  const secret=key(),owner=`itr-${randomUUID()}@invented.test`,firm=await seedFirm(name,owner,secret),client=randomUUID(),registration=randomUUID(),account=randomUUID(),crypto=serverCrypto();
  await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind,email_enc,email_bidx) values($1,$2,'Invented ITR Person','individual',$3,$4)",[client,firm.firmId,await crypto.encrypt(firm.firmId,`clients/${client}/email`,email),await crypto.blindIndex(firm.firmId,"email",email)]);
  await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'pan',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/pan`,pan),await crypto.blindIndex(firm.firmId,"pan",pan)]);
  await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Invented drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
  return {firm,owner,secret,client,registration,crypto};
}
async function signIn(page:Page,email:string,secret:string) {
  await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(secret));await page.getByRole("button",{name:"Continue",exact:true}).click();await expect(page).toHaveURL(/\/app$/);
}
// Lines as a reader or a person would save them; checked ones carry who checked them.
async function lines(firm:string,draft:string,figures:[string,Figure][],source:Draft["lines"][number]["source"],checkedBy?:string) {
  const out:Draft["lines"]=[];
  for(const [field,figure] of figures) {const id=randomUUID();out.push({id,field,value_enc:await serverCrypto().encrypt(firm,place(draft,id),JSON.stringify(figure)),source,state:checkedBy ? "confirmed" : "pending",...(checkedBy && {by:checkedBy,at:new Date().toISOString()})});}
  return out;
}

// M6 ITR acceptance: a client with Form 16 figures becomes an approved ITR-1 file, filed.
test("Form 16 figures, client details and entered details become an approved ITR-1 JSON download",async({page})=>{
  test.setTimeout(240_000);loadEnvConfig(process.cwd());
  const {firm,owner,secret,client,registration}=await seedClient("Invented ITR Browser Firm","invented.person@invented.test");
  const drive=localDrive(TEST_DRIVE),form16=randomUUID(),paper=randomUUID(),request=itrRequest("ITR1");
  const field=(path:string)=>itrFieldName("ITR1",path);
  try {
    // Form 16 already in Documents, with its figures already read (as a reader saves them).
    const bytes=Buffer.from(pdf("Invented Form 16 for FY 2025-26")),sha256=createHash("sha256").update(bytes).digest("hex");
    const saved=await drive.save(await drive.ensureFolder([firm.firmId,"Income tax"]),"Invented Form 16.pdf",bytes);if(saved==="taken") throw new Error("Test collision");
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'income_tax','Form 16','2026','Invented Form 16.pdf',$4,$5,$6)",[form16,firm.firmId,client,bytes.length,sha256,saved.id]);
    const fromForm16:[string,Figure][]=[["itr.salary.gross",{label:"Gross salary",value:"600000",kind:"number"}],[field("ITR1_IncomeDeductions.NetSalary"),{label:"Net salary",value:"600000",kind:"number"}],[field("ITR1_IncomeDeductions.DeductionUs16"),{label:"Deductions under section 16",value:"75000",kind:"number"}],["itr.salary.income",{label:"Income from salary",value:"525000",kind:"number"}],
      ["itr.tds.salary.0.tan",{label:"Employer's TAN",value:"HYDZ99999Z",kind:"text"}],["itr.tds.salary.0.name",{label:"Employer's name",value:"Invented Employer",kind:"text"}],["itr.tds.salary.0.income",{label:"Salary on the tax statement",value:"525000",kind:"number"}],["itr.tds.salary.0.deducted",{label:"TDS on salary",value:"5000",kind:"number"}]]; // ggignore: invented employer TAN.
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[paper,firm.firmId,client,{lines:await lines(firm.firmId,paper,fromForm16,{document:form16,sha256,page:1}),checks:[]}]);
    await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'ITR_NA','2026-03','2026-07-31')",[firm.firmId,client,registration]);
    await signIn(page,owner,secret);
    // Check the Form 16 figures beside the Form 16 page.
    await page.goto(`/app/clients/${client}?tab=returns`);await page.getByRole("link",{name:"Figures",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Income tax return"})).toBeVisible();
    await page.goto(`/app/clients/${client}?tab=extraction&draft=${paper}`);
    await expect(page.getByRole("link",{name:"Income tax AY 2026-27"})).toHaveAttribute("aria-current","page");
    for(let n=0;n<fromForm16.length;n++) {await expect(page.getByText("Invented Form 16.pdf. Page 1")).toBeVisible();await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByText(`${n+1} of ${fromForm16.length} confirmed`)).toBeVisible();}
    // The return: PAN and Form 16 are already filled; the rest is listed to fill.
    await page.goto(`/app/clients/${client}/itr`);
    const held=page.getByRole("region",{name:"Already filled"});await expect(held).toContainText(`PAN ${pan}`);await expect(held).toContainText("Invented Form 16.pdf");await expect(held).toContainText("8 figures, 8 checked");
    const toFill=page.getByRole("region",{name:"Still to fill"});await expect(toFill.getByLabel(/details still to fill/)).toBeVisible();
    await page.screenshot({path:test.info().outputPath("itr.png"),fullPage:true});
    await page.getByRole("link",{name:/^Client details: \d+$/}).click();
    await expect(page.getByLabel(/^Email address/)).toHaveValue("invented.person@invented.test");
    await page.getByRole("button",{name:"Save for checking",exact:true}).click();await expect(page.getByRole("status")).toContainText("Saved for checking");
    await page.getByRole("link",{name:/^Taxes paid: \d+$/}).click();
    await page.getByLabel(/^Total TDS claimed/).fill("5000");await page.getByLabel(/^Taxes Paid · Total Taxes Paid/).fill("5000");
    await page.getByRole("button",{name:"Save, putting 0 in the 6 empty amounts",exact:true}).click();await expect(page.getByRole("status")).toContainText("Saved for checking");
    // The 4 amounts left empty were saved as 0, and the log says so.
    expect((await query(local.dbUrl,"select details->>'zeroed' zeroed from public.activity_log where firm_id=$1 and action='dataset.changed' and details ? 'zeroed'",[firm.firmId])).map(row=>row.zeroed)).toEqual(["4"]);
    const [own]=await query(local.dbUrl,"select * from public.datasets where firm_id=$1 and data->'target'->>'form'='ITR1'",[firm.firmId]);
    expect(own.data.lines.map((line:Draft["lines"][number])=>[line.field,line.state,line.source.entered_by])).toEqual(expect.arrayContaining([["itr.personal.email","pending",firm.ownerId],["itr.advance_tax.total","pending",firm.ownerId],["itr.self_assessment_tax.total","pending",firm.ownerId]]));
    // The other required details, as the CA would enter them, already checked (invented values).
    const values:Record<string,string>={[field("ITR1_IncomeDeductions.GrossTotIncome")]:"525000",[field("ITR1_IncomeDeductions.GrossTotIncomeIncLTCG112A")]:"525000",[field("ITR1_IncomeDeductions.TotalIncome")]:"525000",[field("Refund.RefundDue")]:"5000"};
    const have=new Set([...fromForm16.map(([name])=>name),...own.data.lines.map((line:Draft["lines"][number])=>line.field)]);
    const rest:[string,Figure][]=[...request.drafts[0].figures.filter(([name])=>!have.has(name)).map(([name,figure])=>[name,{...figure,value:values[name] ?? figure.value}] as [string,Figure]),[field("TDSonSalaries.TotalTDSonSalaries"),{label:"Total TDS on salaries",value:"5000",kind:"number"}]];
    await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',data->'lines'||$2::jsonb) where id=$1",[own.id,JSON.stringify(await lines(firm.firmId,own.id,rest,{entered_by:firm.ownerId,entered_at:new Date().toISOString()},firm.ownerId))]);
    await page.goto(`/app/clients/${client}?tab=extraction&draft=${own.id}`);
    await expect(page.getByText(/^Entered by /)).toBeVisible();
    const pending=own.data.lines.length;expect(pending).toBe(7);
    for(let n=0;n<pending;n++) {await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByText(`${rest.length+n+1} of ${rest.length+pending} confirmed`)).toBeVisible();}
    await page.goto(`/app/clients/${client}/itr`);await expect(page.getByText("Nothing left to fill.")).toBeVisible();
    // Prepared forms: the approved file is in Prepared, downloaded once and logged.
    await page.goto(`/app/clients/${client}?tab=outputs`);
    const prepare=page.locator("form").filter({has:page.getByRole("group",{name:"ITR-1 AY 2026-27",exact:true})});
    await page.screenshot({path:test.info().outputPath("itr-prepare.png"),fullPage:true});
    await expect(prepare).toContainText("Invented Form 16.pdf");await prepare.getByRole("button",{name:"Prepare ITR-1 AY 2026-27"}).click();await expect(page).toHaveURL(/\/files\/.*\/view/);
    let [prepared]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='ITR1'",[firm.firmId]);
    expect(prepared.prepared.status).toBe("approved");expect(prepared.name).toBe("Invented ITR Person - ITR-1 - AY 2026-27 - v1.json");expect(prepared.drive_file_id).toContain("Income tax/");expect(prepared.drive_file_id).toContain("/Prepared/");
    expect(prepared.prepared.sources.map((source:{id:string})=>source.id).sort()).toEqual([own.id,paper].sort());
    expect((await page.request.get(`/app/files/${prepared.id}`)).status()).toBe(404);
    await page.goto(`/app/clients/${client}?tab=outputs`);let row=page.locator("li").filter({has:page.getByRole("link",{name:prepared.name,exact:true})});
    const download=page.waitForEvent("download");await row.getByRole("button",{name:"Download for filing"}).click();const file=await download;
    const output=JSON.parse(await readFile((await file.path())!,"utf8")),validate=officialSchema(request.template.source.file);
    expect(validate(output),JSON.stringify(validate.errors)).toBe(true);
    expect(output.ITR.ITR1.PersonalInfo).toMatchObject({PAN:pan,Address:{EmailAddress:"invented.person@invented.test"}});expect(output.ITR.ITR1.ITR1_IncomeDeductions.GrossSalary).toBe(600000);
    expect(output.ITR.ITR1.TDSonSalaries.TDSonSalary[0]).toMatchObject({EmployerOrDeductorOrCollectDetl:{TAN:"HYDZ99999Z"},TotalTDSSal:5000}); // ggignore: invented employer TAN.
    expect(output.ITR.ITR1.CreationInfo.SWCreatedBy).toBe("SW00000000"); // ggignore: the invented test software ID.
    expect((await page.request.get(file.url())).status()).toBe(410);
    expect((await query(local.dbUrl,"select count(*)::int n from public.activity_log where firm_id=$1 and action='form.downloaded'",[firm.firmId]))[0].n).toBe(1);
    // Documents shows it like any prepared GST form.
    await page.goto("/app/documents?year=2025-26&kind=income_tax");await expect(page.getByText(prepared.name).first()).toBeVisible();await expect(page.getByText("Prepared in InboxCA").first()).toBeVisible();
    // A change after approval clears it; the next check makes v2.
    const line=own.data.lines.find((item:Draft["lines"][number])=>item.field==="itr.personal.email");
    await page.goto(`/app/clients/${client}?tab=extraction&draft=${own.id}&line=${line.id}`);
    await page.getByLabel("Correct figure").fill("invented.second@invented.test");await page.getByLabel("Why it changed").fill("Invented correction for the filing test");await page.getByRole("button",{name:"Save correction",exact:true}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    expect((await query(local.dbUrl,"select public.form_ready($1) ready",[prepared.id]))[0].ready).toBe(false);
    // A correction clears the draft's checks; the other figures are checked again here directly.
    await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',(select jsonb_agg(case when l->>'id'=$2 then l else l||jsonb_build_object('state','confirmed','by',$3::text,'at',$4::text) end) from jsonb_array_elements(data->'lines') l)) where id=$1",[own.id,line.id,firm.ownerId,new Date().toISOString()]);
    await page.reload();await page.getByRole("button",{name:"Yes, this is right"}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select count(*)::int n from public.documents where firm_id=$1 and prepared->>'form'='ITR1' and prepared->>'version'='2' and size>0",[firm.firmId]))[0].n,{timeout:30_000}).toBe(1);
    [prepared]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='ITR1' and prepared->>'version'='2'",[firm.firmId]);
    await page.goto(`/app/clients/${client}?tab=outputs`);row=page.locator("li").filter({has:page.getByRole("link",{name:prepared.name,exact:true})});
    await row.getByText("Record filing",{exact:true}).click();await row.getByLabel("Acknowledgement number, if known").fill("INVENTED-ITR-ACK");await row.getByRole("button",{name:"Mark filed",exact:true}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select prepared->>'status' status from public.documents where id=$1",[prepared.id]))[0].status).toBe("filed");
    expect((await query(local.dbUrl,"select status from public.tasks where firm_id=$1 and code='ITR_NA'",[firm.firmId]))[0].status).toBe("filed");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally {
    for(const item of await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId])) if(item.drive_file_id) await drive.trash(item.drive_file_id).catch(()=>{});
    await firm.remove();
  }
});

test("ITR-2, ITR-3 and ITR-4 are prepared from checked figures, and a return corrected outside is checked again",async({page})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const {firm,owner,secret,client}=await seedClient("Invented ITR Forms Firm","invented.forms@invented.test"),drive=localDrive(TEST_DRIVE);
  try {
    await signIn(page,owner,secret);
    for(const form of ["ITR2","ITR3","ITR4"]) {
      // Fully checked invented figures; the file is built from them and the client's PAN only.
      const request=itrRequest(form),id=randomUUID(),name=form.replace("ITR","ITR-");
      await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[id,firm.firmId,client,{target:{form,version:request.template.version},lines:await lines(firm.firmId,id,request.drafts[0].figures,{entered_by:firm.ownerId,entered_at:new Date().toISOString()},firm.ownerId),checks:[]}]);
      await page.goto(`/app/clients/${client}/itr?form=${form}`);await expect(page.getByText("Nothing left to fill.")).toBeVisible();
      await page.goto(`/app/clients/${client}?tab=outputs`);
      await page.locator("form").filter({has:page.getByRole("group",{name:`${name} AY 2026-27`,exact:true})}).getByRole("button",{name:`Prepare ${name} AY 2026-27`}).click();await expect(page).toHaveURL(/\/files\/.*\/view/);
      const [saved]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'=$2",[firm.firmId,form]);
      expect(saved.prepared.status).toBe("approved");expect(saved.document_type).toBe(name);
      const output=JSON.parse(Buffer.from(await drive.read(saved.drive_file_id)).toString()),validate=officialSchema(request.template.source.file);
      expect(validate(output),JSON.stringify(validate.errors)).toBe(true);
      if(form!=="ITR4") continue;
      // The fallback: a return corrected in another tool is a new version whose figures wait for checks.
      output.ITR.ITR4.Verification.Declaration.FatherName="Invented Edited Father";
      await page.goto(`/app/clients/${client}?tab=outputs`);const row=page.locator("li").filter({has:page.getByRole("link",{name:saved.name,exact:true})});
      await row.getByText("File corrected outside InboxCA",{exact:true}).click();await row.getByLabel("Official return file",{exact:true}).setInputFiles({name:"invented-correction.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(output))});await row.getByRole("button",{name:"Add corrected version"}).click();await expect(page).toHaveURL(/tab=extraction&draft=/);
      const [external]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='ITR4' and prepared->>'external'='true'",[firm.firmId]);
      expect(external.prepared.status).toBe("draft");expect(external.prepared.version).toBe(2);
      const [edited]=await query(local.dbUrl,"select data from public.datasets where id=$1",[external.prepared.sources[0].id]);
      expect(edited.data.lines.every((line:Draft["lines"][number])=>line.state==="pending" && line.source.document===external.id && line.source.path)).toBe(true);
      await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
      expect((await query(local.dbUrl,"select public.form_ready($1) ready",[external.id]))[0].ready).toBe(false);
    }
  } finally {
    for(const item of await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId])) if(item.drive_file_id) await drive.trash(item.drive_file_id).catch(()=>{});
    await firm.remove();
  }
});
