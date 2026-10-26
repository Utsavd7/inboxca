import {z} from "zod";
import {date,sameHeadings} from "./sales-register";

// GSTR-2B against the purchase register (PLAN.md "Less work for the firm", 26 Oct 2026): the
// client's own register, read with the columns a person confirmed, is matched bill by bill
// with the month's GSTR-2B. InboxCA only lists the differences; the CA decides what to claim.
export const purchaseFields=["Supplier GSTIN","Invoice number","Invoice date","Taxable value","IGST","CGST","SGST","Cess"] as const;
// The supplier, the invoice and its taxable value are needed; a tax column not in the file is nil.
const needed=[0,1,3];
export const purchaseMappingSchema=z.object({header:z.number().int().min(0).max(39),headings:z.array(z.string().max(200)).min(1).max(26),columns:z.array(z.number().int().min(-1).max(25)).length(purchaseFields.length)});
export type PurchaseMapping=z.infer<typeof purchaseMappingSchema>;
export const purchaseMappingPlace=(client:string)=>`clients/${client}/purchase_mapping`;
export const matchPlace=(register:string)=>`documents/${register}/gst_match`;

// Amounts in paise. A GSTR-2B credit note's are below zero.
const heads=["taxable","igst","cgst","sgst","cess"] as const;
export const amountsSchema=z.object({taxable:z.number().int(),igst:z.number().int(),cgst:z.number().int(),sgst:z.number().int(),cess:z.number().int()});
export type Amounts=z.infer<typeof amountsSchema>;
export type Bill={gstin:string;number:string;date:string;amounts:Amounts;row?:number;name?:string;note?:"C"|"D"};
export const entrySchema=z.object({gstin:z.string().max(15),number:z.string().max(40),date:z.string().max(20),name:z.string().max(100).optional(),note:z.enum(["C","D"]).optional(),books:amountsSchema.optional(),portal:amountsSchema.optional(),rows:z.array(z.number().int()).max(1000).optional(),times:z.number().int().optional()});
export type Entry=z.infer<typeof entrySchema>;
export const matchSchema=z.object({matched:z.array(entrySchema),missing:z.array(entrySchema),extra:z.array(entrySchema),differ:z.array(entrySchema),skipped:z.number().int().min(0)});
export type Match=z.infer<typeof matchSchema>;
export type Counts={matched:number;missing:number;extra:number;differ:number};

// A reason a person can fix, as a short code the page turns into words.
export class MatchProblem extends Error {code:string;constructor(code:string) {super(code);this.code=code;}}

const AMOUNT=/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/;
export const readDate=(raw:string)=>{try {return raw ? date(raw) : "";} catch {return raw.slice(0,20);}};

// The columns whose heading is the field's own name, offered for the person to confirm.
export const suggestColumns=(headings:string[])=>purchaseFields.map((name)=>headings.findIndex((heading)=>heading.trim().toLowerCase()===name.toLowerCase()));

// The register's bills under the confirmed columns. Empty rows and total rows are left out, and
// so are rows with no supplier GSTIN or invoice number (an unregistered supplier's bill never
// reaches GSTR-2B): those are counted.
export function extractPurchases(rows:string[][],asked:PurchaseMapping) {
  const mapping=purchaseMappingSchema.parse(asked),used=mapping.columns.filter((column)=>column>=0);
  if(!sameHeadings(rows[mapping.header] ?? [],mapping.headings)) throw new MatchProblem("columns");
  if(needed.some((field)=>mapping.columns[field]<0)) throw new MatchProblem("needed");
  if(new Set(used).size!==used.length || used.some((column)=>column>=mapping.headings.length)) throw new MatchProblem("distinct");
  const bills:Bill[]=[];let skipped=0;
  for(let row=mapping.header+1;row<rows.length;row++) {
    const cell=(field:number)=>mapping.columns[field]<0 ? "" : (rows[row][mapping.columns[field]] ?? "").trim();
    if(!rows[row].some((value)=>value.trim()) || rows[row].some((value)=>/^(grand\s+)?total$/i.test(value.trim()))) continue;
    const gstin=cell(0).replace(/\s/g,"").toUpperCase(),number=cell(1);
    if(!/^\d{2}[A-Z0-9]{13}$/.test(gstin) || !number) {skipped++;continue;}
    const amounts=Object.fromEntries(heads.map((head,at)=>{
      const raw=cell(at+3);
      if(raw && !AMOUNT.test(raw)) throw new MatchProblem(`cell-${at+3}-${row+1}`);
      return [head,raw ? Math.round(Number(raw.replaceAll(",",""))*100) : 0];
    })) as Amounts;
    bills.push({gstin,number:number.slice(0,40),date:readDate(cell(2)),amounts,row:row+1});
  }
  if(!bills.length) throw new MatchProblem("empty");
  return {bills,skipped};
}

