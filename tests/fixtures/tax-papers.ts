import { lockedPdf, pdf, type Placed } from "./pdf";

// Invented income tax papers laid out with the printed titles, headings and row wording of
// the official layouts (reference/official/income-tax/sources.json): Form 16 as TRACES
// prints it, Form No. 130 and Form No. 168 as the Income-tax Rules 2026 blanks, ITR-V and
// its acknowledgement as Notification 51/2026, AIS and TIS as the official FAQ names their
// parts, and Form 26AS as TRACES gives its PDF and text file. Every PAN, TAN, name, number
// and amount is made up; none is a real taxpayer's.
export const pan = "ZZZPZ0003Z", employerPan = "ZZZCZ0001Z", signatoryPan = "ZZZPZ0004Z", tan = "ZZZZ00001Z", bankTan = "ZZZZ00002Z"; // ggignore: invented PANs and TANs.

// Rows from the top of the page down, each a list of [x, text].
const page = (rows: [number, string][][], top = 770): Placed => rows.flatMap((row, at) => row.map(([x, text]) => ({ x, y: top - at * 13, text })));

const form16Head = (part: string, who = pan, year = "2026-27", deductor = tan): [number, string][][] => [
  [[260, "FORM NO. 16"]], [[250, "[See rule 31(1)(a)]"]], [[275, part]],
  [[40, "Certificate under Section 203 of the Income-tax Act, 1961 for tax deducted at source on salary"]],
  [[40, "Certificate No."], [110, "ZQXWVUT"], [300, "Last updated on"], [380, "26-Jun-2026"]],
  [[40, "Name and address of the Employer"], [300, "Name and address of the Employee"]],
  [[40, "INVENTED SOFTWARE PRIVATE LIMITED"], [300, "INVENTED EMPLOYEE"]],
  [[40, "PAN of the Deductor"], [170, "TAN of the Deductor"], [300, "PAN of the Employee"], [430, "Employee Reference No. provided by the Employer (If available)"]],
  [[40, employerPan], [170, deductor], [300, who], [430, "E0001"]],
  [[40, "CIT (TDS)"], [300, "Assessment Year"], [430, "Period with the Employer"]],
  [[40, "INVENTED CITY"], [300, year], [430, "From 01-Apr-2025 To 31-Mar-2026"]],
];
const partA: [number, string][][] = [
  [[40, "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee"]],
  [[40, "Quarter(s)"], [90, "Receipt Numbers of original quarterly statements"], [330, "Amount paid/credited"], [420, "Amount of tax deducted (Rs.)"], [500, "Amount of tax deposited / remitted (Rs.)"]],
  [[90, "of TDS under sub-section (3) of Section 200"]],
  ...["Q1", "Q2", "Q3", "Q4"].map((quarter, at): [number, string][] => [[40, quarter], [90, `QZZZZZZ${at + 1}`], [330, "300000.00"], [420, "16120.00"], [500, "16120.00"]]),
  [[40, "Total (Rs.)"], [330, "1200000.00"], [420, "64480.00"], [500, "64480.00"]],
  [[40, "I. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH BOOK ADJUSTMENT"]],
  [[40, "Sl. No."], [90, "Tax Deposited in respect of the deductee (Rs.)"], [300, "Book Identification Number (BIN)"]],
  [[40, "Total (Rs.)"]],
  [[40, "II. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH CHALLAN"]],
  [[40, "Sl. No."], [90, "Tax Deposited in respect of the deductee (Rs.)"], [300, "Challan Identification Number (CIN)"]],
  [[40, "1"], [90, "64480.00"], [300, "0000001"], [380, "07-04-2026"], [460, "00001"], [520, "F"]],
  [[40, "Total (Rs.)"], [90, "64480.00"]],
  [[40, "Verification"]],
  [[40, "I, INVENTED SIGNATORY, working in the capacity of DIRECTOR do hereby certify that a sum of Rs. 64480.00 has been deducted and deposited"]],
  [[40, "Place"], [90, "INVENTED CITY"], [300, "Full Name:"], [360, "INVENTED SIGNATORY"]],
];
const partB = (gross = "1200000.00"): [number, string][][] => [
  [[40, "Details of Salary Paid and any other income and tax deducted"]],
  [[40, "1. Gross Salary"]],
  [[60, "(a) Salary as per provisions contained in section 17(1)"], [500, gross]],
  [[60, "(b) Value of perquisites under section 17(2) (as per Form No. 12BA, wherever applicable)"], [500, "0.00"]],
  [[60, "(c) Profits in lieu of salary under section 17(3) (as per Form No. 12BA, wherever applicable)"], [500, "0.00"]],
  [[60, "(d) Total"], [500, gross]],
  [[60, "(e) Reported total amount of salary received from other employer(s)"], [500, "0.00"]],
  [[40, "2. Less: Allowances to the extent exempt under section 10"]],
  [[60, "(h) Total amount of exemption claimed under section 10 [2(a)+2(b)+2(c)+2(d)+2(e)+2(g)]"], [500, "0.00"]],
  [[40, "3. Total amount of salary received from current employer [1(d)-2(h)]"], [500, gross]],
  [[40, "4. Less: Deductions under section 16"]],
  [[60, "(a) Standard deduction under section 16(ia)"], [500, "75000.00"]],
  [[40, "5. Total amount of deductions under section 16 [4(a)+4(b)+4(c)]"], [500, "75000.00"]],
  [[40, '6. Income chargeable under the head "Salaries" [(3+1(e)-5]'], [500, "1125000.00"]],
  [[40, "9. Gross total income (6+8)"], [500, "1125000.00"]],
  [[40, "12. Total taxable income (9-11)"], [500, "1125000.00"]],
  [[40, "17. Tax payable (13+15+16-14)"], [500, "64480.00"]],
  [[40, "19. Net tax payable (17-18)"], [500, "64480.00"]],
];
// Form 16: Part A, Part B (Annexure), or both, each part on its own page as TRACES prints them.
export const form16 = (parts: "A" | "B" | "AB" = "AB", who = pan, year = "2026-27", whoInB = who, deductor = tan) =>
  pdf([...(parts.includes("A") ? [page([...form16Head("PART A", who, year, deductor), ...partA])] : []), ...(parts.includes("B") ? [page([...form16Head("PART B", whoInB, year, deductor), ...partB()])] : [])]);

