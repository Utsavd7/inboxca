import {expect,it} from "vitest";
import {readSheet} from "@/src/lib/sheet";
import {countsOf,extractPurchases,invoiceKey,matchBills,matchLine,suggestColumns,totalOf,type Bill,type PurchaseMapping} from "@/src/lib/purchase-register";
import {gstr2bBills} from "../../worker/portal";
import {inventedGstin,statement,supplierInvoices,supplierNotes} from "../fixtures/portal";

// Invented suppliers and bills only.
const one=inventedGstin("ZZZPZ0002Z"),two=inventedGstin("ZZZPZ0003Z");
const amounts=(taxable:number,cgst=0,sgst=0,igst=0)=>({taxable,igst,cgst,sgst,cess:0});
const book=(number:string,taxable:number,cgst=0,sgst=0,row=2,gstin=one):Bill=>({gstin,number,date:"2026-09-05",amounts:amounts(taxable,cgst,sgst),row});

it("finds the same bill however its number is written, and only from the same supplier",()=>{
  expect(invoiceKey(one,"INV/0042")).toBe(invoiceKey(one,"inv 42"));
  expect(invoiceKey(one,"2026/0045")).toBe(invoiceKey(one,"2026-45"));
  expect(invoiceKey(one,"A01B")).toBe(invoiceKey(one,"a.1.b"));
  expect(invoiceKey(one,"0")).toBe(`${one}|0`);
  expect(invoiceKey(one,"INV/42")).not.toBe(invoiceKey(two,"INV/42"));
  expect(invoiceKey(one,"INV/420")).not.toBe(invoiceKey(one,"INV/42"));
});

it("reads only the confirmed columns, counts bills without a supplier GSTIN, and names a wrong cell",()=>{
  const rows=readSheet(Buffer.from([
    "Invented purchase register,,,,,,",
    "Party GSTIN,Bill No,Bill Date,Taxable,CGST,SGST,Note",
    `${one.toLowerCase()},INV/001,05-09-2026,"1,00,000.00","9,000.00","9,000.00",`,
    ",CASH-1,06-09-2026,500.00,0,0,unregistered supplier",
    "",
    `${two},INV-7,46280,200.50,18.05,18.05,`,
    "Total,,,100700.50,9018.05,9018.05,",
  ].join("\n")),"register.csv",{rows:1000,columns:26,keepEmpty:true});
  const mapping:PurchaseMapping={header:1,headings:rows[1],columns:[0,1,2,3,-1,4,5,-1]};
  expect(suggestColumns(["Supplier GSTIN","invoice number","IGST","Cess "])).toEqual([0,1,-1,-1,2,-1,-1,3]);
  const {bills,skipped}=extractPurchases(rows,mapping);
  expect(skipped).toBe(1);
  expect(bills).toEqual([
    {gstin:one,number:"INV/001",date:"2026-09-05",amounts:{taxable:10000000,igst:0,cgst:900000,sgst:900000,cess:0},row:3},
    {gstin:two,number:"INV-7",date:"2026-09-15",amounts:{taxable:20050,igst:0,cgst:1805,sgst:1805,cess:0},row:6},
  ]);
  expect(()=>extractPurchases([rows[0],["Changed",...rows[1].slice(1)],...rows.slice(2)],mapping)).toThrow("columns");
  expect(()=>extractPurchases(rows,{...mapping,columns:[0,-1,2,3,-1,4,5,-1]})).toThrow("needed");
  expect(()=>extractPurchases(rows,{...mapping,columns:[0,1,2,3,-1,4,4,-1]})).toThrow("distinct");
  expect(()=>extractPurchases([...rows.slice(0,2),[one,"INV/9","","12a","","",""]],mapping)).toThrow("cell-3-3");
  expect(()=>extractPurchases(rows.slice(0,2),mapping)).toThrow("empty");
});

