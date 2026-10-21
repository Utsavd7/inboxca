import {createHash,randomBytes,randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {place,type Draft} from "@/src/lib/datasets";
import {actionFields,emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
import {tmpdir} from "node:os";
import {FILE_WORKER_URL} from "../../playwright.config";
import {readSalesRegister} from "@/src/jobs/read-sales";
import {readPortalFile} from "@/src/jobs/read-portal";
import {inventedGstin,statement} from "../fixtures/portal";
import type {Job} from "@/src/jobs/runner";
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
    const bytes=Buffer.from("First sale,100.00\nSecond sale,200.00\nTotal,310.00"),sha256=createHash("sha256").update(bytes).digest("hex");
    const crypto=serverCrypto(),client=randomUUID(),doc=randomUUID(),id=randomUUID(),lines=Array.from({length:3},()=>randomUUID()),account=randomUUID();
    const folder=await drive.ensureFolder([firm.firmId]),saved=await drive.save(folder,"invented-register.csv",bytes);
    if(saved==="taken") throw new Error("Test file collision");
    artifact=saved.id;
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Figure Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,name,size,sha256,drive_file_id) values ($1,$2,$3,'gst','Sales register','invented-register.csv',60,$5,$4)",[doc,firm.firmId,client,saved.id,sha256]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,$2,'drive','local',$3,$4,'{}')",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,'Test drive'),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,'{}')]);
    const data:Draft={lines:await Promise.all(lines.map(async(line,n)=>({id:line,field:`sale${n}`,value_enc:await crypto.encrypt(firm.firmId,place(id,line),JSON.stringify({label:["First sale","Second sale","Total"][n],value:["100.00","200.00","310.00"][n]})),source:{document:doc,sha256,page:1,sheet:1,cell:`B${n+1}`},state:"pending" as const}))),checks:[{kind:"sum",parts:lines.slice(0,2),total:lines[2]}]};
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
    await expect.poll(async()=>(await query(local.dbUrl,"select data from public.datasets where id=$1",[id]))[0].data.lines[0].state).toBe("rejected");

  } finally {try {if(artifact) await drive.trash(artifact);} finally {await firm.remove();}}
});