// Form No. 130 as the Rules 2026 blank lays it out: Part A and B on the first page, Part C (Annexure - I) on the next.
export const form130 = (year = "2026-27") => pdf([
  page([
    [[264, "FORM NO. 130"]], [[227, "[See rule 215(1)[Table: Sl. No. 1]]"]],
    [[70, "Certificate under section 395 for tax deducted at source on salary paid to an employee under section 392 or"]],
    [[98, "pension or interest income of specified senior citizen under section 393(1) [Table: Sl. No. 8(iii)]"]],
    [[280, "PART A"]], [[61, "Certificate No."], [140, "ZQXWVUT"], [284, "Last updated on"], [380, "15-May-2027"]],
    [[216, "Details of the employer/specified bank"]],
    [[73, "1."], [104, "Name (refer Note 1)"], [404, "INVENTED SOFTWARE PRIVATE LIMITED"]],
    [[73, "3."], [104, "Permanent Account Number"], [404, employerPan]],
    [[73, "4."], [104, "Tax Deduction and Collection Account Number"], [404, tan]],
    [[73, "7."], [104, "Tax year"], [404, year]],
    [[73, "8."], [104, "Period with the employer (dd/mm/yyyy)"], [404, "01/04/2026 to 31/03/2027"]],
    [[198, "Details of the employee/ specified senior citizen"]],
    [[73, "9."], [104, "Name (refer Note 1)"], [404, "INVENTED EMPLOYEE"]],
    [[71, "11."], [104, "Permanent Account Number"], [404, pan]],
    [[280, "PART B"]],
    [[92, "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee"]],
    [[69, "Quarter (s)"], [139, "Receipt Numbers of original"], [281, "Amount"], [344, "Rate of"], [394, "Amount of"], [465, "Amount of tax"]],
    [[139, "quarterly statements of TDS"], [272, "paid/credited"], [335, "deduction of"], [391, "tax deducted"], [455, "deposited/ adjusted"]],
    [[149, "under section 397(3)(b)"], [352, "tax"]],
    [[69, "Q4"], [139, "QZZZZZZ4"], [281, "1300000.00"], [344, "5.00"], [394, "65000.00"], [465, "65000.00"]],
    [[80, "Total"], [281, "1300000.00"], [394, "65000.00"], [465, "65000.00"]],
    [[84, "I. Details of tax deducted and deposited in the central government account through book adjustment"]],
    [[80, "Total"]],
    [[259, "DECLARATION"]],
    [[61, `I, INVENTED SIGNATORY, having Permanent Account Number ${signatoryPan} working in the capacity as DIRECTOR do hereby certify`]],
  ]),
  page([
    [[251, "PART C (Annexure - I)"]], [[170, "In relation to employees for tax deduction under section 392"]],
    [[65, "Row"], [287, "Particulars"]],
    [[71, "A"], [90, "Whether opting out of taxation under section 202(1)? (Yes/No)"], [480, "No"]],
    [[71, "1."], [90, "Gross Salary"]],
    [[90, "(a) Salary as per provisions contained in section 16"], [480, "1300000.00"]],
    [[90, "(d) Total"], [480, "1300000.00"]],
    [[90, "(e)Reported total amount of salary received from other employer(s)"], [480, "0.00"]],
    [[71, "2."], [90, "Allowances to the exempt under section 11"]],
    [[90, "(f) Total amount of exemption claimed under section 11 [2(a)+2(b)+2(c)+2(e)]"], [480, "0.00"]],
    [[71, "4."], [90, "Deductions under section 19(1)"]],
    [[90, "(b) Standard deduction under section 19(1) [Table: Sl. No.2]"], [480, "75000.00"]],
    [[71, "6."], [90, 'Income chargeable under the head "Salaries" [3+1(e)-5]'], [480, "1225000.00"]],
  ]),
]);