// The same bill as people write it differently: case, spaces, slashes, dashes and dots, and
// leading zeros in each run of digits ("INV/0042" and "inv 42" are one bill).
export const invoiceKey=(gstin:string,number:string)=>`${gstin}|${number.toUpperCase().replace(/\d+/g,(digits)=>digits.replace(/^0+(?=\d)/,"")).replace(/[^A-Z0-9]/g,"")}`;
const zero:Amounts={taxable:0,igst:0,cgst:0,sgst:0,cess:0};
const add=(a:Amounts,b:Amounts)=>Object.fromEntries(heads.map((head)=>[head,a[head]+b[head]])) as Amounts;
// Within one rupee on the taxable value and on each tax. A note counts the same whether the
// books show it below zero or above.
export const agrees=(a:Amounts,b:Amounts)=>heads.every((head)=>Math.abs(Math.abs(a[head])-Math.abs(b[head]))<=100);

// A bill on several rows (one row an item or a tax rate, or booked twice) is added up and
// keeps its row numbers; one listed twice in GSTR-2B is added up and counted.
function grouped(bills:Bill[]) {
  const map=new Map<string,{bill:Bill;amounts:Amounts;rows:number[];times:number}>();
  for(const bill of bills) {
    const key=invoiceKey(bill.gstin,bill.number),seen=map.get(key);
    if(seen) {seen.amounts=add(seen.amounts,bill.amounts);seen.times++;if(bill.row) seen.rows.push(bill.row);}
    else map.set(key,{bill,amounts:bill.amounts,rows:bill.row ? [bill.row] : [],times:1});
  }
  return map;
}
export function matchBills(books:Bill[],portal:Bill[],skipped=0):Match {
  const ours=grouped(books),theirs=grouped(portal),result:Match={matched:[],missing:[],extra:[],differ:[],skipped};
  const listed=(from:{bill:Bill;times:number})=>({...(from.bill.name && {name:from.bill.name}),...(from.bill.note && {note:from.bill.note}),...(from.times>1 && {times:from.times})});
  for(const [key,book] of ours) {
    const statement=theirs.get(key);
    const entry:Entry={gstin:book.bill.gstin,number:book.bill.number,date:book.bill.date,books:book.amounts,rows:book.rows,...(statement && {...listed(statement),portal:statement.amounts})};
    (!statement ? result.missing : agrees(book.amounts,statement.amounts) ? result.matched : result.differ).push(entry);
  }
  for(const [key,statement] of theirs) if(!ours.has(key)) result.extra.push({gstin:statement.bill.gstin,number:statement.bill.number,date:statement.bill.date,...listed(statement),portal:statement.amounts});
  return result;
}

export const countsOf=(match:Match):Counts=>({matched:match.matched.length,missing:match.missing.length,extra:match.extra.length,differ:match.differ.length});
export const totalOf=(entries:Entry[],side:"books"|"portal")=>entries.reduce((sum,entry)=>entry[side] ? add(sum,entry[side]!) : sum,zero);
export const taxOf=(amounts:Amounts)=>amounts.igst+amounts.cgst+amounts.sgst+amounts.cess;
export const rupees=(paise:number)=>(paise/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

// "12 matched, 3 not in GSTR-2B: ask the supplier, 1 amount differs".
export function matchLine(counts:Counts) {
  return [`${counts.matched} matched`,counts.missing && `${counts.missing} not in GSTR-2B: ask the supplier`,counts.extra && `${counts.extra} in GSTR-2B but not in the books`,
    counts.differ && `${counts.differ} ${counts.differ===1 ? "amount differs" : "amounts differ"}`].filter(Boolean).join(", ");
}
