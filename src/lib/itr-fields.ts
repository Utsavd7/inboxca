import {createHash} from "node:crypto";
export const itrForms=["ITR1","ITR2","ITR3","ITR4","ITR5","ITR6"] as const;
export type ItrForm=typeof itrForms[number];
// The returns InboxCA prepares; ITR-5 and ITR-6 follow later (PLAN.md 5.7.3).
export const itrReturns=["ITR1","ITR2","ITR3","ITR4"] as const;
// period_key 2026 is AY 2026-27, the same key as FY 2025-26 elsewhere. From 1 April 2026 the
// Income-tax Act, 2025 has no assessment year: key 2027 is tax year 2026-27.
export const itrYear=(year:string)=>Number(year)>=2027 ? `Tax year ${Number(year)-1}-${year.slice(2)}` : `AY ${year}-${String(Number(year)+1).slice(-2)}`;

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

// A detail's field name: its shared name below, or a short fixed hash of its official path,
// with one * for each repeating row.
export const itrFieldName=(form:ItrForm,path:string)=>Object.entries(itrFields).find(([,entry])=>(entry.paths as Partial<Record<ItrForm,string>>)[form]===path)?.[0] ?? `itr.f.${createHash("sha256").update(path).digest("hex").slice(0,16)}${".*".repeat(path.split(".").filter(key=>key==="*").length)}`;

// The software ID the Income Tax Department gives a registered software, and its city. Off until both are set.
export const itrReady=()=>/^SW\d{8}$/.test(process.env.ITR_SOFTWARE_ID ?? "") && /^.{1,25}$/.test(process.env.ITR_SOFTWARE_CITY?.trim() ?? "");

// The official schema's top level parts by the names CA staff know, shared by the worker's form
// entries and the figures laid out as the return.
export const itrWords=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([a-z])(\d)/g,"$1 $2").replace(/_/g," ");
export const itrGroups:Record<string,string>={PersonalInfo:"Client details",FilingStatus:"Filing details",ITR1_IncomeDeductions:"Income and deductions",IncomeDeductions:"Income and deductions",ITR1_TaxComputation:"Tax amounts",TaxComputation:"Tax amounts",TaxPaid:"Taxes paid",Refund:"Refund and bank details",Verification:"Declaration",TDSonSalaries:"TDS on salary",TDSonOthThanSals:"Other TDS",ScheduleTCS:"TCS",TaxPayments:"Tax challans",ScheduleIT:"Tax challans",ScheduleBP:"Business details",
  PartA_GEN1:"Client and filing details",PartA_GEN2:"Business and audit details",PARTA_BS:"Balance sheet",ManufacturingAccount:"Manufacturing account",TradingAccount:"Trading account",PARTA_PL:"Profit and loss account",PARTA_OI:"Other information",PARTA_QD:"Quantity details","PartB-TI":"Total income",PartB_TTI:"Tax, taxes paid and refund",ScheduleTDS1:"TDS on salary",ScheduleTDS2:"Other TDS",ScheduleCGFor23:"Schedule CG",ScheduleTDS3Dtls:"Schedule TDS3",ScheduleTDS3:"Schedule TDS3",ScheduleEA10_13A:"House rent allowance",LTCG112A:"Long term gains under section 112A"};