// Form 26AS as TRACES prints it, titled Annual Tax Statement.
export const form26asPdf = (financial = "2025-26", assessment = "2026-27") => pdf([page([
  [[240, "Annual Tax Statement"], [420, "Data updated till 25-Oct-2026"]],
  [[40, "Permanent Account Number (PAN)"], [170, pan], [260, "Current Status of PAN"], [360, "Active and Operative"]],
  [[40, "Financial Year"], [170, financial], [260, "Assessment Year"], [360, assessment]],
  [[40, "Name of Assessee"], [170, "INVENTED EMPLOYEE"]],
  [[40, "Address of Assessee"], [170, "2 INVENTED LANE, INVENTED CITY"]],
  [[40, "Above data / Status of PAN is as per PAN details"]], [[40, "(All amount values are in INR)"]],
  [[40, "PART-I - Details of Tax Deducted at Source"]],
  [[40, "Sr. No."], [70, "Name of Deductor"], [250, "TAN of Deductor"], [330, "Total Amount Paid / Credited"], [430, "Total Tax Deducted#"], [510, "Total TDS Deposited"]],
  [[40, "1"], [70, "INVENTED SOFTWARE PRIVATE LIMITED"], [250, tan], [330, "1200000.00"], [430, "64480.00"], [510, "64480.00"]],
  [[40, "PART-II - Details of Tax Deducted at Source for 15G / 15H"]], [[40, "No Transactions Present"]],
])]);

// The TRACES text file: "^" between fields, a header line of names with its values below.
export const form26asText = (part1 = [
  "Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
  `1^INVENTED SOFTWARE PRIVATE LIMITED^${tan}^^^^^1200000.00^64480.00^64480.00^`,
  "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)",
  "^1^192^30-Jun-2025^F^31-Jul-2025^-^600000.00^32240.00^32240.00^",
  "^2^192^31-Dec-2025^F^31-Jan-2026^-^600000.00^32240.00^32240.00^",
  `2^INVENTED BANK LIMITED^${bankTan}^^^^^12000.00^1200.00^1200.00^`,
  "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)",
  "^1^194A^31-Mar-2026^U^-^-^12000.00^1200.00^1200.00^",
], years = "2025-2026^2026-2027", who = pan) => Buffer.from([
  "^Annual Tax Statement^",
  "File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee^Address Line 1^Address Line 2^Address Line 3^Address Line 4^Address Line 5^Statecode^Pin Code",
  `26-10-2026^${who}^ACTIVE^${years}^INVENTED EMPLOYEE^2 INVENTED LANE^^^^INVENTED CITY^24^380000`,
  "^PART-I - Details of Tax Deducted at Source^",
  ...part1,
  "^PART-II - Details of Tax Deducted at Source for 15G / 15H^",
  "Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
  "^^^*********** No Transactions Present **********^",
  "^PART-III - Details of Transactions under Proviso to section 194B/First Proviso to sub-section (1) of section 194R/ Proviso to sub-section(1) of section 194S/Sub-section (2) of section 194BA^",
  "^^^*********** No Transactions Present **********^",
  "",
].join("\n"));

// Form No. 168 as the Rules 2026 blank lays it out.
export const form168 = () => pdf([page([
  [[257, "FORM NO. 168"]], [[263, "[See rule 245]"]], [[218, "Annual Information Statement"]], [[396, "Tax Year:"], [440, "2026-27"]],
  [[61, "Row"], [97, "Part A: Particulars of the Person"]], [[61, "No."]],
  [[61, "1."], [97, "Name"], [300, "INVENTED EMPLOYEE"]],
  [[61, "4."], [97, "PAN"], [300, pan]],
  [[77, "Sl. No."], [249, "Part B: Nature of Information"]],
  [[89, "1."], [126, "Information relating to tax deducted or collected at source"]],
])]);

