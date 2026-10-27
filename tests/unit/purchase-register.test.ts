import {expect,it} from "vitest";
import {readSheet} from "@/src/lib/sheet";
import {changedKey,changeGap,changeOf,changeState,changeTotal,countsOf,extractPurchases,invoiceKey,matchBills,matchChanged,suggestColumns,totalOf,type Bill,type Changed,type PurchaseMapping} from "@/src/lib/purchase-register";
import {gstr2bBills} from "../../worker/portal";
import {inventedGstin,statement,supplierChangedNotes,supplierChanges,supplierInvoices,supplierNotes} from "../fixtures/portal";

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
  expect(countsOf(result)).toEqual({matched:3,missing:1,extra:1,differ:1,changed:0});
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

it("reads the invoices and notes a supplier corrected, each with the original's number and date",()=>{
  const input=statement(inventedGstin(),{
    b2b:[supplierInvoices(one,[{number:"INV/009",dt:"02-10-2026",txval:100,cgst:9,sgst:9}])],
    b2ba:[supplierChanges(one,[{number:"INV/001A",dt:"05-09-2026",txval:1100,cgst:99,sgst:99,was:{number:"INV/001",dt:"05-09-2026"}}])],
    cdnra:[supplierChangedNotes(two,[{number:"CN/7",dt:"20-09-2026",txval:80,cgst:7.2,sgst:7.2,was:{number:"CN/7",dt:"20-09-2026"}}])],
  });
  const read=gstr2bBills(Buffer.from(JSON.stringify(input)))!;
  expect(read.bills.map((bill)=>bill.number)).toEqual(["INV/009"]);
  expect(read.changed).toEqual([
    {gstin:one,name:"INVENTED SUPPLIER",number:"INV/001A",date:"05-09-2026",amounts:{taxable:110000,igst:0,cgst:9900,sgst:9900,cess:0},was:{number:"INV/001",date:"05-09-2026"}},
    {gstin:two,name:"INVENTED SUPPLIER",number:"CN/7",date:"20-09-2026",note:"C",amounts:{taxable:-8000,igst:0,cgst:-720,sgst:-720,cess:0},was:{number:"CN/7",date:"20-09-2026"}},
  ]);
  // A record marked as an ITC reversal amendment is not read.
  const corrected=supplierChanges(one,[{number:"INV/001A",dt:"05-09-2026",txval:1100,was:{number:"INV/001",dt:"05-09-2026"}}]);
  expect(gstr2bBills(Buffer.from(JSON.stringify(statement(inventedGstin(),{b2ba:[{...corrected,inv:[{...corrected.inv[0],isITCRevAmd:"Y"}]}]}))))!.changed).toEqual([]);
});

it("lists what each correction changes this month, by GSTN's rule, and what the books still show",()=>{
  const was=(number:string,date="2026-08-05")=>({number,date});
  const changed:Changed[]=[
    // Up: 1,000 and 180 tax corrected to 1,100 and 198; the books still show the old amount.
    {gstin:one,number:"INV/1",date:"2026-08-05",amounts:amounts(110000,9900,9900),was:was("INV/1")},
    // Down, under a new number: 500 and 90 tax to 400 and 72; the books show the corrected one.
    {gstin:one,number:"INV/2R",date:"2026-08-06",amounts:amounts(40000,3600,3600),was:was("INV/2")},
    // A credit note of 100 and 18 tax corrected to 80 and 14.40, in August's books.
    {gstin:two,number:"CN/7",date:"2026-08-20",note:"C",amounts:amounts(-8000,-720,-720),was:was("CN/7")},
    // In an earlier GSTR-2B but not in the books.
    {gstin:two,number:"T-9",date:"2026-08-08",amounts:amounts(12000,1080,1080),was:was("T-9")},
    // No earlier GSTR-2B has the original, and the books show another amount.
    {gstin:two,number:"T-12",date:"2026-08-09",amounts:amounts(6000,540,540),was:was("T-12")},
  ];
  const august=(value:ReturnType<typeof amounts>)=>({amounts:value,period:"2026-08"});
  const originals=new Map([[changedKey(changed[0],"INV/1"),august(amounts(100000,9000,9000))],[changedKey(changed[1],"INV/2"),august(amounts(50000,4500,4500))],
    [changedKey(changed[2],"CN/7"),august(amounts(-10000,-900,-900))],[changedKey(changed[3],"T-9"),august(amounts(10000,900,900))]]);
  // A note's original is a note, never an invoice of the same number.
  expect(changedKey(changed[2],"CN/7")).not.toBe(changedKey({gstin:two},"CN/7"));
  const books=[book("inv 1",100000,9000,9000,3),book("INV/2R",40000,3600,3600,4),book("T-12",5000,450,450,5,two)];
  const result=matchChanged(matchBills(books,[]),changed,originals,new Map([[invoiceKey(two,"CN/7"),{...august(amounts(10000,900,900)),rows:[7]}]]));
  // Bills the correction explains are no longer "not in GSTR-2B".
  expect(result.missing).toEqual([]);
  expect(result.changed.map((entry)=>[entry.number,changeState(entry),changeOf(entry)])).toEqual([
    ["INV/1","old",amounts(10000,900,900)],
    ["INV/2R","done",amounts(-10000,-900,-900)],
    ["CN/7","old",amounts(2000,180,180)],
    ["T-9","absent",amounts(2000,180,180)],
    ["T-12","other",undefined],
  ]);
  expect(result.changed[2]).toMatchObject({books:amounts(10000,900,900),booked:"2026-08",rows:[7],was:{number:"CN/7",period:"2026-08"}});
  expect(result.changed[0]).toMatchObject({rows:[3],was:{number:"INV/1",date:"2026-08-05",period:"2026-08",amounts:amounts(100000,9000,9000)}});
  expect(result.changed[4].was).toEqual(was("T-12"));
  // Corrected less original, a credit note's below zero, and only those whose original is known.
  expect(changeTotal(result.changed)).toEqual(amounts(4000,360,360));
  expect(countsOf(result)).toEqual({matched:0,missing:0,extra:0,differ:0,changed:4});
});

