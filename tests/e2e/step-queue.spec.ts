import {createHash,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect,type Page} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {inventedGstin} from "../fixtures/portal";
import {addPerson,appKey,localSupabase,query,runJobs,seedFirm,signIn} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// Work by step: Today counts the returns late or due in 30 days by the step each waits at, the
// owner's the whole firm's and a staff member's only their own client's; each count opens the
// Calendar at that step, its rows open the return's own page, and Fill all on Ready to prepare
// moves those returns on to Figures to check. All names and numbers are invented.
test("Work by step counts each step, opens it on the Calendar, and Fill all moves returns on",async({page,browser})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const tag=randomUUID().slice(0,8),email=`step-queue-${tag}@invented.test`,key=appKey(),staffEmail=`step-queue-staff-${tag}@invented.test`,staffKey=appKey();
  const firm=await seedFirm(`Step Queue Firm ${tag}`,email,key),crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),account=randomUUID();
  const names={ask:`Invented Ask Traders ${tag}`,one:`Invented Prepare One ${tag}`,two:`Invented Prepare Two ${tag}`,credit:`Invented Credit Foods ${tag}`,approve:`Invented Approve Steel ${tag}`,kyc:`Invented Kyc Director ${tag}`};
  const staffContext=await browser.newContext();
  // A client with its GSTIN and its returns: [code, period, due in days, filed].
  let n=0;
  const addClient=async(name:string,returns:[string,string,number,boolean?][])=>{
    const client=randomUUID(),registration=randomUUID(),gstin=inventedGstin(`ZZZPZ000${++n}Z`);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,name]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
    for(const [code,period,due,filed] of returns) await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on,status,details) values($1,$2,$3,$4,$5,(now() at time zone 'Asia/Kolkata')::date+$6::int,$7,$8)",[firm.firmId,client,registration,code,period,due,filed ? "filed" : "upcoming",filed ? {filed_on:"2026-10-11"} : {}]);
    return {client,registration};
  };
  // A sales register read into one invented sale, its taxable value still to check unless all are checked.
  const values=[inventedGstin("ZZZPZ0009Z"),"Invented Recipient","INV/9","2026-09-12","236.00","24-Gujarat","N","","Regular B2B","","18.00","200.00","0.00"];
  const register=async(client:string,checked=false)=>{
    const draft=randomUUID(),source=randomUUID(),sha256=createHash("sha256").update(draft).digest("hex"),lines:Draft["lines"]=[];
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented sales register.csv',100,$4,$5)",[source,firm.firmId,client,sha256,`invented-${source}`]);
    for(let column=0;column<values.length;column++) if(values[column]) {
      const id=randomUUID();
      lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},...(column===11 && !checked ? {state:"pending" as const} : {state:"confirmed" as const,by:firm.ownerId,at:new Date().toISOString()})});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);
    return draft;
  };
  const card=(on:Page)=>on.getByRole("navigation",{name:"Work by step"});
  const counts=async(on:Page,expected:Record<string,number>)=>{
    await on.goto("/app");
    for(const [step,count] of Object.entries(expected)) await expect(card(on).getByRole("link",{name:`${step}: ${count}`})).toBeVisible();
  };
  const listed=async(step:string,shown:string[])=>{
    await page.goto(`/app/calendar?step=${step}`);
    for(const name of shown) await expect(page.getByRole("row").filter({hasText:name})).toBeVisible();
    await expect(page.locator(".cal-table tbody tr")).toHaveCount(shown.length);
  };
  try {
    const staff=await addPerson(firm.firmId,staffEmail,"staff",staffKey);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    // Ask for papers: nothing in yet. Its GSTR-3B due in 40 days and a filed return are not counted.
    const ask=await addClient(names.ask,[["GSTR1_M","2026-09",6],["GSTR3B_M","2026-10",40],["GSTR1_M","2026-08",-20,true]]);
    await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'staff')",[firm.firmId,ask.client,staff]);
    // Ready to prepare: two GSTR-1s with their sales register read, due in 6 and 7 days (after
    // the firm's 5, so InboxCA has not filled them by itself).
    for(const [name,due] of [[names.one,6],[names.two,7]] as const) await register((await addClient(name,[["GSTR1_M","2026-09",due]])).client);
    // Figures to check: a GSTR-3B with its sales register but no GSTR-2B yet.
    await register((await addClient(names.credit,[["GSTR3B_M","2026-09",6]])).client);
    // Waiting approval: a GSTR-1 with every figure checked and its draft made.
    const approve=await addClient(names.approve,[["GSTR1_M","2026-09",8]]),checked=await register(approve.client,true);
    await query(local.dbUrl,"insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,prepared) values($1,$2,'gst','GSTR-1','2026-09','Invented GSTR-1 draft.xlsx',100,$3,$4,$5)",[firm.firmId,approve.client,createHash("sha256").update(checked).digest("hex"),`invented-${checked}`,{form:"GSTR1",registration:approve.registration,version:1,template:"invented",sources:[{id:checked,revision:1}],status:"draft"}]);
    // Ready to file: a DIR-3 KYC whose papers are in; it has no draft to prepare.
    const kyc=await addClient(names.kyc,[["DIR3KYC","2026",5]]);
    await query(local.dbUrl,"insert into public.requests(firm_id,client_id,kind,entity_type,entity_id,status,expires_at,details) values($1,$2,'documents','client',gen_random_uuid(),'done',now()+interval '7 days',$3)",[firm.firmId,kyc.client,{period:"2026",items:[]}]);

    await signIn(page,email,key);
    await counts(page,{"Ask for papers":1,"Ready to prepare":2,"Figures to check":1,"Waiting approval":1,"Ready to file":1});
    // A staff member sees only the client they look after.
    const other=await staffContext.newPage();await signIn(other,staffEmail,staffKey);
    await counts(other,{"Ask for papers":1,"Ready to prepare":0,"Figures to check":0,"Waiting approval":0,"Ready to file":0});

    // Each count opens its step on the Calendar, and a row opens the return's own page.
    await card(page).getByRole("link",{name:"Ready to prepare: 2"}).click();
    await expect(page).toHaveURL(/\/app\/calendar\?step=prepare$/);
    await listed("prepare",[names.one,names.two]);
    await listed("ask",[names.ask]);await listed("check",[names.credit]);await listed("file",[names.kyc]);
    await listed("approve",[names.approve]);
    await page.getByRole("row").filter({hasText:names.approve}).getByRole("link",{name:names.approve,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${approve.client}/returns/`));

    // Fill all from Ready to prepare: both are filled and wait at Figures to check.
    await page.goto("/app/calendar?step=prepare");
    await page.getByRole("link",{name:"Fill all due in 7 days"}).click();
    await page.getByRole("dialog",{name:"Fill returns late or due in the next 7 days"}).getByRole("button",{name:"Fill 2 returns"}).click();
    await expect(page.getByRole("status").filter({hasText:"will be filled in a minute"})).toBeVisible();
    await query(local.dbUrl,"update public.jobs set run_at=now() where firm_id=$1 and kind='fill_return' and state='pending'",[firm.firmId]);
    await runJobs(page.request,firm.firmId);
    await listed("check",[names.credit,names.one,names.two]);
    await listed("prepare",[]);
    await counts(page,{"Ready to prepare":0,"Figures to check":3});
    for(const width of [1280,1512]) {
      await page.setViewportSize({width,height:760});
      for(const path of ["/app","/app/calendar?step=check"]) {await page.goto(path);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
    }
  } finally {
    await staffContext.close().catch(()=>{});
    for(const file of await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1 and prepared is not null and drive_file_id not like 'invented-%'",[firm.firmId])) if(file.drive_file_id) await drive.trash(file.drive_file_id).catch(()=>{});
    await firm.remove(staffEmail);
  }
});
