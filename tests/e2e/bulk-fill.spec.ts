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

// Fill all on the full list (/app/work, Returns): a preview of the GSTR-1 and GSTR-3B returns
// due in the next 7 days, Undo before any starts, then InboxCA's own fill makes one draft a
// return for a person to check. A filed return, one due later and one still missing its GSTR-2B
// are left alone; pressing again fills nothing twice; a manager sees only their team's clients.
// All names and numbers are invented.
test("Fill all: a preview, Undo before it starts, then one draft a return for a person to check",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const tag=randomUUID().slice(0,8),email=`fill-all-${tag}@invented.test`,key=appKey(),managerEmail=`fill-all-manager-${tag}@invented.test`,managerKey=appKey();
  const firm=await seedFirm(`Fill All Firm ${tag}`,email,key),crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),account=randomUUID();
  const managerContext=await browser.newContext();
  const names={mehta:`Invented Mehta Traders ${tag}`,shah:`Invented Shah Textiles ${tag}`,patel:`Invented Patel Foods ${tag}`,kapoor:`Invented Kapoor Steel ${tag}`};
  // A client with its GSTIN, its returns, and a sales register read into one sale whose taxable value is not checked yet.
  const values=[inventedGstin("ZZZPZ0001Z"),"Invented Recipient","INV/7","2026-09-12","236.00","24-Gujarat","N","","Regular B2B","","18.00","200.00","0.00"];
  const figures=async(draft:string,taxable:string)=>{
    const lines:Draft["lines"]=[];
    for(let column=0;column<values.length;column++) {
      const id=randomUUID(),value=column===11 ? taxable : values[column];
      if(value) lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value,kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:sources.get(draft)!,sha256:createHash("sha256").update(draft).digest("hex"),sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},...(column===11 ? {state:"pending" as const} : {state:"confirmed" as const,by:firm.ownerId,at:new Date().toISOString()})});
    }
    return {lines,checks:[]};
  };
  const sources=new Map<string,string>();
  const addClient=async(name:string,n:number,returns:[code:string,due:number,filed?:boolean][],read=true)=>{
    const client=randomUUID(),registration=randomUUID(),gstin=inventedGstin(`ZZZPZ000${n}Z`),draft=randomUUID(),source=randomUUID();
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,name]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
    for(const [code,due,filed] of returns) await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on,status,details) values($1,$2,$3,$4,'2026-09',(now() at time zone 'Asia/Kolkata')::date+$5::int,$6,$7)",[firm.firmId,client,registration,code,due,filed ? "filed" : "upcoming",filed ? {filed_on:"2026-10-11"} : {}]);
    if(read) {
      sources.set(draft,source);
      await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented sales register.csv',100,$4,$5)",[source,firm.firmId,client,createHash("sha256").update(draft).digest("hex"),`invented-${source}`]);
      await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,await figures(draft,"200.00")]);
    }
    return {client,draft};
  };
  const prepared="select client_id,name,prepared from public.documents where firm_id=$1 and prepared is not null order by name";
  const fills=async()=>(await query(local.dbUrl,"select state,last_error_code,attempts from public.jobs where firm_id=$1 and kind='fill_return' order by id",[firm.firmId])).map(row=>row.state+(row.last_error_code ? `:${row.last_error_code}:${row.attempts}` : ""));
  const toast=(text:string)=>page.getByRole("status").filter({hasText:text});
  try {
    const manager=await addPerson(firm.firmId,managerEmail,"manager",managerKey);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    // Due in 6 and 7 days: after the firm's 5 days, so InboxCA has not filled them by itself yet.
    const mehta=await addClient(names.mehta,2,[["GSTR1_M",6],["GSTR3B_M",6]]);
    const shah=await addClient(names.shah,3,[["GSTR1_M",7]]);
    await addClient(names.patel,4,[["GSTR1_M",3,true]],false);
    await addClient(names.kapoor,5,[["GSTR1_M",9]]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'manager')",[firm.firmId,shah.client,manager]);
    expect(await fills()).toEqual([]);

    // The manager's preview holds their team's client only.
    const other=await managerContext.newPage();await signIn(other,managerEmail,managerKey);
    await other.goto("/app/work?show=returns");await other.getByRole("link",{name:"Fill all returns due in the next 7 days"}).click();
    const theirs=other.getByRole("dialog",{name:"Fill returns due in the next 7 days"});
    await expect(theirs).toContainText("1 return for 1 client. 1 has figures still to check.");
    await expect(theirs.getByRole("listitem")).toHaveCount(1);await expect(theirs.getByRole("listitem")).toContainText(names.shah);

    await signIn(page,email,key);
    const open=async()=>{
      await page.goto("/app/work?show=returns");await page.getByRole("link",{name:"Fill all returns due in the next 7 days"}).click();
      return page.getByRole("dialog",{name:"Fill returns due in the next 7 days"});
    };
    let preview=await open();
    await expect(preview).toContainText("2 returns for 2 clients. 2 have figures still to check.");
    const row=(name:string,text:string)=>preview.getByRole("listitem").filter({hasText:name}).filter({hasText:text});
    await expect(row(names.mehta,"GSTR-1 for Sep 2026, due in 6 days. 1 figure to check")).toContainText("Will be filled");
    await expect(row(names.mehta,"GSTR-3B for Sep 2026, due in 6 days. Papers in, GSTR-2B still missing")).toContainText("Not ready");
    await expect(row(names.shah,"GSTR-1 for Sep 2026, due in 7 days")).toContainText("Will be filled");
    for(const name of [names.patel,names.kapoor]) await expect(preview.getByRole("listitem").filter({hasText:name})).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath("preview.png")});
    // Undo before anything starts: nothing is filled.
    await preview.getByRole("button",{name:"Fill 2 returns"}).click();
    await expect(toast("2 returns for 2 clients will be filled in a minute")).toBeVisible();
    await toast("will be filled in a minute").getByRole("button",{name:"Undo"}).click();
    await expect(toast("Stopped. No return will be filled.")).toBeVisible();
    expect(await fills()).toEqual(["cancelled","cancelled"]);

    // Again, and let them go now: one draft a return, each still to check and not approved.
    preview=await open();await preview.getByRole("button",{name:"Fill 2 returns"}).click();
    await expect(toast("will be filled in a minute")).toBeVisible();
    await query(local.dbUrl,"update public.jobs set run_at=now() where firm_id=$1 and kind='fill_return' and state='pending'",[firm.firmId]);
    await runJobs(page.request,firm.firmId);
    expect(await fills()).toEqual(["cancelled","cancelled","done","done"]);
    let forms=await query(local.dbUrl,prepared,[firm.firmId]);
    expect(forms.map(form=>[form.client_id,form.name,form.prepared.status,form.prepared.filled])).toEqual([
      [mehta.client,`${names.mehta} - GSTR-1 - Sep 2026 - v1 (to check).xlsx`,"draft",true],
      [shah.client,`${names.shah} - GSTR-1 - Sep 2026 - v1 (to check).xlsx`,"draft",true],
    ]);
    expect(await query(local.dbUrl,"select action,actor_id,details->>'returns' returns from public.activity_log where firm_id=$1 and action like 'fills.%' order by at",[firm.firmId])).toEqual([
      {action:"fills.asked",actor_id:firm.ownerId,returns:"2"},{action:"fills.stopped",actor_id:firm.ownerId,returns:"2"},{action:"fills.asked",actor_id:firm.ownerId,returns:"2"},
    ]);

    // Pressed again: nothing is filled twice.
    preview=await open();
    await expect(preview).toContainText("0 returns for 0 clients.");
    await expect(row(names.mehta,"GSTR-1")).toContainText("Filled already");await expect(row(names.shah,"GSTR-1")).toContainText("Filled already");
    await expect(preview.getByRole("button",{name:"Fill 0 returns"})).toBeDisabled();

    // A figure corrected after the fill: InboxCA fills the return again by itself, as its next version.
    await query(local.dbUrl,"update public.datasets set revision=2,data=$2 where id=$1",[mehta.draft,await figures(mehta.draft,"210.00")]);
    preview=await open();await expect(row(names.mehta,"GSTR-1")).toContainText("Being filled");
    await runJobs(page.request,firm.firmId);
    forms=await query(local.dbUrl,prepared,[firm.firmId]);
    expect(forms.filter(form=>form.client_id===mehta.client).map(form=>[form.name,form.prepared.status])).toEqual([
      [`${names.mehta} - GSTR-1 - Sep 2026 - v1 (to check).xlsx`,"draft"],[`${names.mehta} - GSTR-1 - Sep 2026 - v2 (to check).xlsx`,"draft"],
    ]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally {
    await managerContext.close().catch(()=>{});
    for(const file of await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1 and prepared is not null",[firm.firmId])) if(file.drive_file_id) await drive.trash(file.drive_file_id).catch(()=>{});
    await firm.remove(managerEmail);
  }
});