// AIS and TIS by the parts and headings the official FAQ names.
export const ais = (years: [number, string][] = [[40, "Financial Year"], [120, "2025-26"], [300, "Assessment Year"], [390, "2026-27"]]) => pdf([page([
  [[200, "Annual Information Statement (AIS)"]], years,
  [[40, "PART A- General Information"]],
  [[40, "Permanent Account Number (PAN)"], [200, pan]],
  [[40, "Name"], [200, "INVENTED EMPLOYEE"]],
  [[40, "PART- B"]], [[40, "TDS/TCS Information"]],
  [[40, "Information code"], [150, "Information description"], [350, "Information value"]],
  [[40, "SFT Information"]], [[40, "Payment of Taxes"]], [[40, "Demand and Refund"]], [[40, "Other Information"]],
])]);
export const tis = () => pdf([page([
  [[200, "Taxpayer Information Summary (TIS)"]],
  [[40, "Financial Year"], [120, "2025-26"], [300, "Assessment Year"], [390, "2026-27"]],
  [[40, "Permanent Account Number (PAN)"], [200, pan]],
  [[40, "Information Category"], [250, "Processed Value"], [400, "Derived Value"]],
  [[40, "Salary"], [250, "1200000"], [400, "1200000"]],
])]);

// ITR-V and the acknowledgement as Notification 51/2026 lays them out, filled in.
const itrV = (who: string): [number, string][][] => [
  [[61, "FORM"], [432, "Assessment Year"]], [[125, "INDIAN INCOME TAX RETURN VERIFICATION"]], [[60, "ITR-V"], [243, "FORM"], [444, "2026-27"]],
  [[159, "[Where the data of the Return of Income in Form ITR-1 (SAHAJ),"]], [[154, "ITR-2, ITR-3, ITR-4(SUGAM), ITR-5, ITR-7 filed but NOT verified"]], [[253, "electronically]"]],
  [[200, "(Please see rule 12 of the Income-tax Rules, 1962)"]],
  [[60, "Name"], [130, "INVENTED EMPLOYEE"]],
  [[60, "PAN"], [130, who], [209, "Form Number"], [320, "ITR-1"]],
  [[60, "Filed u/s"], [130, "139(1)"], [209, "e-Filing Acknowledgement"], [320, "000000000000001"]], [[209, "Number"]],
  [[255, "VERIFICATION"]],
  [[60, `I, INVENTED EMPLOYEE son/daughter of INVENTED PARENT, solemnly declare that I am holding permanent account number ${who}.`]],
  [[60, "Date of submission"], [130, "31-07-2026"], [260, "Source IP address"], [360, "192.0.2.1"]],
  [[60, "Instructions:"]], [[60, "1. This is not an evidence for having filed the return of income, as verification is pending."]],
];
export const itrVerification = (password?: string, who = pan) => (password ? lockedPdf([page(itrV(who))], password) : pdf([page(itrV(who))]));
export const itrAcknowledgement = () => pdf([page([
  [[87, "INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT"], [451, "Assessment Year"]],
  [[111, "[Where the data of the Return of Income in Form ITR-1 (SAHAJ), ITR-2, ITR-3,"], [461, "2026-27"]],
  [[158, "ITR-4(SUGAM), ITR-5, ITR-6, ITR-7 filed and verified]"]], [[184, "(Please see rule 12 of the Income-tax Rules, 1962)"]],
  [[66, "PAN"], [150, pan]], [[66, "Name"], [150, "INVENTED EMPLOYEE"]],
  [[66, "Status"], [150, "Individual"], [218, "Form Number"], [330, "ITR-1"]],
  [[66, "Filed u/s"], [150, "139(1)"], [218, "e-Filing Acknowledgement Number"], [400, "000000000000001"]],
  [[95, "Current Year business loss, if any"], [392, "1"], [450, "0"]], [[95, "Total Income"], [388, "1A"], [450, "1125000"]],
  [[66, "Income Tax Return electronically transmitted on 31-07-2026 10:00:00 from IP address 192.0.2.1 and"]],
  [[66, `verified by INVENTED SIGNATORY having PAN ${signatoryPan} on 31-07-2026 using Electronic Verification Code generated through Aadhaar OTP mode`]],
  [[60, "DO NOT SEND THIS ACKNOWLEDGEMENT TO CPC, BENGALURU."]],
])]);

// A salary certificate from payroll software, worded its own way: not the official Form 16.
export const payrollForm16 = () => pdf([page([
  [[40, "Form 16 - Salary Certificate"]], [[40, "Employee PAN"], [200, pan]], [[40, "Assessment Year"], [200, "2026-27"]],
  [[40, "Gross Salary"], [500, "1200000.00"]], [[40, '6. Income chargeable under the head "Salaries"'], [500, "1125000.00"]],
])]);
