type Values=Record<string,unknown>;
const object=(value:unknown)=>(value && typeof value==="object" && !Array.isArray(value) ? value : {}) as Values;
const read=(value:Values,path:string):unknown=>path.split(".").reduce<unknown>((at,key)=>object(at)[key],value);

// ITR-1 and ITR-4 AY 2026-27 validation PDFs, arithmetic rules only.
// Tax rates, portal records and other conditional eligibility rules are not inferred.
export function itrChecks(body:Values,form:string) {
  const issues:string[]=[],income=form==="ITR1" ? "ITR1_IncomeDeductions" : "IncomeDeductions",tax=form==="ITR1" ? "ITR1_TaxComputation" : "TaxComputation";
  const equal=(root:Values,total:string,parts:string[],label:string,calculate=(values:number[])=>values.reduce((a,b)=>a+b,0))=>{
    const actual=read(root,total),values=parts.map(path=>read(root,path));
    if(typeof actual==="number" && values.every(value=>typeof value==="number") && Math.abs(actual-calculate(values as number[]))>0.001) issues.push(`${label}: the figures do not add up.`);
  };
  const subtract=([a,b]:number[])=>a-b;
  const i=object(body[income]),t=object(body[tax]),paid=object(object(body.TaxPaid).TaxesPaid);
  // ITR-1 59 to 62; ITR-4 63 to 66.
  equal(i,"GrossSalary",["Salary","PerquisitesValue","ProfitsInSalary"],"Gross salary");
  equal(i,"NetSalary",["GrossSalary","AllwncExemptUs10.TotalAllwncExemptUs10"],"Net salary",subtract);
  equal(i,"DeductionUs16",["DeductionUs16ia",form==="ITR1" ? "EntertainmentAlw16ii" : "EntertainmntalwncUs16ii","ProfessionalTaxUs16iii"],"Salary deductions");
  equal(i,"IncomeFromSal",["NetSalary","DeductionUs16"],"Salary income",subtract);
  // ITR-1 17 and 18; ITR-4 18 and 19.
  const deductions=object(i.DeductUndChapVIA),parts=Object.keys(deductions).filter(key=>key!=="TotalChapVIADeductions");
  if(parts.length) equal(deductions,"TotalChapVIADeductions",parts,"Deductions");
  if(typeof deductions.TotalChapVIADeductions==="number" && typeof i.GrossTotIncome==="number" && deductions.TotalChapVIADeductions>i.GrossTotIncome) issues.push("Deductions cannot be more than gross total income.");
  // ITR-1 24 to 28 and 140; ITR-4 46 and 52 to 56.
  equal(i,"TotalIncome",["GrossTotIncome","DeductUndChapVIA.TotalChapVIADeductions"],"Total income",values=>Math.max(0,subtract(values)));
  equal(t,"TaxPayableOnRebate",["TotalTaxPayable","Rebate87A"],"Tax after rebate",subtract);
  equal(t,"GrossTaxLiability",["TaxPayableOnRebate","EducationCess"],"Tax and cess");
  equal(t,"NetTaxLiability",["GrossTaxLiability","Section89"],"Tax after relief",subtract);
  const interest=["IntrstPayUs234A","IntrstPayUs234B","IntrstPayUs234C","LateFilingFee234F"].map(key=>Number(object(t.IntrstPay)[key] ?? NaN));
  const extra=object(t.IntrstPay).FeeFurnish234I;
  if(extra!==undefined) interest.push(Number(extra));
  if(interest.every(Number.isFinite)) {
    const sum=interest.reduce((a,b)=>a+b,0);
    if(form==="ITR1" && typeof t.TotalIntrstPay==="number" && t.TotalIntrstPay!==sum) issues.push("Interest and fees: the figures do not add up.");
    if(typeof t.NetTaxLiability==="number" && typeof t.TotTaxPlusIntrstPay==="number" && t.TotTaxPlusIntrstPay!==t.NetTaxLiability+sum) issues.push("Total tax, interest and fees: the figures do not add up.");
  }
  // ITR-1 104 to 106; ITR-4 127 to 129.
  equal(paid,"TotalTaxesPaid",["AdvanceTax","TDS","TCS","SelfAssessmentTax"],"Taxes paid");
  equal(body,"Refund.RefundDue",["TaxPaid.TaxesPaid.TotalTaxesPaid",`${tax}.TotTaxPlusIntrstPay`],"Refund",values=>Math.max(0,subtract(values)));
  equal(body,"TaxPaid.BalTaxPayable",[`${tax}.TotTaxPlusIntrstPay`,"TaxPaid.TaxesPaid.TotalTaxesPaid"],"Tax still payable",values=>Math.max(0,subtract(values)));
  // ITR-1 96 and 98; ITR-4 111 and 113. No tax credit is silently claimed.
  const upper=(rows:unknown,claimed:string,available:string,label:string)=>{
    if(Array.isArray(rows) && rows.some(row=>typeof object(row)[claimed]==="number" && typeof object(row)[available]==="number" && Number(object(row)[claimed])>Number(object(row)[available]))) issues.push(`${label}: the amount claimed is more than the amount reported.`);
  };
  upper(object(body.ScheduleTCS).TCS,"AmtTCSClaimedThisYear","TotalTCS","TCS");
  if(form==="ITR1") upper(object(body.TDSonOthThanSals).TDSonOthThanSal,"ClaimOutOfTotTDSOnAmtPaid","TotTDSOnAmtPaid","TDS");
  // ITR-4 114 and 115: brought forward and current tax use separate rows.
  const other=object(body.TDSonOthThanSals).TDSonOthThanSalDtls;
  if(form==="ITR4" && Array.isArray(other)) for(const row of other) {
    const entry=object(row),before=Number(entry.BroughtFwdTDSAmt ?? 0),current=Number(entry.TDSDeducted ?? 0);
    if(before>0 && current>0) issues.push("Keep earlier and current TDS on separate rows.");
    if(before>0 && !entry.DeductedYr) issues.push("Enter the year of earlier TDS.");
    if(typeof entry.TDSClaimed==="number" && entry.TDSClaimed>before+current) issues.push("TDS: the amount claimed is more than the amount reported.");
  }
  return issues;
}
