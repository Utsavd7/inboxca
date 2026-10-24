import {randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {place,type Draft} from "@/src/lib/datasets";
import {localDrive} from "@/src/lib/drive";
import {itrRequest} from "../fixtures/itr";
import {emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

test("typed ITR figures keep their source and checks, then use the existing filing flow",async({page})=>{
  test.setTimeout(180_000);loadEnvConfig(process.cwd());
  const email=`itr-${randomUUID()}@invented.test`,secret=Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const firm=await seedFirm("Invented ITR Browser Firm",email,secret),client=randomUUID(),registration=randomUUID(),account=randomUUID(),crypto=serverCrypto(),pan="ZZZPZ0001Z"; // ggignore: invented PAN.
  const drive=localDrive(`${tmpdir()}/inboxca-test-drive`);
  try {
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented ITR Person','individual')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,'pan',$4,$5)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/pan`,pan),await crypto.blindIndex(firm.firmId,"pan",pan)]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Invented drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(secret));await page.getByRole("button",{name:"Continue",exact:true}).click();await expect(page).toHaveURL(/\/app$/);
    await page.goto(`/app/clients/${client}/itr?group=Taxes+paid`);
    await expect(page.getByText(/Filing files are not available yet/)).toBeVisible();
    await page.getByLabel("Advance tax paid",{exact:true}).fill("100");await page.getByLabel(/Taxes Paid.*Total Taxes Paid/).fill("99");
    for(const label of ["Total TDS claimed","Total TCS claimed","Self assessment tax paid"]) await page.getByLabel(label,{exact:true}).fill("0");
    await page.getByRole("button",{name:"Save figures for checking"}).click();await expect(page).toHaveURL(/tab=extraction&draft=/);
    await expect(page.getByText(`Entered by ${email}`,{exact:false})).toBeVisible();
    const [typed]=await query(local.dbUrl,"select * from public.datasets where firm_id=$1",[firm.firmId]);
    expect(typed.form_code).toBe("ITR");expect(typed.period_key).toBe("2026");
    expect(typed.data.lines.every((line:Draft["lines"][number])=>line.state==="pending" && line.source.entered_by===firm.ownerId && !line.source.document)).toBe(true);
    await page.getByRole("button",{name:"Yes, this is right"}).click();await expect(page.getByRole("status")).toContainText("totals must agree");
    // Filing fixtures are fully confirmed invented data, not defaults used by the app.
    for(const form of ["ITR1","ITR4"]) {
      const request=itrRequest(form),id=randomUUID(),lines:Draft["lines"]=[];
      for(const [field,figure] of request.drafts[0].figures) {const line=randomUUID();lines.push({id:line,field,value_enc:await crypto.encrypt(firm.firmId,place(id,line),JSON.stringify(figure)),source:{entered_by:firm.ownerId,entered_at:new Date().toISOString()},state:"confirmed",by:firm.ownerId,at:new Date().toISOString()});}
      await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[id,firm.firmId,client,{target:{form,version:"1.1"},lines,checks:[]}]);
      await page.goto(`/app/clients/${client}?tab=outputs`);
      const prepare=page.locator("form").filter({has:page.getByRole("group",{name:`${form.replace("ITR","ITR-")} AY 2026-27`,exact:true})});
      await prepare.getByRole("button",{name:"Prepare AY 2026-27"}).click();await expect(page).toHaveURL(/\/files\/.*\/view/);
      await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
      let [saved]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'=$2",[firm.firmId,form]);
      expect(saved.prepared.status).toBe("approved");expect(saved.drive_file_id).toContain("Income tax/");expect(saved.drive_file_id).toContain("/Prepared/");
      expect((await page.request.get(`/app/files/${saved.id}`)).status()).toBe(404);
      await page.goto(`/app/clients/${client}?tab=outputs`);
      let row=page.locator("li").filter({has:page.getByRole("link",{name:saved.name,exact:true})});
      const download=page.waitForEvent("download");await row.getByRole("button",{name:"Download for filing"}).click();const file=await download;
      const output=JSON.parse(await readFile((await file.path())!,"utf8"));expect(output.ITR[form].PersonalInfo.PAN).toBe(pan);
      expect((await page.request.get(file.url())).status()).toBe(410);
      if(form==="ITR1") {
        const field=Object.entries(request.template.mappings.fields!).find(([,path])=>path==="Verification.Declaration.FatherName")![0],line=lines.find(line=>line.field===field)!;
        await page.goto(`/app/clients/${client}?tab=extraction&draft=${id}&line=${line.id}`);
        await page.getByLabel("Correct figure").fill("Invented Father Two");await page.getByLabel("Why it changed").fill("Invented correction for the filing test");await page.getByRole("button",{name:"Save correction",exact:true}).click();await expect(page.getByRole("status")).toContainText("Your check was saved");
        expect((await query(local.dbUrl,"select public.form_ready($1) ready",[saved.id]))[0].ready).toBe(false);
        await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',(select jsonb_agg(case when l->>'id'=$2 then l else l||jsonb_build_object('state','confirmed','by',$3::text,'at',$4::text) end) from jsonb_array_elements(data->'lines') l)) where id=$1",[id,line.id,firm.ownerId,new Date().toISOString()]);
        await page.reload();await page.getByRole("button",{name:"Yes, this is right"}).click();
        await expect.poll(async()=>(await query(local.dbUrl,"select count(*)::int n from public.documents where firm_id=$1 and prepared->>'form'='ITR1' and prepared->>'version'='2' and size>0",[firm.firmId]))[0].n,{timeout:30_000}).toBe(1);
        [saved]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='ITR1' and prepared->>'version'='2'",[firm.firmId]);
        await page.goto(`/app/clients/${client}?tab=outputs`);row=page.locator("li").filter({has:page.getByRole("link",{name:saved.name,exact:true})});
      } else {
        output.ITR[form].Verification.Declaration.FatherName="Invented Edited Father";
        await row.getByText("File corrected outside InboxCA",{exact:true}).click();await row.getByLabel("Official return file",{exact:true}).setInputFiles({name:"invented-correction.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(output))});await row.getByRole("button",{name:"Add corrected version"}).click();await expect(page).toHaveURL(/tab=extraction&draft=/);
        [saved]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'='ITR4' and prepared->>'external'='true'",[firm.firmId]);
        expect(saved.prepared.status).toBe("draft");await expect(page.getByRole("img",{name:"Page 1",exact:true})).toBeVisible();
        const source=saved.prepared.sources[0].id,[external]=await query(local.dbUrl,"select data from public.datasets where id=$1",[source]),first=external.data.lines[0].id;
        expect(external.data.lines.every((line:Draft["lines"][number])=>line.state==="pending" && line.source.document===saved.id && line.source.path)).toBe(true);
        await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',(select jsonb_agg(case when l->>'id'=$2 then l else l||jsonb_build_object('state','confirmed','by',$3::text,'at',$4::text) end) from jsonb_array_elements(data->'lines') l)) where id=$1",[source,first,firm.ownerId,new Date().toISOString()]);
        await page.reload();await page.getByRole("button",{name:"Yes, this is right"}).click();
        await expect.poll(async()=>(await query(local.dbUrl,"select public.form_ready($1) ready",[saved.id]))[0].ready).toBe(true);
        await page.goto(`/app/clients/${client}?tab=outputs`);row=page.locator("li").filter({has:page.getByRole("link",{name:saved.name,exact:true})});await expect(row).toContainText("Edited outside InboxCA");
      }
      await row.getByText("Record filing",{exact:true}).click();await row.getByLabel("Acknowledgement number, if known").fill("INVENTED-ITR-ACK");await row.getByRole("button",{name:"Mark filed",exact:true}).click();
      await expect.poll(async()=>(await query(local.dbUrl,"select prepared->>'status' status from public.documents where id=$1",[saved.id]))[0].status).toBe("filed");
    }
  } finally {
    for(const row of await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId])) if(row.drive_file_id) await drive.trash(row.drive_file_id).catch(()=>{});
    await firm.remove();
  }
});