// GSTR-2B's summary gives the change its corrections make this month (FAQ question 8: "the
// differential tax amount (Amended – Original)"): changed invoices in Part A, changed credit notes
// in Part B, which takes credit away. Invented figures only.
it("checks GSTR-2B's own total of the corrections against the bills listed, and says nothing when they agree",()=>{
  // Changed invoices up ₹1.80 a head; a changed credit note down ₹1.80, so credit up ₹1.80.
  const summary={itcavl:{nonrevsup:{igst:0,cgst:1.8,sgst:1.8,cess:0,b2ba:{igst:0,cgst:1.8,sgst:1.8,cess:0}},othersup:{igst:0,cgst:-1.8,sgst:-1.8,cess:0,cdnra:{igst:0,cgst:-1.8,sgst:-1.8,cess:0}}},
    itcunavl:{revsup:{igst:0.5,cgst:0,sgst:0,cess:0,b2ba:{igst:0.5,cgst:0,sgst:0,cess:0}}}};
  const input=statement(inventedGstin());
  expect(gstr2bBills(Buffer.from(JSON.stringify({...input,data:{...input.data,itcsumm:summary}})))!.official).toEqual({igst:50,cgst:360,sgst:360,cess:0});
  // A summary with no corrected section gives no total.
  expect(gstr2bBills(Buffer.from(JSON.stringify(input)))!.official).toBeUndefined();
  // One bill whose original an earlier GSTR-2B has (up ₹3.60 a head), one whose original none has.
  const changed:Changed[]=[{gstin:one,number:"INV/1",date:"2026-08-05",amounts:amounts(104000,9360,9360),was:{number:"INV/1",date:"2026-08-05"}},
    {gstin:two,number:"T-12",date:"2026-08-09",amounts:amounts(60000,5400,5400),was:{number:"T-12",date:"2026-08-09"}}];
  const listed=(official?:{igst:number;cgst:number;sgst:number;cess:number})=>({...matchChanged(matchBills([],[]),changed,new Map([[changedKey(changed[0],"INV/1"),{amounts:amounts(100000,9000,9000),period:"2026-08"}]])),official});
  expect(changeGap(listed())).toBeNull();
  expect(changeGap(listed({igst:0,cgst:360,sgst:360,cess:0}))).toBeNull();
  expect(changeGap(listed({igst:0,cgst:450,sgst:270,cess:0}))).toBeNull();
  // The summary also counts T-12 (up ₹9 a head): more than ₹1 apart on a head.
  expect(changeGap(listed({igst:0,cgst:1260,sgst:1260,cess:0}))).toEqual({official:2520,listed:720});
  expect(changeGap(listed({igst:0,cgst:360,sgst:360,cess:101}))).toEqual({official:821,listed:720});
});
