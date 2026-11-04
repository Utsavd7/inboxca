import {expect,it} from "vitest";
import {checkStatement,extractTds,readStatement,statementFile,type Deductor,type Payment} from "@/src/lib/tds";

// An invented deductor with two challans and three payments. Every TAN, PAN and name is
// invented and clearly fake (ggignore: invented test identifiers, not secrets).
const tan="ZZZZ99999Z",pan="ZZZPZ0001Z";
const deductor:Deductor={name:"Invented Traders",type:"F",flat:"12 Invented Lane",post:"",road:"Test Road",area:"",district:"Invented District",state:"24",pin:"380001",country:"India",email:"tds@invented.test",code:"91",phone:"9000000001",govt_state:"",ministry:"",ministry_other:"",
  person:{name:"Invented Partner",designation:"Partner",flat:"12 Invented Lane",post:"",road:"",area:"",district:"",state:"24",pin:"380001",country:"India",email:"",code:"91",phone:"9000000002",pan:"ZZZPZ0009Z"}};
const draft="00000000-0000-4000-8000-000000000001",entered="00000000-0000-4000-8000-000000000002";
let next=0;
const lines=(kind:"p"|"c",row:number,values:Record<string,string>)=>Object.entries(values).map(([key,value])=>({id:`l${++next}`,field:`tds.${kind}${row}.${key}`,value}));
const payments=[
  lines("p",2,{pan:"ZZZPZ0002Z",name:"Invented Contractor",section:"1024",paid_on:"2026-07-10",amount:"100000.00",tds:"2000.00",rate:"2",challan:"123"}),
  lines("p",3,{pan:"ZZZPZ0003Z",name:"Invented Consultant",section:"1027",paid_on:"2026-08-05",amount:"50000",tds:"5000",rate:"10",challan:"123",deducted_on:"2026-08-04"}),
  lines("p",4,{pan:"",name:"Invented Landlord",section:"1009",paid_on:"2026-09-01",amount:"30000",tds:"6000",rate:"20",challan:"45",remark:"C"}),
].flat();
const challans=[
  lines("c",1,{bsr:"510308",date:"2026-09-06",number:"123",tax:"7000",interest:"0",minor:"200"}),
  lines("c",2,{bsr:"0510308",date:"2026-10-05",number:"00045",tax:"6000",interest:"150",fee:"0",others:"0"}),
  lines("p",9,{name:"Invented Shop",pan:"ZZZPZ0004Z",section:"1031",paid_on:"2026-09-20",amount:"20000",tds:"0",remark:"Y"}),
].flat();
const read=()=>readStatement([{id:draft,lines:payments},{id:entered,lines:[...challans,{id:"s1",field:"tds.s.previous",value:"N"}]}]);
const base=()=>({tan,pan,deductor,period:"2026-09",today:"2026-10-20",...read()});

