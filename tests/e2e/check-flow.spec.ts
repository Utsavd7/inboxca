import {createHash,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect,type Page} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {place,type Draft} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {inventedGstin} from "../fixtures/portal";
import {appKey,localSupabase,query,seedFirm,signIn} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// Filing season checks, on invented data only: a register with no total row is confirmed by
// InboxCA's own sum against the firm's books, and Next goes from one return's Check step to the
// next one waiting, in the Calendar's order, until nothing else is left.
const now=(page:Page)=>page.getByRole("navigation",{name:"Steps of this return"}).locator(".is-now");
async function setUp(name:string) {
  const email=`check-flow-${randomUUID()}@invented.test`,key=appKey(),firm=await seedFirm(name,email,key),crypto=serverCrypto();
  let n=0;
  // A client with its GSTIN, a GSTR-1 due in some days, and its sales register read into B2B
  // rows (no total row); pending: the columns of each row still to check.
  const addReturn=async(client:string,due:number,rows:string[][],pending:(column:number)=>boolean)=>{
    const registration=randomUUID(),gstin=inventedGstin(`ZZZPZ000${++n}Z`),draft=randomUUID(),source=randomUUID(),sha256=createHash("sha256").update(draft).digest("hex"),lines:Draft["lines"]=[];
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,$3,'business')",[client,firm.firmId,`${name} client ${randomUUID().slice(0,8)}`]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'gstin',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
    const [{id:task}]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+$4::int) returning id",[firm.firmId,client,registration,due]);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'gst','Sales register','2026-09','Invented sales register.csv',100,$4,$5)",[source,firm.firmId,client,sha256,`invented-${source}`]);
    for(const [n,values] of rows.entries()) for(let column=0;column<values.length;column++) if(values[column]) {
      const id=randomUUID();
      lines.push({id,field:`b2b.r${n+2}.c${column}`,value_enc:await crypto.encrypt(firm.firmId,place(draft,id),JSON.stringify({label:salesSections.b2b.headings[column],value:values[column],kind:column===3 ? "date" : [4,10,11,12].includes(column) ? "number" : "text"})),source:{document:source,sha256,sheet:1,cell:`${String.fromCharCode(65+column)}${n+2}`,page:1},...(pending(column) ? {state:"pending" as const} : {state:"confirmed" as const,by:firm.ownerId,at:new Date().toISOString()})});
    }
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm.firmId,client,{lines,checks:[]}]);
    return {task,draft,registration,client:(await query(local.dbUrl,"select name from public.clients where id=$1",[client]))[0].name as string};
  };
  return {firm,email,key,addReturn};
}
const sale=(number:string,value:string,taxable:string)=>[inventedGstin("ZZZPZ0002Z"),"Invented Recipient",number,"2026-09-12",value,"24-Gujarat","N","","Regular B2B","","18.00",taxable,"0.00"];

test("a register section with no total row is confirmed by InboxCA's sum of its rows",async({page})=>{
  test.setTimeout(120_000);loadEnvConfig(process.cwd());
  const {firm,email,key,addReturn}=await setUp("Check Sum Browser Firm"),client=randomUUID();
  try {
    const one=await addReturn(client,10,[sale("INV/1","118.00","100.00"),sale("INV/2","236.50","200.50")],()=>true);
    await signIn(page,email,key);
    await page.goto(`/app/clients/${client}/returns/${one.task}?step=figures`);
    const section=page.getByRole("region",{name:"B2B section"});
    await expect(section).toContainText("InboxCA's sum of the 2 rows");await expect(section).toContainText("300.50");
    // Doesn't match opens the rows, one by one.
    await section.getByRole("link",{name:"Doesn't match"}).click();
    await expect(page).toHaveURL(/view=list/);await expect(page.getByRole("button",{name:"Yes, this is right"})).toBeVisible();
    await page.goto(`/app/clients/${client}/returns/${one.task}?step=figures`);
    await section.getByRole("button",{name:"Matches my books"}).click();
    await expect(page.getByRole("status")).toContainText("Your check was saved");
    const [{data,revision}]=await query(local.dbUrl,"select data,revision from public.datasets where id=$1",[one.draft]);
    expect(revision).toBe(2);
    expect(data.lines.every((line:{state:string;by:string})=>line.state==="confirmed" && line.by===firm.ownerId)).toBe(true);
    // Logged as the totals check is, with the sums the person confirmed.
    const [log]=await query(local.dbUrl,"select details from public.activity_log where firm_id=$1 and action='dataset.checked'",[firm.firmId]);
    expect(log.details).toMatchObject({section:"b2b",rows:2,flagged:0});
    expect(JSON.parse(await serverCrypto().decrypt(firm.firmId,`${place(one.draft,"b2b")}/totals/1`,log.details.totals_enc)).sums).toEqual([["Invoice Value","35450"],["Taxable Value","30050"],["Cess Amount","0"]]);
  } finally {
    await firm.remove();
  }
});

test("Next goes from one return's Check step to the next, then says nothing else is left",async({page})=>{
  test.setTimeout(120_000);loadEnvConfig(process.cwd());
  const {firm,email,key,addReturn}=await setUp("Check Next Browser Firm");
  try {
    // Two GSTR-1s filled, each with one figure still to check: due in 6 days, then 7.
    const returns=[];
    for(const due of [6,7]) {
      const client=randomUUID(),made=await addReturn(client,due,[sale("INV/9","236.00","200.00")],column=>column===11);
      await query(local.dbUrl,"insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,prepared) values($1,$2,'gst','GSTR-1','2026-09','Invented GSTR-1 draft.xlsx',100,$3,$4,$5)",[firm.firmId,client,createHash("sha256").update(made.task).digest("hex"),`invented-${made.task}`,{form:"GSTR1",registration:made.registration,version:1,template:"invented",sources:[{id:made.draft,revision:1}],status:"draft",filled:true}]);
      returns.push({...made,id:client});
    }
    const [a,b]=returns,next=(on:Page)=>on.getByRole("navigation",{name:"Next return to check"});
    await signIn(page,email,key);
    await page.goto(`/app/clients/${a.id}/returns/${a.task}`);await expect(now(page)).toContainText("Check");
    await expect(next(page).getByRole("link")).toHaveText(`Next: ${b.client} GSTR-1 Sep`);
    // The last figure of the first return: it leaves the list, and Next opens the second.
    await page.getByRole("region",{name:"Figures not checked yet"}).getByRole("button",{name:"All correct"}).click();
    await expect(page.getByRole("status")).toContainText("Your check was saved");
    await next(page).getByRole("link",{name:`Next: ${b.client} GSTR-1 Sep`}).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${b.id}/returns/${b.task}$`));await expect(now(page)).toContainText("Check");
    await expect(next(page)).toHaveText("Nothing else to check");
    await page.getByRole("region",{name:"Figures not checked yet"}).getByRole("button",{name:"All correct"}).click();
    await expect(page.getByRole("status")).toContainText("Your check was saved");await expect(next(page)).toHaveText("Nothing else to check");
  } finally {
    await firm.remove();
  }
});
