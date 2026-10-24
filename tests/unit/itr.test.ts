import {afterEach,expect,it,vi} from "vitest";
import {itrRequest} from "../fixtures/itr";
import {editedItr,itrBody,itrCreation,itrEntries,itrEntry} from "../../worker/itr";
import {itrChecks} from "../../worker/itr-rules";
import {prepare} from "../../worker/prepare";
import {officialSchema} from "../../worker/schema";
import {chooseTemplate} from "@/src/lib/templates";
import {formRequest} from "@/src/lib/form-worker";

afterEach(()=>vi.unstubAllEnvs());
it.each(["ITR1","ITR4"])("builds %s from the pinned schema, preserves the official metadata and refuses real exports",form=>{
  const request=itrRequest(form);
  expect(()=>prepare(request)).toThrow("not ready");
  vi.stubEnv("FILE_WORKER_TEST","1");
  const official=officialSchema(request.template.source.file,request.template.source.sha256);
  let output:ReturnType<typeof prepare>;
  try {output=prepare(request);} catch(error) {throw new Error(`${error}: ${JSON.stringify(official.validate.errors)}`);}
  const value=JSON.parse(output.bytes.toString());
  expect(official.validate(value),JSON.stringify(official.validate.errors)).toBe(true);
  expect(value.ITR[form][`Form_${form}`]).toMatchObject({AssessmentYear:"2026",SchemaVer:"Ver1.0",FormVer:"Ver1.0"});
  expect(value.ITR[form].PersonalInfo.PAN).toBe(request.pan);
  expect(value.ITR[form].CreationInfo.SWCreatedBy).toBe("SW00000000"); // ggignore: invented software identity only permitted by the test worker.
  expect(itrChecks(value.ITR[form],form)).toEqual([]);
  expect(()=>itrBody({...request,pan:"ZZZPZ0002Z"},itrCreation())).toThrow("PAN"); // ggignore: another invented PAN.
  expect(()=>itrBody({...request,period:"2025"},itrCreation())).toThrow("year");
  expect(()=>itrBody({...request,drafts:[{...request.drafts[0],figures:[]}]},itrCreation())).toThrow();
  expect(()=>itrBody({...request,drafts:[request.drafts[0],request.drafts[0]]},itrCreation())).toThrow("Two sources");
});
it("pins the field choices, resolves official repeating entries and keeps assessment years separate from months",()=>{
  const request=itrRequest(),entries=itrEntries(request.template);
  expect(entries.some(entry=>entry.field==="itr.salary.gross")).toBe(true);
  expect(itrEntry(request.template,"itr.tds.other.3.claimed").path).toBe("TDSonOthThanSals.TDSonOthThanSal.3.ClaimOutOfTotTDSOnAmtPaid");
  for(const field of ["itr.unknown","itr.tds.other.claimed","itr.tds.other.1000.claimed"]) expect(()=>itrEntry(request.template,field)).toThrow();
  expect(()=>itrEntries({...request.template,version:"9.9"})).toThrow("version");
  expect(formRequest.safeParse({...request,purpose:"fields",drafts:[]}).success).toBe(true);
  expect(formRequest.safeParse({...request,purpose:"fields"}).success).toBe(false);
  expect(formRequest.safeParse({...request,period:"2026-04"}).success).toBe(false);
  const old={...request.template,version:"0.9",status:"retired" as const,valid_from:"2025-04-01",valid_until:"2026-04-01"};
  expect(chooseTemplate([request.template,old],"ITR1","2025")).toEqual(old);
  expect(chooseTemplate([old,request.template],"ITR1","2026")).toEqual(request.template);
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
it("keeps earlier TDS separate from current TDS rather than discarding or double claiming it",()=>{
  // ITR-4 rules 113 to 115. Invented amounts for the separate-row rule.
  const row={BroughtFwdTDSAmt:100,TDSDeducted:0,DeductedYr:"2024",TDSClaimed:100},body={TDSonOthThanSals:{TDSonOthThanSalDtls:[row]}};
  expect(itrChecks(body,"ITR4")).toEqual([]);
  row.TDSClaimed=101;expect(itrChecks(body,"ITR4")).toContain("TDS: the amount claimed is more than the amount reported.");
  row.TDSClaimed=100;row.TDSDeducted=100;expect(itrChecks(body,"ITR4")).toContain("Keep earlier and current TDS on separate rows.");
});
it.each(["ITR1","ITR4"])("reads an edited %s into unchecked source positions and refuses another taxpayer or year",form=>{
  vi.stubEnv("FILE_WORKER_TEST","1");
  const request=itrRequest(form),output=prepare(request),context={template:request.template,period:request.period,pan:request.pan!};
  const {lines}=editedItr(output.bytes,context);
  expect(lines.length).toBe(request.drafts[0].figures.length);
  expect(lines.every(line=>line.path.startsWith(`/ITR/${form}/`) && line.page>=1 && line.page<=30)).toBe(true);
  expect(lines.some(line=>line.path.endsWith("/CreationInfo/SWCreatedBy"))).toBe(false);
  expect(()=>editedItr(output.bytes,{...context,pan:"ZZZPZ0002Z"})).toThrow("client"); // ggignore: another invented PAN.
  expect(()=>editedItr(output.bytes,{...context,period:"2025"})).toThrow("year");
  const wrong=JSON.parse(output.bytes.toString());wrong.ITR[form].TaxPaid.TaxesPaid.TotalTaxesPaid=1;
  expect(()=>editedItr(Buffer.from(JSON.stringify(wrong)),context)).toThrow("checked");
});
