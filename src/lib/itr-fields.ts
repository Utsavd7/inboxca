export const itrForms=["ITR1","ITR2","ITR3","ITR4","ITR5","ITR6"] as const;
export type ItrForm=typeof itrForms[number];

// AY 2026-27 schemas from the Income Tax Department; hashes and URLs are in itr/README.md.
export const itrSources={
  ITR1:{file:"ITR-1_2026_Main_V1.1.json",version:"1.1",sha256:"6a0ef9f64065431879dcc724869d8455a640bcf11279d1818eb19f11448ce763"},
  ITR2:{file:"ITR-2_2026_Main_V1.2.json",version:"1.2",sha256:"4e34389cb1cb1a0d9261fc6db8594d9bdfaf761f13d4af6b84c1862510e2aeeb"},
  ITR3:{file:"ITR-3_2026_Main_V1.1.json",version:"1.1",sha256:"66f4bd705e0e0788fdacb37eb297ace56749d791b84f2f170f4da84236c25e8b"},
  ITR4:{file:"ITR-4_2026_Main_V1.1.json",version:"1.1",sha256:"5e9af50083ad92faa684a02ae51693189b43df16b92c1da5a184026fc5cdc2ac"},
  ITR5:{file:"ITR-5_2026_Main_V1.1.json",version:"1.1",sha256:"3bb5f158f63556c3b91706de2901dba7e4c71039e12ec7a181c4dfc96fead6a9"},
  ITR6:{file:"ITR-6_2026_Main_V1.0.json",version:"1.0",sha256:"15fb24266820944b0ca69b16f35459eea75bdb21f653e5e07e3400d16ed83e6a"},
} as const;

// Paths are relative to ITR.ITRn. An asterisk is one zero based row, not a sum.
const paths=(one:string|null,four:string|null,others:string|null):Partial<Record<ItrForm,string>>=>Object.fromEntries(itrForms.flatMap(form=>{const path=form==="ITR1" ? one : form==="ITR4" ? four : others;return path ? [[form,path]] : [];}));
const salary=(tail:string)=>paths(`ITR1_IncomeDeductions.${tail}`,`IncomeDeductions.${tail}`,null);
const taxes=(tail:string)=>paths(`TaxPaid.TaxesPaid.${tail}`,`TaxPaid.TaxesPaid.${tail}`,`PartB_TTI.TaxPaid.TaxesPaid.${tail}`);
const detail="EmployerOrDeductorOrCollectDetl";
const salaryRows=(tail:string)=>({ITR1:`TDSonSalaries.TDSonSalary.*.${tail}`,ITR4:`TDSonSalaries.TDSonSalary.*.${tail}`,ITR2:`ScheduleTDS1.TDSonSalary.*.${tail}`,ITR3:`ScheduleTDS1.TDSonSalary.*.${tail}`});
const otherRows=(one:string,four:string,others:string)=>paths(`TDSonOthThanSals.TDSonOthThanSal.*.${one}`,`TDSonOthThanSals.TDSonOthThanSalDtls.*.${four}`,`ScheduleTDS2.TDSOthThanSalaryDtls.*.${others}`);

