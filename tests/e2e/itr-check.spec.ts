import {randomUUID} from "node:crypto";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {place,type Draft} from "@/src/lib/datasets";
import {itrFieldName} from "@/src/lib/itr-fields";
import {itrRequest} from "../fixtures/itr";
import {bankTan,form16,form26asText,pan,tan} from "../fixtures/tax-papers";
import {appKey,localSupabase,query,runJobs,seedFirm,signIn} from "./local-supabase";

// ITR against Form 26AS: a client's Form 26AS text file and Form 16 dropped in as portal files,
// a return filled from them, and its differences with Form 26AS shown on the return and as a
// caution the approver ticks, logged, at Prepare and at the second approval. Invented papers.
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

const employer="HYDZ99998Z",bank="HYDZ99997Z"; // ggignore: invented TANs in the official TAN layout.
type Figure={label:string;value:string;kind?:"number"|"text"|"date"};

test("an ITR that differs from Form 26AS shows each difference and is approved only with the tick, logged",async({page,request})=>{
  test.setTimeout(240_000);loadEnvConfig(process.cwd());
  const tag=randomUUID().slice(0,8),key=appKey(),ownerEmail=`itr-check-${tag}@invented.test`,name=`Invented Check Person ${tag}`;
  const firm=await seedFirm("Invented ITR Check Firm",ownerEmail,key),crypto=serverCrypto(),field=(path:string)=>itrFieldName("ITR1",path);
  try {
    // The firm asks for a second approval, so both approval steps are seen.
    await query(local.dbUrl,"update public.firms set settings=settings||'{\"second_form_approval\":true}' where id=$1",[firm.firmId]);
    await signIn(page,ownerEmail,key);
    await page.goto("/app/settings");
    const drive=page.locator("section#drive");
    await drive.getByLabel("Test drive on this computer").check();await drive.getByLabel(/I have read this and I agree/).check();
    await drive.getByRole("button",{name:"Connect drive"}).click();await expect(drive.getByRole("status")).toContainText("Connected");
    await page.goto("/app/clients?panel=add");
    await page.getByLabel("Name",{exact:true}).fill(name);await page.getByLabel("Client type",{exact:true}).selectOption("individual");await page.getByLabel("PAN",{exact:true}).fill(pan);
    await page.getByRole("button",{name:"Add client"}).click();await expect(page.locator(".page-head")).toContainText(name);
    const [{id:client}]=await query(local.dbUrl,"select id from public.clients where firm_id=$1 and name=$2",[firm.firmId,name]);
    // The papers: Form 26AS with the employer's salary TDS and a bank's interest TDS booked U, and the employer's Form 16.
    await page.goto("/app/documents?view=papers");await page.getByRole("link",{name:"Add portal files"}).click();
    await page.getByLabel("Add portal files").setInputFiles([{name:"26as.txt",mimeType:"text/plain",buffer:Buffer.from(form26asText().toString().replaceAll(tan,employer).replaceAll(bankTan,bank))},{name:"form16.pdf",mimeType:"application/pdf",buffer:Buffer.from(form16("AB",pan,"2026-27",pan,employer))}]);
    await page.getByRole("button",{name:"Add",exact:true}).click();await expect(page).toHaveURL(/\/app\/documents\?dropped=2-0-0$/);
    await runJobs(request,firm.firmId);
    // Each paper's figures checked by a colleague; Form 16's amounts in whole rupees, as the return takes them.
    const checker=randomUUID(),at=new Date().toISOString(),papers=await query(local.dbUrl,"select id,data from public.datasets where client_id=$1",[client]);
    expect(papers.map(row=>row.data.lines[0].source.reader).sort()).toEqual(["form16-traces","form26as-text"]);
    for(const row of papers) {
      const lines:Draft["lines"]=[];
      for(const line of row.data.lines as Draft["lines"]) {
        const figure=JSON.parse(await crypto.decrypt(firm.firmId,place(row.id,line.id),line.value_enc)) as Figure,value=line.source.reader==="form16-traces" && figure.kind==="number" ? figure.value.replace(/\.00$/,"") : figure.value;
        lines.push({...line,value_enc:value===figure.value ? line.value_enc : await crypto.encrypt(firm.firmId,place(row.id,line.id),JSON.stringify({...figure,value})),state:"confirmed",by:checker,at});
      }
      await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',$2::jsonb) where id=$1",[row.id,JSON.stringify(lines)]);
    }
    // The rest of the return as the CA enters it, checked: invented figures that add up.
    const form16Fields=new Set(["itr.salary.gross","itr.salary.income","itr.tds.salary.0.tan","itr.tds.salary.0.income","itr.tds.salary.0.deducted"]),itr=itrRequest("ITR1"),own=randomUUID();
    const values:Record<string,string>={[field("ITR1_IncomeDeductions.NetSalary")]:"1200000",[field("ITR1_IncomeDeductions.DeductionUs16")]:"75000",[field("ITR1_IncomeDeductions.GrossTotIncome")]:"1125000",[field("ITR1_IncomeDeductions.GrossTotIncomeIncLTCG112A")]:"1125000",[field("ITR1_IncomeDeductions.TotalIncome")]:"1125000","itr.tds.total":"64480",[field("TaxPaid.TaxesPaid.TotalTaxesPaid")]:"64480",[field("Refund.RefundDue")]:"64480"};
    const entered:[string,Figure][]=[...itr.drafts[0].figures.filter(([name])=>!form16Fields.has(name)).map(([name,figure]):[string,Figure]=>[name,{...figure,value:values[name] ?? figure.value}]),["itr.tds.salary.0.name",{label:"Employer's name",value:"INVENTED SOFTWARE PRIVATE LIMITED",kind:"text"}],[field("TDSonSalaries.TotalTDSonSalaries"),{label:"Total TDS on salaries",value:"64480",kind:"number"}]];
    const lines:Draft["lines"]=[];
    for(const [name,figure] of entered) {const id=randomUUID();lines.push({id,field:name,value_enc:await crypto.encrypt(firm.firmId,place(own,id),JSON.stringify(figure)),source:{entered_by:firm.ownerId,entered_at:at},state:"confirmed",by:checker,at});}
    await query(local.dbUrl,"insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[own,firm.firmId,client,{target:{form:"ITR1",version:itr.template.version},lines,checks:[]}]);

    // The return: complete, and its two differences with Form 26AS in plain lines.
    await page.goto(`/app/clients/${client}/itr?form=ITR1&year=2026`);
    await expect(page.getByText("Nothing left to fill.")).toBeVisible();
    const missing=`TDS of ₹1,200 from INVENTED BANK LIMITED (${bank}) is in Form 26AS but not in the return.`,booked=`₹1,200 of the TDS from INVENTED BANK LIMITED (${bank}) has booking status U in Form 26AS, not F (final).`;
    const shown=page.getByRole("region",{name:"Differences with Form 26AS"});
    await expect(shown).toContainText("Check before approving: 2 differences with Form 26AS");
    await expect(shown.getByRole("listitem")).toHaveText([missing,booked]);
    await page.screenshot({path:test.info().outputPath("itr-check.png"),fullPage:true});

    // Prepare is the first approval: the caution must be ticked, in the browser and again on the server.
    await page.goto(`/app/clients/${client}?tab=outputs`);
    const prepare=page.locator("form").filter({has:page.getByRole("group",{name:"ITR-1 AY 2026-27",exact:true})});
    await expect(prepare.getByRole("listitem")).toHaveText([missing,booked]);
    await page.screenshot({path:test.info().outputPath("itr-check-prepare.png"),fullPage:true});
    const tick=prepare.getByLabel("I have looked at these differences");
    await tick.evaluate(box=>box.removeAttribute("required"));
    await prepare.getByRole("button",{name:"Prepare ITR-1 AY 2026-27"}).click();
    await expect(page).toHaveURL(/form=differences/);await expect(page.getByText("This return differs from Form 26AS or Form 16. Look at the differences and tick the box, then approve again.")).toBeVisible();
    expect((await query(local.dbUrl,"select count(*)::int n from public.documents where firm_id=$1 and prepared is not null",[firm.firmId]))[0].n).toBe(0);
    await prepare.getByLabel("I have looked at these differences").check();
    await prepare.getByRole("button",{name:"Prepare ITR-1 AY 2026-27"}).click();await expect(page).toHaveURL(/\/files\/.*\/view/);
    const [prepared]=await query(local.dbUrl,"select id,name,prepared from public.documents where firm_id=$1 and prepared->>'form'='ITR1'",[firm.firmId]);
    expect(prepared.prepared.status).toBe("draft");
    // The return's draft shows the same differences.
    await expect(page.getByRole("region",{name:"Differences with Form 26AS"}).getByRole("listitem")).toHaveText([missing,booked]);
    await page.screenshot({path:test.info().outputPath("itr-check-draft.png"),fullPage:true});

    // The second approval asks again, and both ticks are in the firm's activity.
    await page.goto(`/app/clients/${client}?tab=outputs`);
    const row=page.locator("li").filter({has:page.getByRole("link",{name:prepared.name,exact:true})});
    await expect(row.getByRole("region",{name:"Differences with Form 26AS"})).toContainText("Check before approving: 2 differences with Form 26AS");
    await page.screenshot({path:test.info().outputPath("itr-check-approve.png"),fullPage:true});
    await row.getByLabel("I have looked at these differences").check();
    await row.getByRole("button",{name:"Give second approval"}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select prepared->>'status' status from public.documents where id=$1",[prepared.id]))[0].status).toBe("approved");
    expect(await query(local.dbUrl,"select entity_id,details from public.activity_log where firm_id=$1 and action='form.differences_seen'",[firm.firmId])).toEqual([{entity_id:prepared.id,details:{differences:2}},{entity_id:prepared.id,details:{differences:2}}]);
    // Never a block on filing: the approved return downloads as usual.
    await expect(page.locator("li").filter({has:page.getByRole("link",{name:prepared.name,exact:true})}).getByRole("button",{name:"Download for filing"})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);

    // A correction later, with no second approval: InboxCA makes the next version from the corrected
    // figures by itself, and it still waits for a person to look at the differences and approve.
    await query(local.dbUrl,"update public.firms set settings=settings-'second_form_approval' where id=$1",[firm.firmId]);
    const [mine]=await query(local.dbUrl,"select revision,data from public.datasets where id=$1",[own]);
    const corrected=await Promise.all((mine.data.lines as Draft["lines"]).map(async line=>line.field!=="itr.tds.salary.0.name" ? line : {...line,value_enc:await crypto.encrypt(firm.firmId,place(own,line.id),JSON.stringify({label:"Employer's name",value:"INVENTED SOFTWARE LIMITED",kind:"text"}))}));
    await query(local.dbUrl,"update public.datasets set revision=revision+1,data=jsonb_set(data,'{lines}',$2::jsonb) where id=$1",[own,JSON.stringify(corrected)]);
    await query(local.dbUrl,"insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values($1,'regenerate_form','document',$2,$3)",[firm.firmId,prepared.id,`regenerate:${prepared.id}:${own}:${mine.revision+1}`]);
    await runJobs(request,firm.firmId);
    await expect.poll(async()=>(await query(local.dbUrl,"select prepared->>'status' status from public.documents where firm_id=$1 and prepared->>'form'='ITR1' and (prepared->>'version')::int=2",[firm.firmId]))[0]?.status).toBe("draft");
  } finally {
    await firm.remove();
  }
});