it("writes Form No. 140 record by record, field by field, as Protean's format sets it",()=>{
  const statement=base(),checked=checkStatement(statement);
  expect(checked.errors).toEqual([]);
  const file=statementFile({...statement,challans:checked.challans});
  // General notes 1, 2 and 10: ASCII, every line ending in CR LF, one fewer ^ than fields.
  expect(/^[\x20-\x7e\r\n]+$/.test(file)).toBe(true);expect(file.endsWith("\r\n")).toBe(true);
  const records=file.slice(0,-2).split("\r\n").map(line=>line.split("^"));
  expect(file.split("\r\n").slice(0,-1).every(line=>!line.includes("\n"))).toBe(true);
  expect(records.map(fields=>[fields[1],fields.length])).toEqual([["FH",18],["BH",72],["CD",30],["DD",45],["DD",45],["CD",30],["DD",45],["CD",30],["DD",45]]);
  expect(records.map(fields=>fields[0])).toEqual(["1","2","3","4","5","6","7","8","9"]);
  const [fh,bh,cd1,dd1,dd2,cd2,dd3,nil,dd4]=records;
  // File header (rows 22 to 39).
  expect(fh).toEqual(["1","FH","NS1","R","20102026","1","D",tan,"1","InboxCA","","","","","","","",""]);
  // Batch header (rows 44 to 115): counts, the deductor, the person responsible and the total.
  const at=(fields:string[],number:number)=>fields[number-1];
  expect([2,3,4,5,9,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32].map(n=>at(bh,n))).toEqual(["BH","1","3","140","",tan,"",pan,"202728","202627","Q2","Invented Traders","India","12 Invented Lane","","Test Road","","Invented District","24","380001","tds@invented.test","91","9000000001","","F"]);
  expect([33,34,35,40,41,42,43,44,45,47,48,52,54,57,58,59,68,69].map(n=>at(bh,n))).toEqual(["Invented Partner","Partner","12 Invented Lane","24","380001","","India","91","9000000002","13150.00","","N","","","","ZZZPZ0009Z","",""]);
  // Challans (rows 120 to 149): tax, interest, fee, others, total, mode, BSR, serial, date,
  // the payments' deposited and deducted totals, minor head and the allocations.
  expect(cd1).toEqual(["3","CD","1","1","2","N","","7000.00","0.00","0.00","0.00","7000.00","C","","0510308","","00123","","06092026","","7000.00","7000.00","200","0.00","0.00","","","","",""]);
  expect(cd2.slice(3,25)).toEqual(["2","1","N","","6000.00","150.00","0.00","0.00","6150.00","C","","0510308","","00045","","05102026","","6000.00","6000.00","","150.00","0.00"]);
  // A nil challan (row 125): no amounts, mode, BSR code or serial; dated the quarter's last day.
  expect(nil.slice(3,25)).toEqual(["3","1","Y","","0.00","0.00","0.00","0.00","0.00","","","","","","","30092026","","0.00","0.00","","0.00","0.00"]);
  // Deductees (rows 154 to 198), numbered under each challan, referring to it.
  expect(dd1).toEqual(["4","DD","1","1","1","O","","ZZZPZ0002Z","Invented Contractor","","","","","","1024","","","Y","10072026","100000.00","","","","2000.00","2000.00","","10072026","2.0000","","","","","","","","","","","","","","","","",""]);
  expect([4,5,8,15,19,20,24,25,27,28].map(n=>at(dd2,n))).toEqual(["2","1","ZZZPZ0003Z","1027","05082026","50000.00","5000.00","5000.00","04082026","10.0000"]);
  // Row 161: no PAN is written PANNOTAVBL.
  expect([4,5,8,32].map(n=>at(dd3,n))).toEqual(["1","2","PANNOTAVBL","C"]);
  // Row 180 and 181: no deduction date and a 0.0000 rate when no tax was deducted.
  expect([4,5,8,18,24,25,27,28,32].map(n=>at(dd4,n))).toEqual(["1","3","ZZZPZ0004Z","Y","0.00","0.00","","0.0000","Y"]);
  // The batch total is every challan's total (row 90).
  expect(at(bh,47)).toBe("13150.00");
  expect(checked.warnings.map(issue=>issue.text)).toEqual([expect.stringContaining("Row 4: no PAN")]);
});