export const itrFields={
  // Salary: IncomeDeductions in ITR-1/4, ScheduleS and PartB-TI in ITR-2/3.
  "itr.salary.gross":{label:"Gross salary",paths:{...salary("GrossSalary"),ITR2:"ScheduleS.TotalGrossSalary",ITR3:"ScheduleS.TotalGrossSalary"}},
  "itr.salary.income":{label:"Income from salary",paths:{...salary("IncomeFromSal"),ITR2:"PartB-TI.Salaries",ITR3:"PartB-TI.Salaries"}},
  // House property: IncomeDeductions and PartB-TI, not gross rent.
  "itr.house_property.income":{label:"Income from house property",paths:paths("ITR1_IncomeDeductions.TotalIncomeChargeableUnHP","IncomeDeductions.TotalIncomeChargeableUnHP","PartB-TI.IncomeFromHP")},
  // Other sources: IncomeDeductions and PartB-TI.IncFromOS.
  "itr.other_sources.income":{label:"Income from other sources",paths:paths("ITR1_IncomeDeductions.IncomeOthSrc","IncomeDeductions.IncomeOthSrc","PartB-TI.IncFromOS.TotIncFromOS")},
  // Capital gains: LTCG112A in ITR-1/4 is not the total of all capital gains.
  "itr.capital_gains.ltcg112a":{label:"Long term gains under section 112A",paths:paths("LTCG112A.LongCap112A","LTCG112A.LongCap112A",null)},
  "itr.capital_gains.total":{label:"Total capital gains",paths:paths(null,null,"PartB-TI.CapGain.TotalCapGains")},
  // Business: IncomeDeductions in ITR-4 and PartB-TI.ProfBusGain in ITR-3/5/6.
  "itr.business.income":{label:"Income from business or profession",paths:{ITR4:"IncomeDeductions.IncomeFromBusinessProf",ITR3:"PartB-TI.ProfBusGain.TotProfBusGain",ITR5:"PartB-TI.ProfBusGain.TotProfBusGain",ITR6:"PartB-TI.ProfBusGain.TotProfBusGain"}},
  // Deductions: DeductUndChapVIA.TotalChapVIADeductions in IncomeDeductions or ScheduleVIA.
  "itr.deductions.total":{label:"Total deductions",paths:paths("ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions","IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions","ScheduleVIA.DeductUndChapVIA.TotalChapVIADeductions")},
  // TDS: salary and other schedules retain each deductor and the credit actually claimed.
  "itr.tds.total":{label:"Total TDS claimed",paths:taxes("TDS")},
  "itr.tds.salary.*.tan":{label:"Employer's TAN",paths:salaryRows(`${detail}.TAN`)},
  "itr.tds.salary.*.name":{label:"Employer's name",paths:salaryRows(`${detail}.EmployerOrDeductorOrCollecterName`)},
  "itr.tds.salary.*.income":{label:"Salary on the tax statement",paths:salaryRows("IncChrgSal")},
  "itr.tds.salary.*.deducted":{label:"TDS on salary",paths:salaryRows("TotalTDSSal")},
  "itr.tds.other.*.tan":{label:"Deductor's TAN",paths:otherRows(`${detail}.TAN`,"TANOfDeductor","TANOfDeductor")},
  "itr.tds.other.*.section":{label:"TDS section",paths:otherRows("TDSSection","TDSSection","TDSSection")},
  "itr.tds.other.*.year":{label:"Year tax was deducted",paths:otherRows("DeductedYr","DeductedYr","DeductedYr")},
  "itr.tds.other.*.income":{label:"Income on the tax statement",paths:otherRows("AmtForTaxDeduct","GrossAmount","GrossAmount")},
  "itr.tds.other.*.deducted":{label:"Tax deducted in your own name",paths:otherRows("TotTDSOnAmtPaid","TDSDeducted","TaxDeductCreditDtls.TaxDeductedOwnHands")},
  "itr.tds.other.*.claimed":{label:"TDS claimed this year in your own name",paths:otherRows("ClaimOutOfTotTDSOnAmtPaid","TDSClaimed","TaxDeductCreditDtls.TaxClaimedOwnHands")},
  // TCS: TaxesPaid.TCS is the claimed credit; amounts collected are separate schedule fields.
  "itr.tcs.total":{label:"Total TCS claimed",paths:taxes("TCS")},
  // Advance and self assessment tax: TaxesPaid and the individual challans in ScheduleIT/TaxPayments.
  "itr.advance_tax.total":{label:"Advance tax paid",paths:taxes("AdvanceTax")},
  "itr.self_assessment_tax.total":{label:"Self assessment tax paid",paths:taxes("SelfAssessmentTax")},
  "itr.tax_payments.*.bsr":{label:"Bank BSR code",paths:paths("TaxPayments.TaxPayment.*.BSRCode","ScheduleIT.TaxPayment.*.BSRCode","ScheduleIT.TaxPayment.*.BSRCode")},
  "itr.tax_payments.*.date":{label:"Tax payment date",paths:paths("TaxPayments.TaxPayment.*.DateDep","ScheduleIT.TaxPayment.*.DateDep","ScheduleIT.TaxPayment.*.DateDep")},
  "itr.tax_payments.*.serial":{label:"Challan number",paths:paths("TaxPayments.TaxPayment.*.SrlNoOfChaln","ScheduleIT.TaxPayment.*.SrlNoOfChaln","ScheduleIT.TaxPayment.*.SrlNoOfChaln")},
  "itr.tax_payments.*.amount":{label:"Tax paid on this challan",paths:paths("TaxPayments.TaxPayment.*.Amt","ScheduleIT.TaxPayment.*.Amt","ScheduleIT.TaxPayment.*.Amt")},
} satisfies Record<string,{label:string;paths:Partial<Record<ItrForm,string>>}>;
