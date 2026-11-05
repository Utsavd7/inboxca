import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {TEST_DRIVE} from "../../playwright.config";
import {serverCrypto} from "@/src/lib/crypto";
import {localDrive} from "@/src/lib/drive";
import {todayInIndia} from "@/src/lib/calendar";
import {emailStep,localSupabase,query,seedFirm,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// Forms No. 143 (TCS) and 144 (payments to non residents) through the statement flow Form No.
// 140 uses: the TCS return task opens Form No. 143, a register is read with the columns a person
// chose, a challan is typed, the figures checked at once, the statement prepared and downloaded,
// and marking it filed closes the TCS return. Form No. 138 for January to March waits for
// Protean's format. Every TAN, PAN and name is invented (ggignore: invented test identifiers, not secrets).
test("prepares Forms No. 143 and 144 from their registers, and files the TCS return",async({page})=>{
  test.setTimeout(240_000);loadEnvConfig(process.cwd());
  const key=Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const email=`tds-forms-${randomUUID()}@invented.test`,firm=await seedFirm("TDS Forms Browser Firm",email,key),client=randomUUID(),account=randomUUID(),registration=randomUUID(),tan="ZZZZ99998Z",pan="ZZZPZ0001Z";
  const crypto=serverCrypto(),drive=localDrive(TEST_DRIVE),files:string[]=[];
  try {
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented TDS Client','business')",[client,firm.firmId]);
    await query(local.dbUrl,"insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,'pan',$3,$4)",[firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/pan`,pan),await crypto.blindIndex(firm.firmId,"pan",pan)]);
    // The TAN with its statement details, as the client's Details saves them.
    const place={flat:"12 Invented Lane",post:"",road:"",area:"",district:"Invented District",state:"24",pin:"380001",country:"India",email:"tds@invented.test",code:"91"};
    const details={name:"Invented TDS Client",type:"F",...place,phone:"9000000001",govt_state:"",ministry:"",ministry_other:"",person:{name:"Invented Partner",designation:"Partner",...place,email:"",phone:"9000000002",pan:"ZZZPZ0009Z"}};
    await query(local.dbUrl,"insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx,details_enc) values($1,$2,$3,'tan',$4,$5,$6)",[registration,firm.firmId,client,await crypto.encrypt(firm.firmId,`clients/${client}/tan`,tan),await crypto.blindIndex(firm.firmId,"tan",tan),await crypto.encrypt(firm.firmId,`clients/${client}/tan/${registration}/details`,JSON.stringify(details))]);
    await query(local.dbUrl,"insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values($1,$2,'drive','local',$3,$4)",[account,firm.firmId,await crypto.encrypt(firm.firmId,`accounts/${account}/address`,"Test drive"),await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,"{}")]);
    await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,'TCS_RET','2026-09','2026-10-31')",[firm.firmId,client,registration]);
    // The client's collection and non resident registers, with their own column names.
    const register=async(name:string,lines:string[])=>{
      const bytes=Buffer.from(lines.join("\n")),saved=await drive.save(await drive.ensureFolder([firm.firmId]),name,bytes);
      if(saved==="taken") throw new Error("Test collision");files.push(saved.id);
      await query(local.dbUrl,"insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,'income_tax','Document','2026-09',$3,$4,$5,$6)",[firm.firmId,client,name,bytes.length,createHash("sha256").update(bytes).digest("hex"),saved.id]);
    };
    await register("Invented TCS register.csv",["Buyer PAN,Buyer,Code,Received on,Amount,TCS,Buyer type,Rate %,Challan no","ZZZPZ0002Z,Invented Scrap Buyer,1073,20/07/2026,200000.00,2000.00,7,1,21"]);
    await register("Invented foreign payments.csv",["PAN,Party,Code,Paid on,Gross,TDS,Status,Country,Rate %,Act or DTAA,Remittance,Challan no","ZZZPZ0003Z,Invented Overseas Ltd,1057,15/07/2026,100000.00,10000.00,1,265,10,B,49,7"]);

    await emailStep(page,email);await page.getByLabel("6 digit code from the app").fill(totp(key));await page.getByRole("button",{name:"Continue"}).click();await expect(page).toHaveURL(/\/app$/);
    const today=todayInIndia(),created=`${today.slice(8,10)}${today.slice(5,7)}${today.slice(0,4)}`;
    const record=(values:Record<number,string>)=>Array.from({length:45},(_,at)=>values[at+1] ?? "").join("^");
    // One statement: read the register with the chosen columns, type the challan, check, prepare, download.
    const statement=async(form:string,file:string,rows:string,columns:[string,string][],challan:string,tax:string)=>{
      await page.getByRole("link",{name:`Read ${file} as ${rows}`}).click();
      for(const [field,column] of columns) await page.getByLabel(new RegExp(`^${field.replace(/[()]/g,"\\$&")}`)).first().selectOption({label:column});
      await page.getByRole("button",{name:`Confirm columns and read ${rows}`}).click();await expect(page.getByText("Figures read. Check them below.")).toBeVisible();
      await page.getByLabel(`Was a regular Form No. ${form} filed for an earlier quarter?`).selectOption("N");await page.getByRole("button",{name:"Save answer"}).click();await expect(page.getByText("Saved for checking.")).toBeVisible();
      for(const [name,value] of [["bsr","0510308"],["date","2026-08-07"],["number",challan],["tax",tax]]) await page.locator(`form [name="${name}"]`).fill(value);
      await page.getByRole("button",{name:"Add challan"}).click();await expect(page.getByText("Saved for checking.")).toBeVisible();
      await page.getByRole("button",{name:"Yes, these figures are right"}).click();await expect(page.getByText("Every figure is checked. Prepare the statement below.")).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.getByRole("button",{name:`Prepare Form No. ${form}`}).click();await expect(page).toHaveURL(/tab=outputs/);
      const [made]=await query(local.dbUrl,"select * from public.documents where firm_id=$1 and prepared->>'form'=$2",[firm.firmId,`TDS${form}`]);files.push(made.drive_file_id);
      expect(made.name).toBe(`Invented TDS Client - Form No. ${form} - Jul to Sep 2026 - v1.txt`);
      const card=page.locator("li").filter({has:page.getByRole("link",{name:made.name,exact:true})});
      const download=page.waitForEvent("download",{timeout:20_000});await card.getByRole("button",{name:"Download for filing"}).click();
      const records=(await readFile((await (await download).path())!,"latin1")).split("\r\n");
      expect(records).toHaveLength(5);expect(records.at(-1)).toBe("");
      return {made,card,records};
    };

    // The quarter's TCS return opens its Form No. 143.
    await page.goto(`/app/clients/${client}?tab=returns`);await page.getByRole("link",{name:/^Prepare TCS return/}).click();
    await expect(page.getByRole("heading",{name:"Form No. 143, Jul to Sep 2026"})).toBeVisible();
    const tcs=await statement("143","Invented TCS register.csv","collections",[["Collectee PAN","A: Buyer PAN"],["Collectee name","B: Buyer"],["Collection code","C: Code"],["Date received or debited","D: Received on"],["Amount received or debited","E: Amount"],["Tax collected","F: TCS"],["Collectee code","G: Buyer type"],["Rate","H: Rate %"],["Challan serial number","I: Challan no"]],"21","2000");
    expect(tcs.records.slice(0,3)).toEqual([`1^FH^TC1^R^${created}^1^D^${tan}^1^InboxCA^^^^^^^^`,expect.stringMatching(new RegExp(`^2\\^BH\\^1\\^1\\^143\\^\\^\\^\\^\\^\\^\\^\\^${tan}\\^\\^${pan}\\^202728\\^202627\\^Q2\\^Invented TDS Client\\^`)),"3^CD^1^1^1^N^^2000.00^0.00^0.00^0.00^2000.00^C^^0510308^^00021^^07082026^^2000.00^2000.00^200^0.00^0.00^^^^^"]);
    expect(tcs.records[3]).toBe(record({1:"4",2:"DD",3:"1",4:"1",5:"1",6:"O",8:"ZZZPZ0002Z",9:"Invented Scrap Buyer",11:"N",12:"7",14:"N",15:"1073",18:"Y",19:"20072026",20:"200000.00",24:"2000.00",25:"2000.00",27:"20072026",28:"1.0000"}));
    // Marking it filed closes the TCS return, and keeps the token for the next quarter.
    await tcs.card.locator("summary",{hasText:"Mark filed"}).click();await tcs.card.getByLabel("Acknowledgement number, if known").fill("123456789012345");await tcs.card.getByRole("button",{name:"Mark filed",exact:true}).click();
    await expect.poll(async()=>(await query(local.dbUrl,"select status from public.tasks where firm_id=$1 and code='TCS_RET'",[firm.firmId]))[0].status).toBe("filed");
    await page.goto(`/app/clients/${client}/tds?tan=${registration}&period=2026-12&form=TDS143`);
    await expect(page.getByLabel("If yes, its 15 digit token number")).toHaveValue("123456789012345");

    // Form No. 144 from the same TAN's statements.
    await page.getByRole("link",{name:"Form No. 144 (27Q)"}).click();await expect(page.getByRole("heading",{name:"Form No. 144, Oct to Dec 2026"})).toBeVisible();await page.getByLabel("Quarter",{exact:true}).selectOption("2026-09");await page.getByRole("button",{name:"Open"}).click();
    await expect(page.getByRole("heading",{name:"Form No. 144, Jul to Sep 2026"})).toBeVisible();
    // A register read into Form No. 143 is not offered again.
    await expect(page.getByRole("link",{name:"Read Invented TCS register.csv as payments"})).toHaveCount(0);
    const abroad=await statement("144","Invented foreign payments.csv","payments",[["Deductee PAN","A: PAN"],["Deductee name","B: Party"],["Section code","C: Code"],["Date of payment or credit","D: Paid on"],["Amount paid or credited","E: Gross"],["Tax deducted","F: TDS"],["Status code","G: Status"],["Country code","H: Country"],["Rate","I: Rate %"],["Rate under the Act (A) or DTAA (B)","J: Act or DTAA"],["Nature of remittance code","K: Remittance"],["Challan serial number","L: Challan no"]],"7","10000");
    expect(abroad.records.slice(0,2).map(line=>line.split("^").slice(0,5).join("^"))).toEqual([`1^FH^NS1^R^${created}`,"2^BH^1^1^144"]);
    expect(abroad.records[3]).toBe(record({1:"4",2:"DD",3:"1",4:"1",5:"1",6:"O",8:"ZZZPZ0003Z",9:"Invented Overseas Ltd",12:"1",14:"N",15:"1057",16:"49",17:"265",18:"Y",19:"15072026",20:"100000.00",21:"N",24:"10000.00",25:"10000.00",27:"15072026",28:"10.0000",30:"B"}));

    // Form No. 138 for January to March waits for Protean's Q4 format.
    await page.goto(`/app/clients/${client}/tds?tan=${registration}&period=2027-03&form=TDS138`);
    await expect(page.getByRole("heading",{name:"Waiting for Protean's format"})).toBeVisible();
    await expect(page.getByRole("button",{name:/^Prepare Form No/})).toHaveCount(0);
  } finally {
    for(const file of (await query(local.dbUrl,"select drive_file_id from public.documents where firm_id=$1",[firm.firmId]))) if(file.drive_file_id) files.push(file.drive_file_id);
    for(const id of new Set(files)) await drive.trash(id).catch(()=>{});
    await firm.remove();
  }
});
