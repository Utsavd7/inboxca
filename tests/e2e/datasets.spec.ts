import {randomBytes,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {actionFields,emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
import {tmpdir} from "node:os";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// M6 step 1: an invented register, not a government portal fixture.
test("staff check figures beside the source; totals, edit rights and stale reviews are enforced",async({page})=>{
  test.setTimeout(90_000);loadEnvConfig(process.cwd());
  const email=`figures-${randomUUID()}@invented.test`,key=Array.from(randomBytes(16),(byte)=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const firm=await seedFirm("Figure Test Firm",email,key);
  const drive=localDrive(`${tmpdir()}/inboxca-test-drive`);
  let artifact:string|undefined;
  try {
    const crypto=serverCrypto(),client=randomUUID(),doc=randomUUID(),id=randomUUID(),lines=Array.from({length:3},()=>randomUUID()),account=randomUUID();
    const folder=await drive.ensureFolder([firm.firmId]),saved=await drive.save(folder,"invented-register.csv",Buffer.from("First sale,100.00\nSecond sale,200.00\nTotal,310.00"));
    if(saved==="taken") throw new Error("Test file collision");
    artifact=saved.id;
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Figure Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,name,size,sha256,drive_file_id) values ($1,$2,$3,'gst','Sales register','invented-register.csv',60,'invented checksum',$4)",[doc,firm.firmId,client,saved.id]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,$2,'drive','local',$3,$4,'{}')",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,'Test drive'),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,'{}')]);
    const data:Draft={lines:await Promise.all(lines.map(async(line,n)=>({id:line,field:`sale${n}`,value_enc:await crypto.encrypt(firm.firmId,place(id,line),JSON.stringify({label:["First sale","Second sale","Total"][n],value:["100.00","200.00","310.00"][n]})),source:{document:doc,page:1,sheet:1,cell:`B${n+1}`},state:"pending" as const}))),checks:[{kind:"sum",parts:lines.slice(0,2),total:lines[2]}]};
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[id,firm.firmId,client,JSON.stringify(data)]);
    expect(JSON.stringify(data)).not.toContain('"value":');
    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(key));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    await query(local.dbUrl,"update public.firm_members set role='staff' where firm_id=$1 and user_id=$2",[firm.firmId,firm.ownerId]);
    const url=`/app/clients/${client}?tab=extraction&draft=${id}&line=${lines[2]}`;
    await page.goto(url);
    await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
    await expect(page.getByText(/Sheet 1, cell B3/)).toBeVisible();
    await expect(page.getByRole("button",{name:"Yes, this is right"})).toBeDisabled();
    await expect(page.getByLabel("Correct figure")).toHaveCount(0);
    const forged=await actionFields(page,url,{line:lines[2]});
    const denied=await page.request.post(url,{multipart:{...forged,intent:"edit",value:"300.00",reason:"Correct the total"},headers:{Origin:new URL(page.url()).origin}});
    expect(denied.url()).toContain("check=permission");
    const blocked=await page.request.post(url,{multipart:{...forged,intent:"confirmed"},headers:{Origin:new URL(page.url()).origin}});
    expect(blocked.url()).toContain("check=totals");
    await page.getByRole("button",{name:"Ask to edit figures"}).click();await expect(page).toHaveURL(/asked_right=edit_figures/);
    const [{id:permission}]=await query(local.dbUrl,"update public.requests set status='approved' where firm_id=$1 and kind='permission' returning id",[firm.firmId]);
    await page.goto(url);await page.getByLabel("Correct figure").fill("300.00");await page.getByLabel("Why it changed").fill("The source total was wrong");await page.getByRole("button",{name:"Save correction",exact:true}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    expect((await query(local.dbUrl,"select status from public.requests where id=$1",[permission]))[0].status).toBe("used");
    const stale=await page.request.post(url,{multipart:{...forged,intent:"confirmed"},headers:{Origin:new URL(page.url()).origin}});expect(stale.url()).toContain("check=stale");
    for(const line of lines) {
      await page.goto(`/app/clients/${client}?tab=extraction&draft=${id}&line=${line}`);
      await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    }
    const [checked]=await query(local.dbUrl,"select data from public.datasets where id=$1",[id]);
    expect(checked.data.lines.every((line:{state:string;by:string})=>line.state==="confirmed" && line.by===firm.ownerId)).toBe(true);
    expect((await query(local.dbUrl,"select count(*)::int n from public.activity_log where firm_id=$1 and action='dataset.checked'",[firm.firmId]))[0].n).toBe(3);
    await query(local.dbUrl,"insert into public.requests(id,firm_id,client_id,kind,entity_type,entity_id,reason_code,status,expires_at,details) values ($4,$1,$2,'permission','permission',$4,'edit_figures','approved',now()+interval '1 hour',jsonb_build_object('by',$3::text))",[firm.firmId,client,firm.ownerId,randomUUID()]);
    await page.goto(url);await page.getByLabel("Correct figure").fill("301.00");await page.getByLabel("Why it changed").fill("Recheck this corrected total");await page.getByRole("button",{name:"Save correction",exact:true}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    const [reset]=await query(local.dbUrl,"select data from public.datasets where id=$1",[id]);
    expect(reset.data.lines.every((line:{state:string;by?:string})=>line.state==="pending" && !line.by)).toBe(true);
    await page.getByRole("button",{name:"No, this is wrong"}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    expect((await query(local.dbUrl,"select data from public.datasets where id=$1",[id]))[0].data.lines[0].state).toBe("rejected");

  } finally {try {if(artifact) await drive.trash(artifact);} finally {await firm.remove();}}
});
