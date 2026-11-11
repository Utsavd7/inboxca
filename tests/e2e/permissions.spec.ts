import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {pdf} from "../fixtures/pdf";
import {actionFields,addPerson,appKey,emailStep,localSupabase,query,seedFirm,signIn,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// #29 and #47: a named client's pages, one at a time, with an end date and revocation.
test("the owner's scoped permission gives a personal copy only for that client",async({page,browser})=>{
  test.setTimeout(90_000);loadEnvConfig(process.cwd());
  const key=Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const ownerEmail=`rights-owner-${randomUUID()}@invented.test`,staffEmail=`rights-staff-${randomUUID()}@invented.test`;
  const firm=await seedFirm("Invented Scoped Firm",ownerEmail,key),staff=await seedFirm("Invented Staff Setup",staffEmail,key);
  const context=await browser.newContext(),person=await context.newPage(),drive=localDrive(TEST_DRIVE);
  let stored:string|undefined;
  try {
    await query(local.dbUrl,"delete from public.firm_members where firm_id=$1 and user_id=$2",[staff.firmId,staff.ownerId]);
    await query(local.dbUrl,"insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'staff','active')",[firm.firmId,staff.ownerId]);
    const a=randomUUID(),b=randomUUID(),doc=randomUUID(),other=randomUUID(),account=randomUUID(),crypto=serverCrypto();
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$3,'Invented Scope Alpha','business'),($2,$3,'Invented Scope Beta','business')",[a,b,firm.firmId]);
    const bytes=Buffer.from(pdf("Invented confidential source")),sha256=createHash("sha256").update(bytes).digest("hex");
    const saved=await drive.save(await drive.ensureFolder([firm.firmId]),"invented-source.pdf",bytes);
    if(saved==="taken") throw new Error("Test file collision");stored=saved.id;
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings) values($1,$2,'drive','local',$3,$4,'{}')",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    for(const [id,client] of [[doc,a],[other,b]]) await query(local.dbUrl,"insert into public.documents(id,firm_id,client_id,work_type,document_type,name,size,sha256,drive_file_id) values($1,$2,$3,'income_tax','Statement','invented-source.pdf',$5,$6,$4)",[id,firm.firmId,client,stored,bytes.length,sha256]);
    for(const [tab,email] of [[page,ownerEmail],[person,staffEmail]] as const) {
      await emailStep(tab,email);await tab.getByLabel("6 digit code from the app").fill(totp(key));await tab.getByRole("button",{name:"Continue"}).click();await expect(tab).toHaveURL(/\/app$/);
    }
    await page.goto("/app/settings#permissions");await page.getByText("Give one person a permission",{exact:true}).click();
    await page.getByLabel("Person",{exact:true}).selectOption(staff.ownerId);await page.getByLabel("What they may do").selectOption("download");
    await page.getByLabel("Client names, one per line. Blank means every client.").fill("Invented Scope Alpha");
    const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});
    await page.locator("#standing-until").fill(today);await page.getByRole("button",{name:"Allow this person"}).click();await expect(page).toHaveURL(/saved=allowed/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.locator("#permissions").screenshot({path:test.info().outputPath("permissions.png")});
    await person.goto(`/app/files/${other}/view`);await expect(person.getByRole("button",{name:"Ask to download",exact:true})).toBeVisible();
    const origin=new URL(person.url()).origin;
    expect((await person.request.post(`/app/files/${other}/stream`,{headers:{Origin:origin}})).status()).toBe(403);
    await person.goto(`/app/files/${doc}/view`);await expect(person.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
    const [download]=await Promise.all([person.waitForEvent("download"),person.getByRole("button",{name:"Download these pages"}).click()]);
    const copy=await readFile((await download.path())!);expect(copy.subarray(0,8).toString()).toBe("%PDF-1.4");expect(copy.includes(Buffer.from("Invented confidential source"))).toBe(false);
    expect((await query(local.dbUrl,"select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='document.downloaded'",[firm.firmId,staff.ownerId]))[0].n).toBe(1);
    await query(local.dbUrl,"update public.firm_members set access=jsonb_set(access,'{always,0,until}',to_jsonb(((now() at time zone 'Asia/Kolkata')::date-1)::text)) where firm_id=$1 and user_id=$2",[firm.firmId,staff.ownerId]);
    await person.reload();await expect(person.getByRole("button",{name:"Ask to download",exact:true})).toBeVisible();
    expect((await person.request.post(`/app/files/${doc}/stream`,{headers:{Origin:origin}})).status()).toBe(403);
    await page.reload();await page.getByRole("button",{name:"Withdraw",exact:true}).click();await expect(page.getByRole("button",{name:"Withdraw",exact:true})).toHaveCount(0);
  } finally {await context.close().catch(()=>{});try {if(stored) await drive.trash(stored);} finally {await firm.remove();await staff.remove();}}
});

// Without the Mark returns filed right, the filing form sent by hand with any other choice
// leaves a filed return filed, its acknowledgement kept, and a notice's details as they were.
test("someone without the right cannot set a filed return back or empty a notice through the filing form",async({browser})=>{
  test.setTimeout(90_000);
  const key=appKey(),tag=randomUUID().slice(0,8),ownerEmail=`filing-owner-${tag}@invented.test`,staffEmail=`filing-staff-${tag}@invented.test`;
  const firm=await seedFirm(`Invented Filing Firm ${tag}`,ownerEmail,key);
  try {
    await addPerson(firm.firmId,staffEmail,"staff",key);
    await query(local.dbUrl,"update public.firms set settings=settings||'{\"permissions\":{\"employee\":{\"mark_filed\":false}}}' where id=$1",[firm.firmId]);
    const [{id:client}]=await query(local.dbUrl,"insert into public.clients(firm_id,name,kind) values($1,'Invented Filing Client','business') returning id",[firm.firmId]);
    const [{id:task}]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,kind,code,period_key,due_on,status,details) values($1,$2,'compliance','GSTR3B','2026-10',current_date,'filed',$3) returning id",[firm.firmId,client,{filed_on:"2026-11-10",ack:"invented-ack"}]);
    const [{id:notice}]=await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,kind,due_on,status,details) values($1,$2,'notice',current_date+30,'upcoming',$3) returning id",[firm.firmId,client,{authority:"income_tax",reference:"Invented reference",action_date:"2026-12-31"}]);
    const before=await query(local.dbUrl,"select id,status,details from public.tasks where firm_id=$1 order by kind",[firm.firmId]);
    const [owner,staff]=await Promise.all([browser.newPage(),browser.newPage()]);
    await signIn(owner,ownerEmail,key);await signIn(staff,staffEmail,key);
    const fields=await actionFields(owner,"/app/calendar?view=filed",{task});
    for(const [intent,ids] of [["x",[task,notice]],["reopen",[task]],["in_progress",[task]]] as const) {
      const form=new FormData();
      for(const [name,value] of Object.entries(fields)) if(name!=="task" && name!=="intent") form.append(name,value);
      form.append("intent",intent);for(const id of ids) form.append("task",id);
      await staff.request.post("/app/calendar",{multipart:form,headers:{Origin:new URL(staff.url()).origin},maxRedirects:0});
    }
    expect(await query(local.dbUrl,"select id,status,details from public.tasks where firm_id=$1 order by kind",[firm.firmId])).toEqual(before);
  } finally {await firm.remove(staffEmail);}
});
