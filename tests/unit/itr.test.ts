import {afterEach,expect,it,vi} from "vitest";
import {itrRequest} from "../fixtures/itr";
import {editedItr,itrBody,itrCreation,itrEntries,itrEntry,itrReview,itrValue} from "../../worker/itr";
import {itrChecks} from "../../worker/itr-rules";
import {prepare} from "../../worker/prepare";
import {officialSchema} from "../../worker/schema";
import {chooseTemplate} from "@/src/lib/templates";
import {formRequest} from "@/src/lib/form-worker";
import {itrReturns} from "@/src/lib/itr-fields";

const ready=()=>{vi.stubEnv("ITR_SOFTWARE_ID","SW00000000");vi.stubEnv("ITR_SOFTWARE_CITY","Invented City");}; // ggignore: invented software identity for tests only.
afterEach(()=>vi.unstubAllEnvs());
it.each(itrReturns)("builds %s from the pinned schema only when the software ID is set",form=>{
  const request=itrRequest(form);
  vi.stubEnv("ITR_SOFTWARE_ID","");
  expect(()=>prepare(request)).toThrow("cannot make ITR files yet");
  ready();
  const official=officialSchema(request.template.source.file,request.template.source.sha256);
  const value=JSON.parse(prepare(request).bytes.toString());
  expect(official.validate(value),JSON.stringify(official.validate.errors)).toBe(true);
  expect(value.ITR[form][`Form_${form}`]).toMatchObject({FormName:form.replace("ITR","ITR-"),AssessmentYear:"2026",SchemaVer:"Ver1.0",FormVer:"Ver1.0"});
  expect(JSON.stringify(value)).toContain('"PAN":"ZZZPZ0001Z"'); // ggignore: the invented client PAN, filled from the registration.
  expect(value.ITR[form].CreationInfo).toMatchObject({SWCreatedBy:"SW00000000",JSONCreatedBy:"SW00000000",IntermediaryCity:"Invented City",Digest:"-"});
  expect(itrChecks(value.ITR[form],form)).toEqual([]);
  expect(itrReview(request)).toEqual({missing:[],issues:[]});
  expect(()=>itrBody({...request,period:"2025"},itrCreation(request.template))).toThrow("year");
  expect(()=>itrBody({...request,drafts:[request.drafts[0],request.drafts[0]]},itrCreation(request.template))).toThrow("Two papers or entries give the same figure.");
  // A PAN typed into the figures must be the client's own.
  const pan=itrEntries(request.template).find(entry=>entry.field==="itr.personal.pan")!;
  expect(()=>itrBody({...request,drafts:[{...request.drafts[0],figures:[...request.drafts[0].figures,["itr.personal.pan",{label:"PAN",value:"ZZZPZ0002Z"}]]}]},itrCreation(request.template))).toThrow("PAN"); // ggignore: another invented PAN.
  expect(pan.required).toBe(true);
});
it.each(itrReturns)("lists what %s still needs, in plain words, and never fills it",form=>{
  const request=itrRequest(form),empty=itrReview({...request,purpose:"check",drafts:[]});
  const required=request.drafts[0].figures.length;
  expect(empty.missing.length).toBeGreaterThanOrEqual(required);
  expect(empty.missing.every(item=>item.label && item.group && !/undefined/.test(item.label))).toBe(true);
  expect(empty.missing.some(item=>item.field==="itr.personal.pan")).toBe(false);
  expect(empty.missing.some(item=>item.field==="itr.personal.email")).toBe(true);
  // Leaving one figure out names exactly that figure; a wrong value says what to fix.
  const [field]=request.drafts[0].figures.find(([field])=>field==="itr.personal.email")!;
  const less=itrReview({...request,drafts:[{...request.drafts[0],figures:request.drafts[0].figures.filter(([name])=>name!==field)}]});
  expect(less.missing).toEqual([expect.objectContaining({field,label:"Email address"})]);
  const wrong=itrReview({...request,drafts:[{...request.drafts[0],figures:request.drafts[0].figures.map(([name,figure])=>[name,name===field ? {...figure,value:"not an email"} : figure] as const)}]});
  expect(wrong.issues).toEqual(["Email address: check the format."]);
  ready();expect(()=>itrBody(less as never,itrCreation(request.template))).toThrow();
  expect(()=>prepare({...request,drafts:[{...request.drafts[0],figures:request.drafts[0].figures.filter(([name])=>name!==field)}]})).toThrow("Still to fill: Email address");
});
it.each(itrReturns)("refuses %s dates the schema rules out and amounts out of range",form=>{
  const request=itrRequest(form),entries=itrEntries(request.template);
  const dob=entries.find(entry=>entry.latest),amount=entries.find(entry=>entry.path.endsWith("TaxesPaid.TotalTaxesPaid"))!;
  const change=(field:string,value:string)=>itrReview({...request,drafts:[{...request.drafts[0],figures:request.drafts[0].figures.map(([name,figure])=>[name,name===field ? {...figure,value} : figure] as const)}]});
  if(dob && request.drafts[0].figures.some(([field])=>field===dob.field)) expect(change(dob.field,"2026-04-01").issues).toContain(`${dob.label}: the official form allows dates up to ${dob.latest}.`);
  expect(change(amount.field,"-1").issues.join(" ")).toMatch(/must be 0 or more|do not add up/);
});
it("pins the field choices, resolves official repeating entries and keeps assessment years separate from months",()=>{
  const request=itrRequest(),entries=itrEntries(request.template);
  expect(entries.some(entry=>entry.field==="itr.salary.gross")).toBe(true);
  expect(itrEntry(request.template,"itr.tds.other.3.claimed").path).toBe("TDSonOthThanSals.TDSonOthThanSal.3.ClaimOutOfTotTDSOnAmtPaid");
  for(const field of ["itr.unknown","itr.tds.other.claimed","itr.tds.other.1000.claimed"]) expect(()=>itrEntry(request.template,field)).toThrow();
  expect(()=>itrEntries({...request.template,version:"9.9"})).toThrow("does not have this official ITR form");
  expect(()=>itrEntries({...itrRequest("ITR2").template,form_code:"ITR5"})).toThrow("does not have this official ITR form");
  expect(formRequest.safeParse({...request,purpose:"fields",drafts:[]}).success).toBe(true);
  expect(formRequest.safeParse({...request,purpose:"fields"}).success).toBe(false);
  expect(formRequest.safeParse({...request,purpose:"check",drafts:[]}).success).toBe(true);
  expect(formRequest.safeParse({...request,drafts:[]}).success).toBe(false);
  expect(formRequest.safeParse({...request,period:"2026-04"}).success).toBe(false);
  const old={...request.template,version:"0.9",status:"retired" as const,valid_from:"2025-04-01",valid_until:"2026-04-01"};
  expect(chooseTemplate([request.template,old],"ITR1","2025")).toEqual(old);
  expect(chooseTemplate([old,request.template],"ITR1","2026")).toEqual(request.template);
  // Large parts are split by their next heading; schedules keep their official names.
  const three=itrEntries(itrRequest("ITR3").template);
  expect(new Set(three.map(entry=>entry.group)).size).toBeGreaterThan(40);
  expect(three.some(entry=>entry.group==="Schedule HP")).toBe(true);
  expect(three.filter(entry=>entry.group===three[0].group).length).toBeLessThan(400);
  // That heading is InboxCA's name, else the schema's description, else the key's words; a description two headings share names neither.
  const groups=new Set([...three,...itrEntries(itrRequest("ITR2").template),...entries].map(entry=>entry.group));
  for(const name of ["Schedule CFL: Carry forward losses for AY2025-26","Client and filing details: Client details","Client and filing details: Filing details","Income and deductions: Usr Deduct Und Chap VIA","Income and deductions: Deduct Und Chap VIA"]) expect(groups).toContain(name);
  // A detail InboxCA has no label for reads the schema's own description, else its own name
  // from the schema, as the utility shows it.
  expect(entries.find(entry=>entry.path==='PersonalInfo.DOB')?.label).toBe('Date of Birth of the Assessee');
  expect(entries.find(entry=>entry.path==='PersonalInfo.Address.RoadOrStreet')?.label).toBe('Address, Road Or Street');
});
it.each(["ITR1","ITR4"])("blocks wrong salary, deductions, tax totals and overclaimed credits in %s",form=>{
  // ITR-1 rules 59 to 62, 24 to 28, 96, 98, 104 to 106; ITR-4 63 to 66, 46, 52 to 56, 111, 113, 127 to 129.
  // Invented arithmetic examples. The PDFs give equations, not worked numeric examples.
  const income=form==="ITR1" ? "ITR1_IncomeDeductions" : "IncomeDeductions",tax=form==="ITR1" ? "ITR1_TaxComputation" : "TaxComputation";
  const body={ [income]:{Salary:400000,PerquisitesValue:10000,ProfitsInSalary:0,GrossSalary:410000,AllwncExemptUs10:{TotalAllwncExemptUs10:10000},NetSalary:400000,DeductionUs16ia:50000,[form==="ITR1" ? "EntertainmentAlw16ii" : "EntertainmntalwncUs16ii"]:0,ProfessionalTaxUs16iii:0,DeductionUs16:50000,IncomeFromSal:350000,GrossTotIncome:350000,DeductUndChapVIA:{TotalChapVIADeductions:10000},TotalIncome:340000}, [tax]:{TotalTaxPayable:10000,Rebate87A:5000,TaxPayableOnRebate:5000,EducationCess:200,GrossTaxLiability:5200,Section89:0,NetTaxLiability:5200,TotalIntrstPay:300,IntrstPay:{IntrstPayUs234A:100,IntrstPayUs234B:100,IntrstPayUs234C:100,LateFilingFee234F:0},TotTaxPlusIntrstPay:5500}, TaxPaid:{TaxesPaid:{AdvanceTax:1000,TDS:4000,TCS:0,SelfAssessmentTax:1000,TotalTaxesPaid:6000},BalTaxPayable:0},Refund:{RefundDue:500},ScheduleTCS:{TCS:[{TotalTCS:100,AmtTCSClaimedThisYear:100}]},TDSonOthThanSals:{[form==="ITR1" ? "TDSonOthThanSal" : "TDSonOthThanSalDtls"]:[{TotTDSOnAmtPaid:100,ClaimOutOfTotTDSOnAmtPaid:100,TDSDeducted:100,TDSClaimed:100}]}};
  expect(itrChecks(body,form)).toEqual([]);
  for(const [section,key] of [[income,"GrossSalary"],[income,"NetSalary"],[income,"DeductionUs16"],[income,"IncomeFromSal"],[income,"TotalIncome"],[tax,"TaxPayableOnRebate"],[tax,"GrossTaxLiability"],[tax,"NetTaxLiability"],[tax,"TotTaxPlusIntrstPay"]]) {
    const wrong=structuredClone(body);(wrong[section] as Record<string,unknown>)[key]=1;expect(itrChecks(wrong,form).length).toBeGreaterThan(0);
  }
  body.Refund.RefundDue=501;expect(itrChecks(body,form)).toContain("Refund: the figures do not add up.");
  body.ScheduleTCS.TCS[0].AmtTCSClaimedThisYear=101;expect(itrChecks(body,form)).toContain("TCS: the amount claimed is more than the amount reported.");
});
it.each(["ITR2","ITR3"])("blocks wrong tax, interest, taxes paid, refund and special rate totals in %s",form=>{
  // ITR-2 rules 523 to 525, 528 to 531, 536, 537; ITR-3 rules 963 to 965, 968 to 971, 976, 977. Invented amounts.
  const rebate={Rebate87A:1000,TaxPayableOnRebate:9000,TotalSurcharge:0,EducationCess:360,GrossTaxLiability:9360};
  const on={TaxAtNormalRatesOnAggrInc:8000,TaxAtSpecialRates:2500,RebateOnAgriInc:500,TaxPayableOnTotInc:10000,...(form==="ITR3" ? rebate : {})};
  const body={"PartB-TI":{IncChargeableTaxSplRates:20000},ScheduleSI:{TotSplRateInc:20000},PartB_TTI:{ComputationOfTaxLiability:{TaxPayableOnTI:on,...(form==="ITR2" ? rebate : {}),TaxRelief:{Section89:100,TotTaxRelief:100},NetTaxLiability:9260,IntrstPay:{IntrstPayUs234A:10,IntrstPayUs234B:20,IntrstPayUs234C:30,LateFilingFee234F:40,TotalIntrstPay:100},AggregateTaxInterestLiability:9360},TaxPaid:{TaxesPaid:{AdvanceTax:5000,TDS:4000,TCS:0,SelfAssessmentTax:1000,TotalTaxesPaid:10000},BalTaxPayable:0},Refund:{RefundDue:640}}};
  expect(itrChecks(body,form)).toEqual([]);
  const at=(path:string)=>{const keys=path.split(".");return [keys.slice(0,-1).reduce<Record<string,unknown>>((node,key)=>node[key] as Record<string,unknown>,body),keys.at(-1)!] as const;};
  const level=form==="ITR3" ? "PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI" : "PartB_TTI.ComputationOfTaxLiability";
  for(const path of ["PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI.TaxPayableOnTotInc",`${level}.TaxPayableOnRebate`,`${level}.GrossTaxLiability`,"PartB_TTI.ComputationOfTaxLiability.TaxRelief.TotTaxRelief","PartB_TTI.ComputationOfTaxLiability.IntrstPay.TotalIntrstPay","PartB_TTI.ComputationOfTaxLiability.AggregateTaxInterestLiability","PartB_TTI.TaxPaid.TaxesPaid.TotalTaxesPaid","PartB_TTI.TaxPaid.BalTaxPayable","PartB_TTI.Refund.RefundDue","PartB-TI.IncChargeableTaxSplRates"]) {
    const [node,key]=at(path),before=node[key];node[key]=Number(before)+1;
    expect(itrChecks(body,form).length,path).toBeGreaterThan(0);node[key]=before;
  }
});
it("keeps earlier TDS separate from current TDS rather than discarding or double claiming it",()=>{
  // ITR-4 rules 113 to 115. Invented amounts for the separate-row rule.
  const row={BroughtFwdTDSAmt:100,TDSDeducted:0,DeductedYr:"2024",TDSClaimed:100},body={TDSonOthThanSals:{TDSonOthThanSalDtls:[row]}};
  expect(itrChecks(body,"ITR4")).toEqual([]);
  row.TDSClaimed=101;expect(itrChecks(body,"ITR4")).toContain("TDS: the amount claimed is more than the amount reported.");
  row.TDSClaimed=100;row.TDSDeducted=100;expect(itrChecks(body,"ITR4")).toContain("Keep earlier and current TDS on separate rows.");
});
it.each(itrReturns)("reads an edited %s into unchecked source positions and refuses another taxpayer or year",form=>{
  ready();
  const request=itrRequest(form),output=prepare(request),context={template:request.template,period:request.period,pan:request.pan!};
  const layout=editedItr(output.bytes,context);
  expect(layout.lines.length).toBe(request.drafts[0].figures.length+1);
  expect(layout.lines.every(line=>line.path.startsWith(`/ITR/${form}/`) && line.page>=1 && line.page<=30)).toBe(true);
  expect(layout.lines.some(line=>line.path.endsWith("/CreationInfo/SWCreatedBy"))).toBe(false);
  expect(()=>editedItr(output.bytes,{...context,pan:"ZZZPZ0002Z"})).toThrow("client"); // ggignore: another invented PAN.
  expect(()=>editedItr(output.bytes,{...context,period:"2025"})).toThrow("year");
  const wrong=JSON.parse(output.bytes.toString()),paid=form==="ITR2" || form==="ITR3" ? wrong.ITR[form].PartB_TTI : wrong.ITR[form];
  paid.TaxPaid.TaxesPaid.TotalTaxesPaid=1;
  expect(()=>editedItr(Buffer.from(JSON.stringify(wrong)),context)).toThrow("checked");
});

it("takes a whole rupee amount read with paise, and asks a person to round real paise",()=>{
  const whole={primitive:"integer"} as Parameters<typeof itrValue>[0];
  expect(itrValue(whole,"1200000.00")).toBe(1200000);
  expect(itrValue(whole,"1200000.0")).toBe(1200000);
  expect(itrValue(whole,"-500.00")).toBe(-500);
  expect(()=>itrValue(whole,"1200000.50")).toThrow("round this amount to whole rupees.");
  expect(()=>itrValue(whole,"12,00,000")).toThrow("enter digits only, with up to two decimal places.");
  expect(itrValue({primitive:"number"} as Parameters<typeof itrValue>[0],"1200.50")).toBe(1200.5);
});