test("a portal statement becomes encrypted pending figures beside its source, with the client checked and reviewed figures preserved",async({page})=>{
  test.setTimeout(90_000);loadEnvConfig(process.cwd());process.env.FILE_WORKER_URL=FILE_WORKER_URL;
  const email=`portal-${randomUUID()}@invented.test`,key=Array.from(randomBytes(16),(byte)=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const firm=await seedFirm("Portal Test Firm",email,key),crypto=serverCrypto(),client=randomUUID(),account=randomUUID();
  const drive=localDrive(`${tmpdir()}/inboxca-test-drive`),artifacts:string[]=[];
  try {
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Portal Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,$2,'drive','local',$3,$4,'{}')",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,'Test drive'),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,'{}')]);
    const register=async(gstin:string)=>query(local.dbUrl,"insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,'gstin',$3,$4)",[firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/gstin`,gstin),await crypto.blindIndex(firm.firmId,"gstin",gstin)]);
    await register(inventedGstin());
    const add=async(value:unknown)=>{
      const id=randomUUID(),bytes=Buffer.from(JSON.stringify(value)),sha=createHash("sha256").update(bytes).digest("hex");
      const saved=await drive.save(await drive.ensureFolder([firm.firmId]),`${id}.json`,bytes);if(saved==="taken") throw new Error("Test collision");artifacts.push(saved.id);
      await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values ($1,$2,$3,'gst','GSTR-2B','2026-09',$4,$5,$6,$7)",[id,firm.firmId,client,`${id}.json`,bytes.length,sha,saved.id]);return id;
    };
    const first=await add(statement()),job=(id:string)=>({firm_id:firm.firmId,entity_id:id} as Job),tools={markSending:async()=>{}};
    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(key));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    await query(local.dbUrl,"update public.firm_members set role='staff' where firm_id=$1 and user_id=$2",[firm.firmId,firm.ownerId]);
    await page.goto(`/app/clients/${client}?tab=extraction`);await page.getByRole("button",{name:"Read statement"}).click();
    await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
    const [draft]=await query(local.dbUrl,"select id,data from public.datasets where firm_id=$1 and client_id=$2",[firm.firmId,client]);
    expect(draft.data.lines[0].source).toMatchObject({document:first,path:"/data/itcsumm/itcavl/nonrevsup/igst",reader:"gstr2b-v4.5",page:1});
    expect(draft.data.lines).toHaveLength(8);expect(draft.data.lines.every((line:{state:string})=>line.state==="pending")).toBe(true);expect(JSON.stringify(draft.data)).not.toContain('"value":');
    expect(JSON.parse(await crypto.decrypt(firm.firmId,place(draft.id,draft.data.lines[0].id),draft.data.lines[0].value_enc)).value).toBe("100");
    await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
    expect(await readPortalFile(job(first),tools)).toEqual({done:true});
    expect((await query(local.dbUrl,"select revision from public.datasets where id=$1",[draft.id]))[0].revision).toBe(2);
    const secondNumber=inventedGstin("ZZZPZ0001Z","2");await register(secondNumber);const second=await add(statement(secondNumber));
    expect(await readPortalFile(job(second),tools)).toEqual({done:true});
    const [appended]=await query(local.dbUrl,"select data from public.datasets where id=$1",[draft.id]);
    expect(appended.data.lines).toHaveLength(16);expect(appended.data.lines[0]).toMatchObject({state:"confirmed",by:firm.ownerId});
    const wrong=await add(statement(inventedGstin("ZZZPZ0002Z")));
    expect(await readPortalFile(job(wrong),tools)).toMatchObject({retry:"portal_not_read"});
    expect((await query(local.dbUrl,"select data from public.datasets where id=$1",[draft.id]))[0].data.lines).toHaveLength(16);
    const unsupported=await add({gstin:inventedGstin(),fp:"092026",b2b:[]});expect(await readPortalFile(job(unsupported),tools)).toEqual({done:true});
  } finally {for(const id of artifacts) await drive.trash(id);await firm.remove();}
});

test("a client's confirmed columns read the next month's register automatically without changing a checked draft",async({page})=>{
  test.setTimeout(90_000);loadEnvConfig(process.cwd());process.env.FILE_WORKER_URL=FILE_WORKER_URL;
  const email=`register-${randomUUID()}@invented.test`,key=Array.from(randomBytes(16),(byte)=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const firm=await seedFirm("Register Test Firm",email,key),crypto=serverCrypto(),client=randomUUID(),account=randomUUID();
  const drive=localDrive(`${tmpdir()}/inboxca-test-drive`),artifacts:string[]=[];
  try {
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Register Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,$2,'drive','local',$3,$4,'{}')",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,'Test drive'),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,'{}')]);
    const add=async(month:string,values:string)=>{
      const id=randomUUID(),bytes=Buffer.from(`Description,Amount,Cess\n${values}`),sha=createHash("sha256").update(bytes).digest("hex");
      const saved=await drive.save(await drive.ensureFolder([firm.firmId]),`invented-${month}.csv`,bytes);if(saved==="taken") throw new Error("Test collision");artifacts.push(saved.id);
      await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values ($1,$2,$3,'gst','Sales bills',$4,$5,$6,$7,$8)",[id,firm.firmId,client,month,`invented-${month}.csv`,bytes.length,sha,saved.id]);return id;
    };
    const first=await add("2026-09","Invented sale A,100.00,0.00\nInvented sale B,200.00,0.00\nTotal,300.00,0.00");
    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(key));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    await page.goto(`/app/clients/${client}?tab=extraction&source=${first}`);
    await page.getByLabel("GSTR-1 section").selectOption("b2cs");await page.getByRole("button",{name:"Show columns"}).click();
    await page.getByRole("combobox",{name:"Taxable Value",exact:true}).selectOption("1");await page.getByRole("combobox",{name:"Cess Amount",exact:true}).selectOption("2");
    await page.getByRole("button",{name:"Confirm columns and read figures"}).click();await expect(page).toHaveURL(new RegExp(`draft=${first}`));
    const [row]=await query(local.dbUrl,"select data,revision from public.datasets where id=$1",[first]);
    expect(row.data.lines).toHaveLength(6);expect(row.data.checks).toHaveLength(2);
    expect(row.data.lines.every((line:{state:string})=>line.state==="pending")).toBe(true);
    const [remembered]=await query(local.dbUrl,"select sales_mapping_enc from public.clients where id=$1",[client]);
    expect(remembered.sales_mapping_enc).not.toContain("Amount");
    const job=(id:string)=>({firm_id:firm.firmId,entity_id:id} as Job),tools={markSending:async()=>{}};
    const second=await add("2026-10","Invented sale C,50.00,0.00\nInvented sale D,70.00,0.00\nTotal,120.00,0.00");
    expect(await readSalesRegister(job(second),tools)).toEqual({done:true});
    const [next]=await query(local.dbUrl,"select data from public.datasets where id=$1",[second]);expect(next.data.lines).toHaveLength(6);
    expect(JSON.parse(await crypto.decrypt(firm.firmId,place(second,next.data.lines[4].id),next.data.lines[4].value_enc)).value).toBe("120.00");
    expect((await query(local.dbUrl,"select actor_id from public.activity_log where firm_id=$1 and action='dataset.created' and details->>'dataset'=$2",[firm.firmId,second]))[0].actor_id).toBeNull();
    await query(local.dbUrl,"update public.datasets set revision=8 where id=$1",[first]);
    expect(await readSalesRegister(job(first),tools)).toEqual({done:true});
    expect((await query(local.dbUrl,"select revision from public.datasets where id=$1",[first]))[0].revision).toBe(8);
    const changed=await add("2026-11","Invented sale E,1.00,0.00");
    await query(local.dbUrl,"update public.documents set sha256=$2 where id=$1",[changed,"f".repeat(64)]); // ggignore: deliberately wrong test checksum.
    expect(await readSalesRegister(job(changed),tools)).toMatchObject({retry:"sales_not_read"});
    expect((await query(local.dbUrl,"select id from public.datasets where id=$1",[changed])).length).toBe(0);
  } finally {for(const id of artifacts) await drive.trash(id);await firm.remove();}
});
