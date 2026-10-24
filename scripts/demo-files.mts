// The demo firm's client papers, invented but laid out and worded like the real ones, with
// figures that agree with each other: Mehta Traders' purchase bills are the invoices in its
// GSTR-2B, Kapoor Enterprises' bank ledger closes at the bank balance in its trial balance,
// and the Form 16 tax is worked out under the FY 2025-26 new regime. Every person, firm, bank,
// PAN, GSTIN and number is made up. Government papers carry a light SAMPLE mark and no emblem,
// seal or signature.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Paper, inr, inWords } from "./demo-pdf.mts";
import { writeWorkbook } from "../worker/workbook.ts";
import { portalParsers } from "../worker/portal.ts";

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// A GSTIN with a correct check character, for a state and a PAN.
export function gstin(state: string, pan: string) {
  const body = `${state}${pan}1Z`;
  let sum = 0;
  for (let at = 0; at < 14; at++) {
    const value = BASE36.indexOf(body[at]) * (at % 2 ? 2 : 1);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return body + BASE36[(36 - (sum % 36)) % 36];
}

const ddmmyyyy = (date: string) => date.split("-").reverse().join("-");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: string) => `${date.slice(8, 10)}-${MONTHS[Number(date.slice(5, 7)) - 1]}-${date.slice(0, 4)}`;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Party = { name: string; address: string[]; gstin: string; state: string };
type Line = { item: string; hsn: string; qty: number; unit: string; rate: number };
type Bill = { seller: Party; number: string; date: string; lines: Line[]; taxable: number; igst: number; cgst: number; sgst: number; total: number };

function bill(seller: Party, buyer: Party, number: string, date: string, lines: Line[]): Bill {
  const taxable = round2(lines.reduce((sum, line) => sum + line.qty * line.rate, 0));
  const inter = seller.gstin.slice(0, 2) !== buyer.gstin.slice(0, 2);
  const igst = inter ? round2(taxable * 0.18) : 0, cgst = inter ? 0 : round2(taxable * 0.09), sgst = cgst;
  return { seller, number, date, lines, taxable, igst, cgst, sgst, total: Math.round(taxable + igst + cgst + sgst) };
}

// One tax invoice per page, as a supplier's billing software prints it.
function drawBill(paper: Paper, b: Bill, buyer: Party) {
  paper.text(297, 50, "TAX INVOICE", { size: 13, bold: true, align: "center" }).text(540, 50, "Original for Recipient", { size: 7, align: "right", gray: 0.35 });
  paper.box(40, 62, 515, 92);
  paper.text(50, 78, b.seller.name, { size: 12, bold: true });
  b.seller.address.forEach((row, i) => paper.text(50, 92 + i * 11, row, { size: 8 }));
  paper.text(50, 92 + b.seller.address.length * 11, `GSTIN/UIN: ${b.seller.gstin}    State Name: ${b.seller.state}, Code: ${b.seller.gstin.slice(0, 2)}`, { size: 8, bold: true });
  paper.text(380, 78, `Invoice No.`, { size: 8, gray: 0.35 }).text(450, 78, b.number, { size: 9, bold: true });
  paper.text(380, 92, `Dated`, { size: 8, gray: 0.35 }).text(450, 92, shortDate(b.date), { size: 9, bold: true });
  paper.text(380, 106, `Mode of Payment`, { size: 8, gray: 0.35 }).text(450, 106, "30 Days", { size: 9 });
  paper.text(380, 120, `Dispatched by`, { size: 8, gray: 0.35 }).text(450, 120, "Road", { size: 9 });
  paper.box(40, 154, 515, 70);
  paper.text(50, 168, "Buyer (Bill to)", { size: 8, gray: 0.35 }).text(50, 181, buyer.name, { size: 10, bold: true });
  buyer.address.forEach((row, i) => paper.text(50, 193 + i * 10, row, { size: 8 }));
  paper.text(330, 181, `GSTIN/UIN: ${buyer.gstin}`, { size: 8, bold: true }).text(330, 193, `State Name: ${buyer.state}, Code: ${buyer.gstin.slice(0, 2)}`, { size: 8 }).text(330, 205, `Place of Supply: ${buyer.state}`, { size: 8 });
  const columns = [[50, "Sl", "left"], [70, "Description of Goods", "left"], [300, "HSN/SAC", "left"], [385, "Quantity", "right"], [440, "Rate", "right"], [470, "per", "left"], [545, "Amount", "right"]] as const;
  paper.box(40, 232, 515, 16, 0.92);
  for (const [x, label, align] of columns) paper.text(x, 243, label, { size: 8, bold: true, align });
  let y = 262;
  b.lines.forEach((line, i) => {
    paper.text(50, y, String(i + 1), { size: 8 }).text(70, y, line.item, { size: 8, bold: true }).text(300, y, line.hsn, { size: 8 })
      .text(385, y, `${line.qty} ${line.unit}`, { size: 8, align: "right" }).text(440, y, inr(line.rate), { size: 8, align: "right" }).text(470, y, line.unit, { size: 8 })
      .text(545, y, inr(line.qty * line.rate), { size: 8, align: "right" });
    y += 16;
  });
  y += 6;
  paper.line(400, y, 555, y);
  y += 12;
  const taxes: [string, number][] = b.igst ? [["Output IGST @ 18%", b.igst]] : [["Output CGST @ 9%", b.cgst], ["Output SGST @ 9%", b.sgst]];
  for (const [label, value] of [["Taxable Value", b.taxable], ...taxes, ["Round Off", b.total - (b.taxable + b.igst + b.cgst + b.sgst)]] as [string, number][]) {
    paper.text(440, y, label, { size: 8, align: "right", bold: label !== "Round Off" && label !== "Taxable Value" }).text(545, y, inr(value), { size: 8, align: "right" });
    y += 13;
  }
  paper.box(40, y - 2, 515, 18, 0.92).text(440, y + 10, "Total", { size: 9, bold: true, align: "right" }).text(545, y + 10, `Rs. ${inr(b.total)}`, { size: 9, bold: true, align: "right" });
  y += 30;
  paper.text(50, y, "Amount Chargeable (in words)", { size: 7, gray: 0.35 }).text(50, y + 12, `INR ${inWords(b.total).replace(/^Rupees /, "")}`, { size: 9, bold: true });
  y += 34;
  paper.box(40, y, 515, 34, 0.96).text(50, y + 14, "Declaration: We declare that this invoice shows the actual price of the goods described and that all", { size: 7 })
    .text(50, y + 24, "particulars are true and correct. Subject to local jurisdiction. Interest @18% p.a. charged on overdue bills.", { size: 7 });
  y += 50;
  paper.text(50, y, "Company's Bank Details", { size: 8, bold: true }).text(50, y + 12, "Bank Name: Aakashganga Sahakari Bank Ltd", { size: 8 })
    .text(50, y + 23, `A/c No.: ${b.number.replace(/\D/g, "").padEnd(6, "4")}0712`, { size: 8 }).text(50, y + 34, "Branch & IFSC: Naroda, AKGB0000412", { size: 8 });
  paper.text(545, y, `for ${b.seller.name}`, { size: 8, bold: true, align: "right" }).text(545, y + 40, "Authorised Signatory", { size: 8, align: "right" });
  paper.text(297, 800, "This is a Computer Generated Invoice", { size: 7, align: "center", gray: 0.4 });
}