it("checks each rule of the format before a statement is made",()=>{
  const texts=(statement:Parameters<typeof checkStatement>[0])=>checkStatement(statement).errors.map(issue=>issue.text).join("\n");
  const changed=(row:number,values:Partial<Payment>)=>{const s=base(),pay=s.payments.find(one=>one.row===row)!;return {...s,payments:s.payments.map(one=>one===pay ? {...pay,...values} : one)};};
  expect(texts({...base(),period:"2026-03"})).toMatch(/tax year 2026-27 onwards/);
  expect(texts({...base(),tan:"ZZZZ9999Z"})).toMatch(/TAN must be/);
  expect(texts({...base(),deductor:null})).toMatch(/TDS statement details/);
  expect(texts({...base(),deductor:{...deductor,pin:"38000",email:"",person:{...deductor.person,email:"",pan:"",designation:"A designation far too long"}}})).toMatch(/PIN code needs 6 digits[\s\S]*email or the responsible[\s\S]*PAN is missing/);
  expect(texts({...base(),deductor:{...deductor,email:"tds@invented"}})).toMatch(/email is not a valid address/);
  expect(texts({...base(),deductor:{...deductor,type:"S"}})).toMatch(/state of this State Government/);
  expect(texts({...base(),deductor:{...deductor,type:"A"},pan:"PANNOTREQD"})).toMatch(/ministry of this Central Government/);
  expect(texts({...base(),pan:"PANNOTREQD"})).toMatch(/Add the client's PAN/);
  expect(texts({...base(),previous:"Y",token:"12345"})).toMatch(/15 digit token/);
  expect(texts({...base(),previous:""})).toMatch(/earlier quarter/);
  expect(texts(changed(2,{pan:"ZZZPZ002Z"}))).toMatch(/Row 2: the PAN is not a valid PAN/);
  expect(texts(changed(2,{section:"194C"}))).toMatch(/official four digit codes/);
  expect(texts(changed(2,{paidOn:"2026-06-30"}))).toMatch(/within the quarter/);
  expect(texts(changed(2,{rate:""}))).toMatch(/rate is missing/);
  expect(texts(changed(2,{rate:"2.12345"}))).toMatch(/up to four decimals/);
  expect(texts(changed(2,{deductedOn:"2026-06-30"}))).toMatch(/date of deduction must be on or after 01-07-2026/);
  expect(texts(changed(2,{challan:"999"}))).toMatch(/no challan with serial number 999/);
  expect(texts(changed(2,{remark:"B",section:"1024"}))).toMatch(/reason code B does not go with section code 1024/);
  expect(texts(changed(2,{remark:"A"}))).toMatch(/needs the certificate number/);
  expect(texts(changed(4,{remark:"T",section:"1024"}))).toMatch(/transporter\) needs the deductee's PAN/);
  expect(texts(changed(2,{section:"1059",tds:BigInt(0),deposited:BigInt(0),rate:"0"}))).toBe("");
  expect(texts(changed(4,{section:"1034"}))).toMatch(/code 1034 needs the deductee's real PAN[\s\S]*must be 0/);
  expect(texts(changed(9,{remark:"",tds:BigInt(0)}))).toMatch(/Give the reason code for no deduction/);
  expect(texts(changed(2,{section:"1065"}))).toMatch(/needs the cash withdrawn/);
  expect(texts(changed(2,{tds:BigInt(300000),deposited:BigInt(300000)}))).toMatch(/more than its tax of ₹7,000.00/);
  expect(texts(changed(2,{form121:"SHORT"}))).toMatch(/26 characters/);
  expect(texts(changed(9,{rate:"5"}))).toMatch(/rate must be 0/);
  expect(texts({...base(),payments:[]})).toMatch(/at least one payment/);
  const s=base();
  expect(texts({...s,challans:s.challans.map(c=>c.row===1 ? {...c,bsr:"51030800"} : c)})).toMatch(/BSR code needs up to 7 digits/);
  expect(texts({...s,challans:s.challans.map(c=>c.row===1 ? {...c,date:"2025-03-31"} : c)})).toMatch(/on or after 1 April 2025/);
  expect(texts({...s,challans:s.challans.map(c=>c.row===1 ? {...c,tax:BigInt(700050)} : c)})).toMatch(/whole rupees/);
  expect(texts({...s,challans:s.challans.map(c=>c.row===1 ? {...c,minor:"300"} : c)})).toMatch(/minor head must be 200, 400 or 100/);
  expect(texts({...s,challans:s.challans.map(c=>c.row===2 ? {...c,number:"123"} : c)})).toMatch(/Two challans have serial number 123/);
  // A challan with more tax than its payments is a warning, not an error.
  const more=checkStatement({...s,challans:s.challans.map(c=>c.row===1 ? {...c,tax:BigInt(800000)} : c)});
  expect(more.errors).toEqual([]);expect(more.warnings.map(issue=>issue.text)).toContainEqual("Challan 123: ₹1,000.00 of its tax is not linked to any payment in this statement.");
  // A character the file cannot hold is refused when the file is made.
  const odd=checkStatement({...s,deductor:{...deductor,name:"Invented ^ Traders"}});
  expect(()=>statementFile({...s,deductor:{...deductor,name:"Invented ^ Traders"},challans:odd.challans})).toThrow(/no \^/);
});

it("reads a register under the columns a person chose, and refuses a changed layout",()=>{
  const rows=[["Party PAN","Party","Code","Paid on","Amount","TDS","Rate %","Challan"],["ZZZPZ0002Z","Invented Contractor","1024.0","10/07/2026","1,00,000.00","2000","2","00123"],["","","","","","","",""],["Total","","","","100000","2000","",""]];
  const mapping={kind:"payments" as const,header:0,headings:rows[0],columns:[0,1,2,3,4,5,6,7,-1,-1,-1,-1,-1,-1]};
  const read=extractTds(rows,mapping);
  expect(read.map(line=>[line.field,line.value])).toEqual([["tds.p2.pan","ZZZPZ0002Z"],["tds.p2.name","Invented Contractor"],["tds.p2.section","1024"],["tds.p2.paid_on","2026-07-10"],["tds.p2.amount","100000.00"],["tds.p2.tds","2000"],["tds.p2.rate","2"],["tds.p2.challan","00123"]]);
  expect(()=>extractTds([["Other"],...rows.slice(1)],mapping)).toThrow(/columns changed/);
  expect(()=>extractTds(rows,{...mapping,columns:[0,1,2,3,4,-1,6,7,-1,-1,-1,-1,-1,-1]})).toThrow(/Choose a column for/);
  expect(()=>extractTds([rows[0],["ZZZPZ0002Z","Invented","1024","10/07/2026","one lakh","2000","2","1"]],mapping)).toThrow(/Amount paid or credited in row 2/);
});
