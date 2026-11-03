import {createHash,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect,type Page} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {itrFieldName} from "@/src/lib/itr-fields";
import {inventedGstin} from "../fixtures/portal";
import {addPerson,appKey,localSupabase,query,seedFirm,signIn} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");
test.describe.configure({mode:"serial",timeout:120_000});

// GST month end across clients, the ITR computation sheet, and Set services or Assign for every
// client a list matches. One invented firm: an owner, and a staff member who looks after one
// client only. All names and numbers are invented.
const tag=randomUUID().slice(0,8),ownerEmail=`gst-month-${tag}@invented.test`,ownerKey=appKey(),staffEmail=`gst-month-staff-${tag}@invented.test`,staffKey=appKey();
const names={mehta:`Invented Mehta Traders ${tag}`,shah:`Invented Shah Textiles ${tag}`,person:`Invented Salaried Person ${tag}`};
let firm:Awaited<ReturnType<typeof seedFirm>>,owner:Page,crypto:ReturnType<typeof serverCrypto>;
const clients:Record<string,string>={};

test.beforeAll(async({browser})=>{
  loadEnvConfig(process.cwd());crypto=serverCrypto();
  firm=await seedFirm(`GST Month Firm ${tag}`,ownerEmail,ownerKey);
  owner=await (await browser.newContext()).newPage();
  await signIn(owner,ownerEmail,ownerKey);
});
test.afterAll(()=>firm.remove(staffEmail));

// A GST client with its September returns; Mehta's sales register is read into one checked B2B sale.
async function gstClient(name:string,n:number,tags:string[],withRegister:boolean) {
  const client=randomUUID(),registration=randomUUID(),gstin=inventedGstin(`ZZZPZ000${n}Z`);
  await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind,tags) values($1,$2,$3,'business',$4)",[client,firm.firmId,name,tags]);
  await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
  for(const [code,due] of [["GSTR1_M","2026-10-11"],["GSTR3B_M","2026-10-20"]]) await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,$4,'2026-09',$5)",[firm.firmId,client,registration,code,due]);
  if(withRegister) {
    const draft=randomUUID(),source=randomUUID(),sha256=createHash("sha256").update(draft).digest("hex");
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented sales register.csv',100,$4,$5)",[source,firm.firmId,client,sha256,`invented-${source}`]);
    const values=[inventedGstin("ZZZPZ0009Z"),"Invented Recipient","INV/7","2026-09-12","236.00","24-Gujarat","N","","Regular B2B","","18.00","200.00","0.00"],lines:Draft["lines"]=[];
    for(let column=0;column<values.length;column++) {
      if(!values[column]) continue;
      const id=randomUUID();
      lines.push({id,field:`b2b.r2.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}2`,page:1},state:"confirmed",by:firm.ownerId,at:new Date().toISOString()});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);
  }
  return client;
}

test("GST month end: every client's month in one list, by tag, with GSTR-1 by rate; staff in a restricted firm see their own clients only",async({browser})=>{
  clients.mehta=await gstClient(names.mehta,2,["priority"],true);
  clients.shah=await gstClient(names.shah,3,[],false);
  const staff=await addPerson(firm.firmId,staffEmail,"staff",staffKey);
  await query(local.dbUrl,"insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'staff')",[firm.firmId,clients.shah,staff]);

  await owner.goto("/app/work");
  await owner.getByRole("link",{name:"GST month end"}).click();
  await owner.getByLabel("Month",{exact:true}).selectOption("2026-09");
  await owner.getByRole("button",{name:"Show"}).click();
  const row=(name:string)=>owner.getByRole("row").filter({hasText:name});
  // Mehta's papers are in and checked, its GSTR-1 waits to be prepared and its GSTR-3B for the GSTR-2B; Shah has nothing yet.
  await expect(row(names.mehta).getByRole("cell").nth(1)).toHaveText("In");
  await expect(row(names.mehta)).toContainText("Checked, not prepared");
  await expect(row(names.mehta).getByRole("cell").nth(5)).toHaveText("Waiting for GSTR-2B");
  await expect(row(names.shah)).toContainText("Not asked for");
  await expect(row(names.shah)).toContainText("Missing");
  await expect(row(names.shah).getByRole("link",{name:"Add GSTR-2B"})).toBeVisible();
  // The checked sale, added up by rate.
  await row(names.mehta).getByRole("link",{name:"Rates"}).click();
  const rates=owner.getByRole("dialog",{name:`GSTR-1 by rate, ${names.mehta}`});
  await expect(rates.getByRole("row").filter({hasText:"18%"})).toContainText("200.00");
  // Only the tagged client.
  await owner.goto("/app/work/gst?period=2026-09&tag=priority");
  await expect(row(names.mehta)).toBeVisible();
  await expect(row(names.shah)).toHaveCount(0);
  await expect(owner.getByText("Showing 1 to 1 of 1 clients")).toBeVisible();
  // In a firm that limits clients, a staff member sees the client they look after, and no other.
  await query(local.dbUrl,"update public.firms set settings=settings||'{\"client_visibility\":\"restricted\"}' where id=$1",[firm.firmId]);
  const page=await (await browser.newContext()).newPage();
  await signIn(page,staffEmail,staffKey);
  await page.goto("/app/work/gst?period=2026-09");
  await expect(page.getByRole("row").filter({hasText:names.shah})).toBeVisible();
  await expect(page.getByRole("row").filter({hasText:names.mehta})).toHaveCount(0);
  await page.context().close();
});