export function demoFiles(period: string, today: string) {
  const [year, month] = period.split("-").map(Number);
  const fy = month >= 4 ? `${String(year).slice(2)}-${String(year + 1).slice(2)}` : `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
  const day = (n: number) => `${period}-${String(n).padStart(2, "0")}`;
  const monthName = `${MONTHS[month - 1]} ${year}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  // The portal makes GSTR-2B on the 14th of the next month, after suppliers file by the 11th.
  const notAfterToday = (date: string) => (date > today ? today : date);
  const files: { client: string; original: string; bytes: Uint8Array }[] = [];

  // Mehta Traders, an electrical goods trader in Ahmedabad: its purchases, sales and GSTR-2B.
  const mehta: Party = { name: "Mehta Traders", address: ["Shop No. 14, Ratnadeep Complex, Relief Road", "Ahmedabad, Gujarat - 380001"], gstin: gstin("24", "AAPFM1234K"), state: "Gujarat" };
  const suppliers = [
    bill({ name: "Shree Ambika Electricals", address: ["Plot 27, GIDC Estate, Phase 2, Naroda", "Ahmedabad, Gujarat - 382330"], gstin: gstin("24", "ABHFS4821L"), state: "Gujarat" }, mehta, `SAE/${fy}/1184`, day(6), [
      { item: "Modular Switch 6A, Pack of 10", hsn: "85365090", qty: 40, unit: "Box", rate: 1150 },
      { item: "MCB 32A Double Pole C-Curve", hsn: "85362010", qty: 60, unit: "Nos", rate: 465 },
    ]),
    bill({ name: "Jalaram Cables and Wires", address: ["Survey No. 112, Behind Vishala Hotel, Vasna", "Ahmedabad, Gujarat - 380007"], gstin: gstin("24", "AAKFJ7713M"), state: "Gujarat" }, mehta, `JCW/${fy}/0563`, day(11), [
      { item: "FR PVC Copper Wire 1.5 sq mm, 90 m", hsn: "85444999", qty: 50, unit: "Coil", rate: 1640 },
      { item: "FR PVC Copper Wire 2.5 sq mm, 90 m", hsn: "85444999", qty: 30, unit: "Coil", rate: 2690 },
    ]),
    bill({ name: "Vardhman Fans Pvt Ltd", address: ["Gala 8, Shah Industrial Estate, Off Andheri Kurla Road", "Mumbai, Maharashtra - 400072"], gstin: gstin("27", "AABCV3390P"), state: "Maharashtra" }, mehta, `VF/${fy}/2207`, day(18), [
      { item: "Ceiling Fan 1200 mm, 3 Blade", hsn: "84145110", qty: 25, unit: "Nos", rate: 1850 },
    ]),
  ];
  const bills = new Paper();
  suppliers.forEach((b, i) => { if (i) bills.page(); drawBill(bills, b, mehta); });
  files.push({ client: "Mehta Traders", original: `purchase bills ${monthName}.pdf`, bytes: bills.bytes() });

  // Its GSTR-2B for the month, in GSTN's v4.5 layout, listing the same bills.
  const sum = (key: "taxable" | "igst" | "cgst" | "sgst") => round2(suppliers.reduce((total, b) => total + b[key], 0));
  const prd = `${String(month).padStart(2, "0")}${year}`;
  const twoB = {
    chksum: createHash("sha256").update(`${mehta.gstin}${prd}`).digest("hex"),
    data: {
      gstin: mehta.gstin, rtnprd: prd, version: "1.0", gendt: ddmmyyyy(notAfterToday(`${next}-14`)),
      itcsumm: { itcavl: { nonrevsup: { igst: sum("igst"), cgst: sum("cgst"), sgst: sum("sgst"), cess: 0, b2b: { igst: sum("igst"), cgst: sum("cgst"), sgst: sum("sgst"), cess: 0 } } } },
      docdata: { b2b: suppliers.map((b) => ({
        ctin: b.seller.gstin, trdnm: b.seller.name.toUpperCase(), supfildt: ddmmyyyy(notAfterToday(`${next}-11`)), supprd: prd,
        inv: [{ inum: b.number, typ: "R", dt: ddmmyyyy(b.date), val: b.total, pos: "24", rev: "N", itcavl: "Y", rsn: "", txval: b.taxable, igst: b.igst, cgst: b.cgst, sgst: b.sgst, cess: 0,
          items: [{ num: 1, rt: 18, txval: b.taxable, igst: b.igst, cgst: b.cgst, sgst: b.sgst, cess: 0 }] }],
      })) },
    },
  };
  if (!portalParsers[0].read(twoB)) throw new Error("The demo GSTR-2B does not match GSTN's layout");
  files.push({ client: "Mehta Traders", original: `GSTR-2B ${monthName}.json`, bytes: new TextEncoder().encode(JSON.stringify(twoB)) });

  // Its sales for the month in the official GSTR-1 workbook, as Tally exports it.
  const serial = (date: string) => String((Date.parse(date) - Date.UTC(1899, 11, 30)) / 86400000);
  const buyers: [string, string, string, string, number][] = [
    [gstin("24", "AAFFO2245Q"), "Om Sai Electrical Contractors", `MT/${fy}/0418`, day(4), 186400],
    [gstin("24", "AAGCP8812R"), "Pragati Infra Projects Pvt Ltd", `MT/${fy}/0431`, day(12), 342750],
    [gstin("24", "AAIFN5506S"), "Nilkanth Builders", `MT/${fy}/0447`, day(19), 97300],
    [gstin("27", "AAKFS1147T"), "Sunrise Interiors", `MT/${fy}/0452`, day(23), 128600],
  ];
  const workbook = readFileSync(new URL("../reference/official/gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx", import.meta.url));
  const cell = (value: string | number) => ({ value: String(value), number: typeof value === "number" });
  const b2b = new Map<string, { value: string; number: boolean }>(), b2cs = new Map<string, { value: string; number: boolean }>(), hsn = new Map<string, { value: string; number: boolean }>();
  buyers.forEach(([ctin, name, number, date, taxable], i) => {
    const row = 5 + i, pos = ctin.startsWith("27") ? "27-Maharashtra" : "24-Gujarat";
    ["A", "B", "C", "D", "E", "F", "G", "I", "K", "L"].forEach((column, at) =>
      b2b.set(`${column}${row}`, [cell(ctin), cell(name), cell(number), { value: serial(date), number: true }, cell(Math.round(taxable * 1.18)), cell(pos), cell("N"), cell("Regular B2B"), cell(18), cell(taxable)][at]));
  });
  [["A5", "OE"], ["B5", "24-Gujarat"], ["D5", 18], ["E5", 84500]].forEach(([ref, value]) => b2cs.set(String(ref), cell(value)));
  const intra = buyers.filter(([ctin]) => ctin.startsWith("24")).reduce((total, [, , , , taxable]) => total + taxable, 0), inter = buyers[3][4];
  [["85444999", "Insulated copper wire", "MTR-METERS", 6400, round2((intra + inter) * 0.55)], ["85365090", "Switches and MCBs", "NOS-NUMBERS", 940, round2((intra + inter) * 0.45)]].forEach(([code, text, unit, qty, taxable], i) => {
    const t = Number(taxable), share = t / (intra + inter);
    const igst = round2(inter * share * 0.18), half = round2(intra * share * 0.09);
    ["A", "B", "C", "D", "F", "G", "H", "I", "J"].forEach((column, at) => hsn.set(`${column}${5 + i}`, [cell(String(code)), cell(String(text)), cell(String(unit)), cell(Number(qty)), cell(18), cell(t), cell(igst), cell(half), cell(half)][at]));
  });
  const register = writeWorkbook(workbook, new Map([["xl/worksheets/sheet2.xml", b2b], ["xl/worksheets/sheet6.xml", b2cs], ["xl/worksheets/sheet19.xml", hsn]]));
  files.push({ client: "Mehta Traders", original: `sales register ${monthName}.xlsx`, bytes: new Uint8Array(register) });

  // S.K. Builders: a cement and steel bill from its supplier.
  const sk: Party = { name: "S.K. Builders", address: ["304, Shivalik Arcade, Ghod Dod Road", "Surat, Gujarat - 395007"], gstin: gstin("24", "AAHFS9012T"), state: "Gujarat" };
  const skBills = new Paper();
  drawBill(skBills, bill({ name: "Tapi Building Materials", address: ["Block C, Sachin GIDC, Road No. 6", "Surat, Gujarat - 394230"], gstin: gstin("24", "AALFT6620U"), state: "Gujarat" }, sk, `TBM/${fy}/3318`, day(9), [
    { item: "TMT Bar Fe 500D, 12 mm", hsn: "72142090", qty: 4.5, unit: "MT", rate: 56800 },
    { item: "Binding Wire 20 SWG", hsn: "72172010", qty: 250, unit: "Kg", rate: 78 },
  ]), sk);
  files.push({ client: "S.K. Builders", original: `purchase bills ${monthName}.pdf`, bytes: skBills.bytes() });

  // Kapoor Enterprises: its bank ledger for FY 2025-26, and the trial balance it closes into.
  const ledger: [string, string, string, string, number, number][] = [
    ["2025-04-07", "Shree Ganesh Steel Traders", "Receipt", "142", 284500, 0],
    ["2025-05-15", "GST Payable (May 2025)", "Payment", "38", 0, 118460],
    ["2025-06-30", "Rent Paid (Q1)", "Payment", "61", 0, 135000],
    ["2025-08-12", "Mahalaxmi Fabrication Works", "Receipt", "219", 467300, 0],
    ["2025-09-30", "Salary Payable (Sep 2025)", "Payment", "104", 0, 286400],
    ["2025-11-04", "Bharat Hardware Mart", "Payment", "127", 0, 392650],
    ["2025-12-15", "Advance Tax (3rd instalment)", "Payment", "143", 0, 145000],
    ["2026-01-21", "Prime Engineering Co.", "Receipt", "305", 528900, 0],
    ["2026-02-28", "Cash Deposit", "Contra", "17", 150000, 0],
    ["2026-03-31", "Interest on FD", "Receipt", "331", 41270, 0],
  ];
  const opening = 425610;
  let balance = opening;
  const book = new Paper();
  book.text(297, 50, "Kapoor Enterprises", { size: 13, bold: true, align: "center" }).text(297, 64, "Unit 7, Rajlaxmi Industrial Estate, Andheri East, Mumbai - 400093", { size: 8, align: "center" });
  book.text(297, 84, "Aakashganga Sahakari Bank Ltd - Current A/c 0407 1125 6610", { size: 10, bold: true, align: "center" }).text(297, 97, "Ledger Account", { size: 9, align: "center" }).text(297, 109, "1-Apr-2025 to 31-Mar-2026", { size: 8, align: "center" });
  book.box(40, 122, 515, 16, 0.92);
  for (const [x, label, align] of [[48, "Date", "left"], [110, "Particulars", "left"], [275, "Vch Type", "left"], [330, "Vch No.", "left"], [418, "Debit", "right"], [482, "Credit", "right"], [552, "Balance", "right"]] as const) book.text(x, 133, label, { size: 8, bold: true, align });
  let y = 154;
  book.text(110, y, "Opening Balance", { size: 8, bold: true }).text(552, y, `${inr(opening)} Dr`, { size: 8, align: "right" });
  for (const [date, party, type, number, debit, credit] of ledger) {
    y += 15;
    balance += debit - credit;
    book.text(48, y, shortDate(date), { size: 8 }).text(110, y, `${debit ? "To" : "By"} ${party}`, { size: 8 }).text(275, y, type, { size: 8 }).text(330, y, number, { size: 8 })
      .text(418, y, debit ? inr(debit) : "", { size: 8, align: "right" }).text(482, y, credit ? inr(credit) : "", { size: 8, align: "right" }).text(552, y, `${inr(balance)} Dr`, { size: 8, align: "right" });
  }
  y += 10;
  book.line(360, y, 555, y);
  const debits = ledger.reduce((t, l) => t + l[4], 0), credits = ledger.reduce((t, l) => t + l[5], 0);
  book.text(275, y + 13, "Current Total", { size: 8, bold: true }).text(418, y + 13, inr(debits), { size: 8, bold: true, align: "right" }).text(482, y + 13, inr(credits), { size: 8, bold: true, align: "right" });
  book.text(275, y + 27, "Closing Balance", { size: 8, bold: true }).text(552, y + 27, `${inr(balance)} Dr`, { size: 8, bold: true, align: "right" });
  files.push({ client: "Kapoor Enterprises", original: "ledger FY 2025-26.pdf", bytes: book.bytes() });

  const debitSide: [string, number][] = [["Fixed Assets", 2640300], ["Opening Stock", 3520410], ["Sundry Debtors", 4692150], ["Cash-in-Hand", 112480], ["Bank Accounts", balance], ["Loans & Advances (Asset)", 360000], ["Purchase Accounts", 32148600], ["Direct Expenses", 1426830], ["Indirect Expenses", 2136520]];
  const otherCredits: [string, number][] = [["Loans (Liability)", 3064380], ["Sundry Creditors", 3146720], ["Duties & Taxes", 218450], ["Provisions", 165000], ["Sales Accounts", 38645900], ["Indirect Incomes", 157830]];
  const totalDebit = debitSide.reduce((t, [, v]) => t + v, 0), capital = totalDebit - otherCredits.reduce((t, [, v]) => t + v, 0);
  const tb = new Paper();
  tb.text(297, 50, "Kapoor Enterprises", { size: 13, bold: true, align: "center" }).text(297, 64, "Unit 7, Rajlaxmi Industrial Estate, Andheri East, Mumbai - 400093", { size: 8, align: "center" });
  tb.text(297, 84, "Trial Balance", { size: 11, bold: true, align: "center" }).text(297, 97, "1-Apr-2025 to 31-Mar-2026", { size: 8, align: "center" });
  tb.box(40, 110, 515, 16, 0.92).text(48, 121, "Particulars", { size: 8, bold: true }).text(470, 121, "Debit", { size: 8, bold: true, align: "right" }).text(550, 121, "Credit", { size: 8, bold: true, align: "right" });
  y = 142;
  const rows: [string, number, number][] = [["Capital Account", 0, capital], ...otherCredits.slice(0, 4).map(([n, v]) => [n, 0, v] as [string, number, number]), ...debitSide.slice(0, 6).map(([n, v]) => [n, v, 0] as [string, number, number]),
    ["Sales Accounts", 0, otherCredits[4][1]], ["Purchase Accounts", debitSide[6][1], 0], ["Direct Expenses", debitSide[7][1], 0], ["Indirect Expenses", debitSide[8][1], 0], ["Indirect Incomes", 0, otherCredits[5][1]]];
  for (const [name, debit, credit] of rows) {
    tb.text(48, y, name, { size: 9, bold: true }).text(470, y, debit ? inr(debit) : "", { size: 9, align: "right" }).text(550, y, credit ? inr(credit) : "", { size: 9, align: "right" });
    y += 17;
  }
  tb.line(400, y - 6, 555, y - 6).text(48, y + 6, "Grand Total", { size: 9, bold: true }).text(470, y + 6, inr(totalDebit), { size: 9, bold: true, align: "right" }).text(550, y + 6, inr(totalDebit), { size: 9, bold: true, align: "right" }).line(400, y + 12, 555, y + 12);
  files.push({ client: "Kapoor Enterprises", original: "trial balance FY 2025-26.pdf", bytes: tb.bytes() });

  // Iyer Consultants' proprietor: Form 16 from his employer, new regime, FY 2025-26.
  const gross = 1450000, standard = 75000, taxable = gross - standard;
  const slabTax = 20000 + 40000 + Math.round((taxable - 1200000) * 0.15), cess = Math.round(slabTax * 0.04), tax = slabTax + cess, quarter = tax / 4;
  const f16 = new Paper(true);
  f16.text(297, 46, "FORM NO. 16", { size: 12, bold: true, align: "center" }).text(297, 59, "[See rule 31(1)(a)]", { size: 8, align: "center" }).text(297, 74, "PART A", { size: 10, bold: true, align: "center" });
  f16.text(297, 88, "Certificate under Section 203 of the Income-tax Act, 1961 for tax deducted at source on salary paid to an employee under section 192", { size: 7, align: "center" });
  f16.text(297, 98, "or pension/interest income of specified senior citizen under section 194P", { size: 7, align: "center" });
  f16.box(40, 108, 515, 30).text(48, 121, "Certificate No.  KQZTRWX", { size: 8, bold: true }).text(300, 121, `Last updated on  ${shortDate(`${today}`)}`, { size: 8 });
  f16.box(40, 138, 257, 70).box(297, 138, 258, 70);
  f16.text(48, 151, "Name and address of the Employer/Specified Bank", { size: 7, gray: 0.35 }).text(48, 164, "ORION SOFTTECH PRIVATE LIMITED", { size: 8, bold: true }).text(48, 175, "9th Floor, Sapphire Corporate Park, S.G. Highway", { size: 8 }).text(48, 186, "Ahmedabad - 380054, Gujarat", { size: 8 }).text(48, 197, "accounts@orionsofttech.example", { size: 8 });
  f16.text(305, 151, "Name and address of the Employee/Specified senior citizen", { size: 7, gray: 0.35 }).text(305, 164, "VENKATESH IYER", { size: 8, bold: true }).text(305, 175, "B-602, Shaligram Lakeview, Bopal", { size: 8 }).text(305, 186, "Ahmedabad - 380058, Gujarat", { size: 8 });
  f16.box(40, 208, 515, 34);
  [["PAN of the Deductor", "AACCO4821F", 48], ["TAN of the Deductor", "AHMO04821C", 190], ["PAN of the Employee", "ABDPI8901S", 330], ["Assessment Year", "2026-27", 470]].forEach(([label, value, x]) => f16.text(Number(x), 221, String(label), { size: 7, gray: 0.35 }).text(Number(x), 234, String(value), { size: 9, bold: true }));
  f16.text(48, 260, "Summary of amount paid/credited and tax deducted at source thereon in respect of the employee", { size: 8, bold: true });
  f16.box(40, 268, 515, 16, 0.92);
  [[48, "Quarter"], [110, "Receipt numbers of original quarterly TDS statements u/s 200(3)"], [430, "Amount paid/credited"], [552, "Tax deducted"]].forEach(([x, label], i) => f16.text(Number(x), 279, String(label), { size: 6.5, bold: true, align: i >= 2 ? "right" : "left" }));
  ["QVBKTRCD", "QVBMXNPA", "QVBPRLWE", "QVBSTHKY"].forEach((receipt, i) => f16.text(48, 298 + i * 14, `Q${i + 1}`, { size: 8 }).text(110, 298 + i * 14, receipt, { size: 8 }).text(430, 298 + i * 14, inr(gross / 4), { size: 8, align: "right" }).text(552, 298 + i * 14, inr(quarter), { size: 8, align: "right" }));
  f16.line(40, 350, 555, 350).text(48, 362, "Total (Rs.)", { size: 8, bold: true }).text(430, 362, inr(gross), { size: 8, bold: true, align: "right" }).text(552, 362, inr(tax), { size: 8, bold: true, align: "right" });
  f16.text(48, 400, "Verification", { size: 9, bold: true });
  f16.text(48, 414, `I, ANIL MEHROTRA, son of RAKESH MEHROTRA, working in the capacity of DIRECTOR - FINANCE, do hereby certify that a sum of Rs. ${inr(tax)}`, { size: 7.5 });
  f16.text(48, 425, `[${inWords(tax)}] has been deducted and deposited to the credit of the Central Government.`, { size: 7.5 });
  f16.text(48, 450, "Place: Ahmedabad", { size: 8 }).text(48, 462, `Date: ${shortDate(today)}`, { size: 8 }).text(550, 462, "(Signature of person responsible for deduction of tax)", { size: 7, align: "right" });
  f16.page();
  f16.text(297, 46, "PART B (Annexure)", { size: 11, bold: true, align: "center" }).text(297, 60, "Details of Salary Paid and any other income and tax deducted", { size: 8, align: "center" });
  f16.text(48, 82, "Whether opting out of taxation u/s 115BAC(1A)?", { size: 8 }).text(550, 82, "No", { size: 8, bold: true, align: "right" });
  const partB: [string, string, number | null][] = [
    ["1.", "Gross Salary", null], ["(a)", "Salary as per provisions contained in section 17(1)", gross], ["(d)", "Total", gross],
    ["2.", "Less: Allowances to the extent exempt under section 10", 0],
    ["4.", "Less: Deductions under section 16", null], ["(a)", "Standard deduction under section 16(ia)", standard],
    ["6.", "Income chargeable under the head \"Salaries\" [(3+1(e)-5]", taxable],
    ["9.", "Gross total income (6+8)", taxable],
    ["10.", "Deductions under Chapter VI-A (not available under section 115BAC)", 0],
    ["12.", "Total taxable income (9-11)", taxable],
    ["13.", "Tax on total income", slabTax], ["14.", "Rebate under section 87A, if applicable", 0], ["15.", "Surcharge, wherever applicable", 0],
    ["16.", "Health and education cess", cess], ["17.", "Tax payable (13+15+16-14)", tax], ["18.", "Less: Relief under section 89", 0], ["19.", "Net tax payable (17-18)", tax],
  ];
  y = 104;
  for (const [number, label, value] of partB) {
    f16.text(48, y, number, { size: 8 }).text(75, y, label, { size: 8, bold: value === null }).text(550, y, value === null ? "" : inr(value), { size: 8, align: "right" });
    y += 15;
  }
  files.push({ client: "Iyer Consultants", original: "Form 16 FY 2025-26.pdf", bytes: f16.bytes() });

  // His fixed deposit interest certificate, with tax deducted under section 194A.
  const deposits: [string, string, number][] = [["0412 6603 1180", "15-Jun-2024", 34680], ["0412 6603 2294", "02-Feb-2025", 27738]];
  const interest = deposits.reduce((t, [, , v]) => t + v, 0), tds = Math.round(interest * 0.1);
  const cert = new Paper();
  cert.text(297, 50, "AAKASHGANGA SAHAKARI BANK LTD", { size: 13, bold: true, align: "center" }).text(297, 64, "Bopal Branch, Ground Floor, Iscon Platinum, Bopal-Ambli Road, Ahmedabad - 380058", { size: 8, align: "center" }).text(297, 75, "IFSC: AKGB0000417", { size: 8, align: "center" });
  cert.line(40, 84, 555, 84);
  cert.text(297, 104, "INTEREST CERTIFICATE", { size: 11, bold: true, align: "center" }).text(297, 117, "For the Financial Year 2025-26 (01-Apr-2025 to 31-Mar-2026)", { size: 8, align: "center" });
  [["Customer ID", "70044186"], ["Name", "VENKATESH IYER"], ["PAN", "ABDPI8901S"], ["Address", "B-602, Shaligram Lakeview, Bopal, Ahmedabad - 380058"]].forEach(([label, value], i) => cert.text(48, 142 + i * 13, label, { size: 8, gray: 0.35 }).text(140, 142 + i * 13, value, { size: 8, bold: i < 3 }));
  cert.box(40, 200, 515, 16, 0.92);
  [[48, "Account Number", "left"], [190, "Account Type", "left"], [300, "Date of Opening", "left"], [460, "Interest Paid/Accrued", "right"], [550, "TDS u/s 194A", "right"]].forEach(([x, label, align]) => cert.text(Number(x), 211, String(label), { size: 7.5, bold: true, align: align as "left" | "right" }));
  deposits.forEach(([account, opened, amount], i) => cert.text(48, 230 + i * 15, account, { size: 8 }).text(190, 230 + i * 15, "Fixed Deposit", { size: 8 }).text(300, 230 + i * 15, opened, { size: 8 }).text(460, 230 + i * 15, inr(amount), { size: 8, align: "right" }).text(550, 230 + i * 15, inr(Math.round(amount * 0.1)), { size: 8, align: "right" }));
  cert.line(40, 262, 555, 262).text(48, 275, "Total", { size: 8, bold: true }).text(460, 275, inr(interest), { size: 8, bold: true, align: "right" }).text(550, 275, inr(tds), { size: 8, bold: true, align: "right" });
  cert.text(48, 305, "Tax deducted at source has been deposited with the Government and reported in the quarterly TDS returns in Form 26Q.", { size: 8 });
  cert.text(48, 318, "Please verify the credit in your Form 26AS / AIS on the income tax e-filing portal.", { size: 8 });
  cert.text(48, 350, `Date: ${shortDate(today)}`, { size: 8 }).text(550, 350, "Branch Manager", { size: 8, bold: true, align: "right" });
  cert.text(297, 800, "This is a system generated certificate and does not require a signature.", { size: 7, align: "center", gray: 0.4 });
  files.push({ client: "Iyer Consultants", original: "interest certificate FY 2025-26.pdf", bytes: cert.bytes() });

  // Patel Textiles: a scrutiny notice in Form GST ASMT-10 for FY 2025-26.
  const patel = gstin("24", "AACCP3456M"), replyBy = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
  const notice = new Paper(true);
  notice.text(297, 50, "FORM GST ASMT-10", { size: 12, bold: true, align: "center" }).text(297, 63, "[See rule 99(1)]", { size: 8, align: "center" });
  notice.text(48, 88, `Reference No.: ZD2410${today.slice(2, 4)}${today.slice(5, 7)}0418723`, { size: 8 }).text(550, 88, `Date: ${ddmmyyyy(today)}`, { size: 8, align: "right" });
  ["To,", `GSTIN: ${patel}`, "Name: PATEL TEXTILES PRIVATE LIMITED", "Address: Plot 41-42, Pandesara GIDC, Surat, Gujarat - 394221"].forEach((row, i) => notice.text(48, 112 + i * 12, row, { size: 8, bold: i === 2 }));
  notice.text(48, 170, "Tax Period: April 2025 to March 2026 (F.Y. 2025-26)", { size: 8, bold: true });
  notice.text(297, 194, "Notice for intimating discrepancies in the return after scrutiny", { size: 10, bold: true, align: "center" });
  notice.text(48, 216, "This is to inform that during scrutiny of the returns for the tax period specified above, the following discrepancies have been noticed:", { size: 8 });
  notice.box(40, 228, 515, 16, 0.92);
  [[48, "Sr."], [75, "Description of discrepancy"], [430, "Central Tax"], [490, "State Tax"], [550, "Total"]].forEach(([x, label], i) => notice.text(Number(x), 239, String(label), { size: 7.5, bold: true, align: i >= 2 ? "right" : "left" }));
  const discrepancies: [string, number][] = [["Input tax credit availed in GSTR-3B in excess of that available in GSTR-2B", 184215], ["Tax on outward supplies declared in GSTR-1 short paid in GSTR-3B", 23160]];
  discrepancies.forEach(([text, half], i) => notice.text(48, 258 + i * 15, String(i + 1), { size: 8 }).text(75, 258 + i * 15, text, { size: 8 }).text(430, 258 + i * 15, inr(half), { size: 8, align: "right" }).text(490, 258 + i * 15, inr(half), { size: 8, align: "right" }).text(550, 258 + i * 15, inr(half * 2), { size: 8, align: "right" }));
  notice.text(48, 310, `You are hereby directed to explain the reasons for the aforesaid discrepancies by ${ddmmyyyy(replyBy)}.`, { size: 8 });
  notice.text(48, 322, "If no explanation is received by the aforesaid date, it will be presumed that you have nothing to say in the matter and proceedings", { size: 8 });
  notice.text(48, 334, "in accordance with law may be initiated against you without making any further reference to you in this regard.", { size: 8 });
  ["Name: R. K. Solanki", "Designation: Assistant Commissioner of State Tax, Ghatak 72, Surat", "Jurisdiction: Surat"].forEach((row, i) => notice.text(550, 380 + i * 12, row, { size: 8, align: "right" }));
  files.push({ client: "Patel Textiles Pvt Ltd", original: "notice ASMT-10 FY 2025-26.pdf", bytes: notice.bytes() });

  // Rajesh Desai: his savings account statement for the month.
  const entries: [number, string, number, number][] = [
    [1, "NEFT-DESAI ENGINEERING WORKS-SALARY", 0, 0], [3, "UPI/SHREEJI SUPER MARKET/BOPAL", 3842.6, 0], [5, "ACH D- LIFE INSURANCE PREMIUM", 12500, 0], [8, "ATM WDL/BOPAL BR", 10000, 0],
    [12, "UPI/ELECTRICITY BILL/AHMEDABAD", 2716, 0], [15, "NEFT-RENT RECEIVED-SHAH M", 0, 18000], [19, "UPI/SAHJANAND FUEL STATION/SG HWY", 3150, 0], [22, "SIP-MUTUAL FUND", 10000, 0], [28, "INT.PD. SAVINGS ACCOUNT", 0, 1186],
  ];
  entries[0][3] = 112480;
  let funds = 46215.34;
  const statement = new Paper();
  statement.text(48, 50, "AAKASHGANGA SAHAKARI BANK LTD", { size: 12, bold: true }).text(48, 63, "Satellite Branch, Shivranjani Cross Roads, Ahmedabad - 380015", { size: 8 });
  statement.text(550, 50, "STATEMENT OF ACCOUNT", { size: 10, bold: true, align: "right" }).text(550, 63, `${shortDate(day(1))} to ${shortDate(`${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`)}`, { size: 8, align: "right" });
  [["Account Holder", "RAJESH DESAI"], ["Account Number", "XXXXXXXX4417"], ["Account Type", "Savings"], ["IFSC", "AKGB0000409"]].forEach(([label, value], i) => statement.text(48, 92 + i * 12, label, { size: 8, gray: 0.35 }).text(140, 92 + i * 12, value, { size: 8, bold: true }));
  statement.box(40, 148, 515, 16, 0.92);
  [[48, "Date", "left"], [110, "Narration", "left"], [400, "Withdrawal", "right"], [470, "Deposit", "right"], [550, "Balance", "right"]].forEach(([x, label, align]) => statement.text(Number(x), 159, String(label), { size: 8, bold: true, align: align as "left" | "right" }));
  y = 178;
  statement.text(110, y, "OPENING BALANCE", { size: 8, bold: true }).text(550, y, inr(funds), { size: 8, align: "right" });
  for (const [date, narration, out, into] of entries) {
    y += 15;
    funds = round2(funds - out + into);
    statement.text(48, y, shortDate(day(date)), { size: 8 }).text(110, y, narration, { size: 8 }).text(400, y, out ? inr(out) : "", { size: 8, align: "right" }).text(470, y, into ? inr(into) : "", { size: 8, align: "right" }).text(550, y, inr(funds), { size: 8, align: "right" });
  }
  statement.line(40, y + 8, 555, y + 8).text(110, y + 20, "CLOSING BALANCE", { size: 8, bold: true }).text(550, y + 20, inr(funds), { size: 8, bold: true, align: "right" });
  statement.text(297, 800, "This is a computer generated statement and does not require a signature.", { size: 7, align: "center", gray: 0.4 });
  files.push({ client: "Rajesh Desai", original: `bank statement ${monthName}.pdf`, bytes: statement.bytes() });

  return files;
}