// Schedules keep the official names CA staff know, such as Schedule HP or Schedule 80C.
export const itrGroup=(key:string)=>itrGroups[key] ?? (/^(ITR\d)?Schedule/.test(key) ? `Schedule ${key.replace(/^(ITR\d)?Schedule_?/,"").replace(/_/g,"-")}` : itrWords(key));
// Plain words for the AY 2026-27 schemas' own key names where they carry no description, or a
// description two keys share ("Deductions from income"), so an article assistant reads
// "Deductions under Chapter VI-A" and not "Usr Deduct Und Chap VIA". Chapter, section and
// clause numbers are the ones written in the key itself, as the official utility shows them;
// "Usr" is the amount claimed, the other the amount allowed (ITR-1's two deduction blocks).
// From tax year 2026-27 Form No. 130 (Income-tax Rules, 2026, reference/official/income-tax)
// names these Chapter VIII, section 11 and section 19, for the schemas of that year.
export const itrPlainNames:Record<string,string>={
  UsrDeductUndChapVIA:"Deductions under Chapter VI-A, as claimed",DeductUndChapVIA:"Deductions under Chapter VI-A, as allowed",TotalChapVIADeductions:"Total deductions under Chapter VI-A",
  DeductionsUnderScheduleVIA:"Deductions under Chapter VI-A (Schedule VIA)",DeductionsUndSchVIADtl:"Deductions under Chapter VI-A (Schedule VIA)",TotDeductUndSchVIA:"Total deductions under Chapter VI-A",PartBchapterVIA:"Part B of Chapter VI-A",PartCchapterVIA:"Part C of Chapter VI-A",
  AllwncExemptUs10:"Allowances exempt under section 10",AllwncExemptUs10Dtls:"Allowances exempt under section 10, each",TotalAllwncExemptUs10:"Total allowances exempt under section 10",ExemptIncAgriOthUs10:"Exempt income, agricultural and other under section 10",
  SurNameOrOrgName:"Last name, or the HUF's name",
  GrossSalary:"Gross salary",Salary:"Salary",PerquisitesValue:"Value of perquisites",NetSalary:"Net salary",DeductionUs16:"Deductions under section 16",DeductionUs16ia:"Deduction under section 16(ia)",EntertainmentAlw16ii:"Entertainment allowance under section 16(ii)",EntertainmntalwncUs16ii:"Entertainment allowance under section 16(ii)",ProfessionalTaxUs16iii:"Professional tax under section 16(iii)",IncomeFromSal:"Income from salary",
  IncomeOthSrc:"Income from other sources",DeductionUs57iia:"Deduction under section 57(iia)",TotIncFromOS:"Total income from other sources",IncomeFromBusinessProf:"Income from business or profession",TotProfBusGain:"Total profits and gains of business or profession",TotalCapGains:"Total capital gains",
  GrossTotIncome:"Gross total income (without long term gains under section 112A)",GrossTotIncomeIncLTCG112A:"Gross total income (with long term gains under section 112A)",GrossTotalIncome:"Gross total income",TotalIncome:"Total income",AggregateIncome:"Aggregate income",
  IncChargeTaxSplRate111A112:"Income taxed at special rates under sections 111A and 112",IncChargeableTaxSplRates:"Income taxed at special rates",NetAgricultureIncomeOrOtherIncomeForRate:"Net agricultural or other income counted for the rate",DeemedIncomeUs115JC:"Deemed income under section 115JC",DeductionsUnder10Aor10AA:"Deductions under section 10A or 10AA",
  TotalTaxPayable:"Total tax payable",Rebate87A:"Rebate under section 87A",TaxPayableOnRebate:"Tax payable after rebate",EducationCess:"Education cess",HealthEduCess:"Health and education cess",Surcharge:"Surcharge",GrossTaxLiability:"Gross tax liability",Section89:"Relief under section 89",NetTaxLiability:"Net tax liability",IntrstPay:"Interest payable",TotalIntrstPay:"Total interest payable",TotTaxPlusIntrstPay:"Total tax and interest payable",
};
// Plain words for a key inside a detail's name ("Assessee Name, First Name" reads "First name");
// an empty one is left out of the name.
export const itrKeyWords:Record<string,string>={
  AssesseeName:"",Address:"",AlternateAddress:"Alternate address",Phone:"",FirstName:"First name",MiddleName:"Middle name",
  ResidenceNo:"Flat or door number",ResidenceName:"Building or village",RoadOrStreet:"Road or street",LocalityOrArea:"Area or locality",CityOrTownOrDistrict:"City, town or district",StateCode:"State",CountryCode:"Country",PinCode:"PIN code",ZipCode:"ZIP code",
  CountryCodeMobile:"Mobile country code",MobileNo:"Mobile number",CountryCodeMobileNoSec:"Second mobile country code",MobileNoSec:"Second mobile number",EmailAddressSec:"Second email address",STDcode:"STD code",PhoneNo:"Phone number",AadhaarCardNo:"Aadhaar number",
};
export const itrFields={
  // Client details InboxCA holds: the PAN registration and the client's email address.
  "itr.personal.pan":{label:"PAN",paths:{ITR1:"PersonalInfo.PAN",ITR4:"PersonalInfo.PAN",ITR2:"PartA_GEN1.PersonalInfo.PAN",ITR3:"PartA_GEN1.PersonalInfo.PAN"}},
  "itr.personal.email":{label:"Email address",paths:{ITR1:"PersonalInfo.Address.EmailAddress",ITR4:"PersonalInfo.Address.EmailAddress",ITR2:"PartA_GEN1.PersonalInfo.Address.EmailAddress",ITR3:"PartA_GEN1.PersonalInfo.Address.EmailAddress"}},
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
  "itr.tds.other.*.deducted":{label:"Tax deducted in the client's own name",paths:otherRows("TotTDSOnAmtPaid","TDSDeducted","TaxDeductCreditDtls.TaxDeductedOwnHands")},
  "itr.tds.other.*.claimed":{label:"TDS claimed this year in the client's own name",paths:otherRows("ClaimOutOfTotTDSOnAmtPaid","TDSClaimed","TaxDeductCreditDtls.TaxClaimedOwnHands")},
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