it("matches within one rupee on every amount, adds up a bill on several rows, and lists the rest",()=>{
  const portal:Bill[]=[
    {gstin:one,number:"INV-0001",date:"2026-09-05",name:"INVENTED SUPPLIER",amounts:amounts(100000,9001,8999)},
    {gstin:one,number:"INV/2",date:"2026-09-06",amounts:amounts(50000,4500,4500)},
    {gstin:one,number:"INV/3",date:"2026-09-07",amounts:amounts(30000,0,0,5400)},
    {gstin:two,number:"T-9",date:"2026-09-08",amounts:amounts(10000,900,900)},
    {gstin:two,number:"T-10",date:"2026-09-09",amounts:amounts(5000,450,450)},
    {gstin:two,number:"T-10",date:"2026-09-09",amounts:amounts(5000,450,450)},
  ];
  const books=[book("inv 1",100000,9000,9000,3),book("INV/2",40000,3600,3600,4),book("INV/2",10000,900,900,5),book("INV/3",30000,2700,2700,6),book("INV/4",20000,1800,1800,7),book("T-10",10000,900,900,8,two)];
  const result=matchBills(books,portal,2);
  expect(result.matched.map((entry)=>[entry.number,entry.rows,entry.name])).toEqual([["inv 1",[3],"INVENTED SUPPLIER"],["INV/2",[4,5],undefined],["T-10",[8],undefined]]);
  expect(result.matched[2].times).toBe(2);
  // IGST in GSTR-2B against CGST and SGST in the books is a difference, though the tax adds up.
  expect(result.differ.map((entry)=>entry.number)).toEqual(["INV/3"]);
  expect(result.missing.map((entry)=>[entry.gstin,entry.number])).toEqual([[one,"INV/4"]]);
  expect(result.extra.map((entry)=>[entry.gstin,entry.number,entry.books])).toEqual([[two,"T-9",undefined]]);
  expect(totalOf(result.matched,"books")).toEqual({taxable:160000,igst:0,cgst:14400,sgst:14400,cess:0});
  expect(totalOf(result.extra,"portal").taxable).toBe(10000);
  expect(matchBills([book("INV/5",100000,9000,9000)],[{...portal[0],number:"INV/5",amounts:amounts(100101,9000,9000)}]).differ).toHaveLength(1);
  expect(countsOf(result)).toEqual({matched:3,missing:1,extra:1,differ:1});
  expect(matchLine(countsOf(result))).toBe("3 matched, 1 not in GSTR-2B: ask the supplier, 1 in GSTR-2B but not in the books, 1 amount differs");
  expect(matchLine({matched:12,missing:3,extra:0,differ:2})).toBe("12 matched, 3 not in GSTR-2B: ask the supplier, 2 amounts differ");
  expect(result.skipped).toBe(2);
});

it("reads GSTR-2B invoices and notes through the pinned official schema, a credit note below zero",()=>{
  const input=statement(inventedGstin(),{
    b2b:[supplierInvoices(one,[{number:"INV/001",dt:"05-09-2026",txval:1000,cgst:90,sgst:90}])],
    cdnr:[supplierNotes(two,[{number:"CN/7",dt:"20-09-2026",txval:100,cgst:9,sgst:9},{number:"DN/8",dt:"21-09-2026",txval:50,igst:9,typ:"D"}])],
  });
  // An invoice given only by its items is added up from them.
  const items={...input,data:{...input.data,docdata:{b2b:[{...supplierInvoices(one,[]),inv:[{inum:"INV/2",typ:"R",dt:"06-09-2026",val:236,pos:"24",rev:"N",itcavl:"Y",items:[{num:1,rt:18,txval:100,cgst:9,sgst:9},{num:2,rt:18,txval:100,cgst:9,sgst:9}]}]}]}}};
  const read=gstr2bBills(Buffer.from(JSON.stringify(input)))!;
  expect(read).toMatchObject({gstin:inventedGstin(),period:"2026-09",version:"v4.5"});
  expect(read.bills).toEqual([
    {gstin:one,name:"INVENTED SUPPLIER",number:"INV/001",date:"05-09-2026",amounts:{taxable:100000,igst:0,cgst:9000,sgst:9000,cess:0}},
    {gstin:two,name:"INVENTED SUPPLIER",number:"CN/7",date:"20-09-2026",note:"C",amounts:{taxable:-10000,igst:0,cgst:-900,sgst:-900,cess:0}},
    {gstin:two,name:"INVENTED SUPPLIER",number:"DN/8",date:"21-09-2026",note:"D",amounts:{taxable:5000,igst:900,cgst:0,sgst:0,cess:0}},
  ]);
  expect(gstr2bBills(Buffer.from(JSON.stringify(items)))!.bills[0].amounts).toEqual({taxable:20000,igst:0,cgst:1800,sgst:1800,cess:0});
  // A credit note in the books, below zero or not, matches the supplier's.
  const note={gstin:two,number:"cn 7",date:"2026-09-20",amounts:amounts(-10000,-900,-900),row:9};
  expect(matchBills([note],read.bills).matched).toHaveLength(1);
  expect(matchBills([{...note,amounts:amounts(10000,900,900)}],read.bills).matched[0].note).toBe("C");
  // Not the official layout, or not a GSTR-2B: nothing is read.
  expect(gstr2bBills(Buffer.from(JSON.stringify({...input,data:{...input.data,rtnprd:"132026"}})))).toBeNull();
  expect(gstr2bBills(Buffer.from("not json"))).toBeNull();
});