test("the computation sheet adds up checked income and deductions beside the return's own figures, and says tax is not available",async()=>{
  const client=randomUUID(),registration=randomUUID(),account=randomUUID(),draft=randomUUID(),pan="ZZZPZ0002Z"; // ggignore: invented PAN.
  await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'individual')",[client,firm.firmId,names.person]);
  await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'pan',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/pan`,pan),await crypto.blindIndex(firm.firmId,"pan",pan)]);
  await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Invented drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
  // Three heads and the deductions, checked; the return's own gross total agrees and its total income does not; one figure still to check.
  const figures:[string,string,boolean][]=[["itr.salary.income","350000",true],["itr.house_property.income","50000",true],["itr.other_sources.income","10000",true],["itr.deductions.total","10000",true],[itrFieldName("ITR1","ITR1_IncomeDeductions.GrossTotIncome"),"410000",true],[itrFieldName("ITR1","ITR1_IncomeDeductions.TotalIncome"),"390000",true],["itr.tds.total","20000",false]];
  const lines:Draft["lines"]=[];
  for(const [field,value,checked] of figures) {
    const id=randomUUID();
    lines.push({id,field,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:field,value,kind:"number"})),source:{entered_by:firm.ownerId,entered_at:new Date().toISOString()},...(checked ? {state:"confirmed",by:firm.ownerId,at:new Date().toISOString()} : {state:"pending"})});
  }
  await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[draft,firm.firmId,client,{target:{form:"ITR1",version:"1.1"},lines,checks:[]}]);

  await owner.goto(`/app/clients/${client}/itr?form=ITR1&year=2026`);
  await owner.getByRole("link",{name:"Computation sheet"}).click();
  const sheet=owner.locator(".computation");
  await expect(owner.getByText("Working sheet for the CA to check")).toBeVisible();
  await expect(sheet.getByText("1 figure is not checked yet")).toBeVisible();
  const line=(label:string)=>sheet.getByRole("listitem").filter({hasText:label});
  await expect(line("Gross total income, added up by InboxCA")).toContainText("4,10,000");
  await expect(line("Gross total income, added up by InboxCA")).toContainText("the same");
  await expect(line("Taxable income, worked out by InboxCA")).toContainText("4,00,000");
  await expect(line("Taxable income, worked out by InboxCA")).toContainText("These differ");
  // AY 2026-27 falls under the 1961 Act, whose s.115BAC(1A) rates InboxCA has not read: no tax figure.
  await expect(sheet.getByText(/Not available for AY 2026-27/)).toBeVisible();
  await expect(sheet).not.toContainText(/Tax payable[^\n]*₹/);
});

test("Set services and Assign for every client the list matches, with the count shown first",async()=>{
  const word=`bulk${tag}`,made:string[]=[];
  for(let n=1;n<=3;n++) {
    const client=randomUUID(),registration=randomUUID(),gstin=inventedGstin(`ZZZPZ00${n}0Z`);
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind,tags) values($1,$2,$3,'business',$4)",[client,firm.firmId,`Invented Bulk Client ${n} ${tag}`,[word]]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
    made.push(client);
  }
  await owner.goto(`/app/clients?tag=${word}`);
  await owner.getByLabel(`Choose Invented Bulk Client 1 ${tag}`,{exact:true}).check();
  // The bar offers the whole list, and the panel says how many before anything is saved.
  await owner.getByRole("link",{name:"Assign all 3"}).click();
  const assign=owner.getByRole("dialog",{name:"Assign"});
  await expect(assign).toContainText("For all 3 clients on this list");
  await assign.getByLabel("Who").selectOption({label:"Gst (you)"});
  await assign.getByLabel("As").selectOption("partner_in_charge");
  await assign.getByRole("button",{name:"Assign to 3 clients"}).click();
  await expect(owner.getByText(/^Assigned 3 clients\./)).toBeVisible();
  expect((await query(local.dbUrl,"select count(*)::int as n from public.client_assignments where firm_id=$1 and client_id=any($2) and user_id=$3 and role='partner_in_charge'",[firm.firmId,made,firm.ownerId]))[0].n).toBe(3);
  // Set services for all 3: each GST number gets the ticked return.
  await owner.getByLabel(`Choose Invented Bulk Client 2 ${tag}`,{exact:true}).check();
  await owner.getByRole("link",{name:"Set services for all 3"}).click();
  const set=owner.getByRole("dialog",{name:"Set services"});
  await expect(set).toContainText("For all 3 clients on this list");
  await set.getByRole("checkbox",{name:/^GSTR-3B \(monthly\)/}).check();
  await set.getByRole("button",{name:"Add services to 3 clients"}).click();
  await expect(owner.getByText(/^Services added for 3 clients/)).toBeVisible();
  expect((await query(local.dbUrl,"select count(*)::int as n from public.client_registrations where firm_id=$1 and client_id=any($2) and 'GSTR3B_M'=any(services)",[firm.firmId,made]))[0].n).toBe(3);
});
