import {expect,it} from "vitest";
import {checkStatement,extractTds,readStatement,statementFile,type Deductor,type Payment,type TdsForm} from "@/src/lib/tds";

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
  // Row 2's tax, deducted 10 July, was due by 7 August and paid 6 September: 2 months at 1.5%.
  expect(checked.warnings.map(issue=>issue.text)).toEqual([expect.stringContaining("Row 4: no PAN"),expect.stringMatching(/^Challan 123: .*₹60\.00 \(section 398\(3\)\(a\)\(ii\)\)/)]);
  expect(checked.challans.map(c=>c.estimate)).toEqual([BigInt(6000),BigInt(0),undefined]);
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

// Forms No. 138, 144 and 143, each written for the invented deductor above from its own format:
// every field of every record is compared by position (a record given as its filled fields).
const record=(count:number,values:Record<number,string>)=>Array.from({length:count},(_,at)=>values[at+1] ?? "");
const head=(fileType:string)=>record(18,{1:"1",2:"FH",3:fileType,4:"R",5:"20102026",6:"1",7:"D",8:tan,9:"1",10:"InboxCA"});
const batch=(form:string,challans:string,total:string)=>record(72,{1:"2",2:"BH",3:"1",4:challans,5:form,13:tan,15:pan,16:"202728",17:"202627",18:"Q2",19:"Invented Traders",20:"India",21:"12 Invented Lane",23:"Test Road",25:"Invented District",26:"24",27:"380001",28:"tds@invented.test",29:"91",30:"9000000001",32:"F",
  33:"Invented Partner",34:"Partner",35:"12 Invented Lane",40:"24",41:"380001",43:"India",44:"91",45:"9000000002",47:total,52:"N",59:"ZZZPZ0009Z"});
const challan=(line:string,at:string,rows:string,values:Record<number,string>)=>record(30,{1:line,2:"CD",3:"1",4:at,5:rows,6:"N",9:"0.00",10:"0.00",11:"0.00",13:"C",24:"0.00",25:"0.00",...values});
const nilChallan=(line:string,at:string,rows:string)=>record(30,{1:line,2:"CD",3:"1",4:at,5:rows,6:"Y",8:"0.00",9:"0.00",10:"0.00",11:"0.00",12:"0.00",19:"30092026",21:"0.00",22:"0.00",24:"0.00",25:"0.00"});
const deductee=(line:string,n:string,at:string,values:Record<number,string>)=>record(45,{1:line,2:"DD",3:"1",4:n,5:at,6:"O",18:"Y",...values});
const statementOf=(form:TdsForm,rows:{id:string;field:string;value:string}[],period="2026-09")=>({form,tan,pan,deductor,period,today:"2026-10-20",...readStatement([{id:draft,lines:[...rows,{id:"s1",field:"tds.s.previous",value:"N"}]}])});
const written=(statement:ReturnType<typeof statementOf>)=>{
  const checked=checkStatement(statement);
  expect(checked.errors).toEqual([]);
  const file=statementFile({...statement,challans:checked.challans});
  expect(/^[\x20-\x7e\r\n]+$/.test(file) && file.endsWith("\r\n")).toBe(true);
  return {records:file.slice(0,-2).split("\r\n").map(line=>line.split("^")),warnings:checked.warnings.map(issue=>issue.text)};
};
const errorsOf=(statement:Parameters<typeof checkStatement>[0])=>checkStatement(statement).errors.map(issue=>issue.text).join("\n");
const edited=(statement:ReturnType<typeof statementOf>,row:number,values:Partial<Payment>,more:Record<string,string>={})=>({...statement,payments:statement.payments.map(pay=>pay.row!==row ? pay : {...pay,...values,more:{...pay.more,...more}})});

const salaries=()=>statementOf("TDS138",[
  lines("p",2,{pan:"ZZZPZ0002Z",name:"Invented Employee",section:"1002",paid_on:"2026-07-31",amount:"80000",tds:"5000",challan:"11"}),
  lines("p",3,{pan:"",name:"Invented Trainee",section:"1002",paid_on:"2026-08-31",amount:"30000",tds:"6000",challan:"11",remark:"C"}),
  lines("p",4,{pan:"ZZZPZ0004Z",name:"Invented Senior",section:"1032",paid_on:"2026-09-30",amount:"40000",tds:"0",remark:"A",certificate:"ZZZCERT001"}),
  lines("c",1,{bsr:"510308",date:"2026-09-07",number:"11",tax:"11000",minor:"200"}),
].flat());
it("writes Form No. 138 (salary, Q1 to Q3) field by field from its own format",()=>{
  const {records,warnings}=written(salaries());
  expect(records).toEqual([head("SL1"),batch("138","2","11000.00"),
    challan("3","1","2",{8:"11000.00",12:"11000.00",15:"0510308",17:"00011",19:"07092026",21:"11000.00",22:"11000.00",23:"200"}),
    // Row 181: the date of deposit is the challan's; Form No. 138 has no rate (row 180).
    deductee("4","1","1",{8:"ZZZPZ0002Z",9:"Invented Employee",15:"1002",19:"31072026",20:"80000.00",24:"5000.00",25:"5000.00",27:"31072026",29:"07092026"}),
    deductee("5","2","1",{8:"PANNOTAVBL",9:"Invented Trainee",15:"1002",19:"31082026",20:"30000.00",24:"6000.00",25:"6000.00",27:"31082026",29:"07092026",32:"C"}),
    nilChallan("6","2","1"),
    deductee("7","1","2",{8:"ZZZPZ0004Z",9:"Invented Senior",15:"1032",19:"30092026",20:"40000.00",24:"0.00",25:"0.00",32:"A",33:"ZZZCERT001"})]);
  // Row 2's ₹5,000 deducted 31 July, paid 7 September: 2 months at 1.5%.
  expect(warnings).toEqual([expect.stringContaining("Row 3: no PAN"),expect.stringMatching(/^Challan 11: .*₹150\.00/)]);
});
it("checks Form No. 138 by its own rules, and waits for Protean's Q4 format",()=>{
  const s=salaries();
  expect(errorsOf({...s,period:"2027-03"})).toMatch(/waits for Protean's file format for the fourth quarter/);
  expect(errorsOf(edited(s,2,{deposited:BigInt(400000)}))).toMatch(/Row 2: the tax deposited must equal the tax deducted/);
  expect(errorsOf(edited(s,2,{remark:"C"}))).toMatch(/Row 2: reason code C is only for an employee with no valid PAN/);
  expect(errorsOf(edited(s,3,{tds:BigInt(500000),deposited:BigInt(500000)}))).toMatch(/Row 3: reason code C is only[\s\S]*at least 20%/);
  expect(errorsOf(edited(s,4,{pan:""}))).toMatch(/Row 4: reason code A needs the employee's PAN/);
  expect(errorsOf(edited(s,2,{section:"1027"}))).toMatch(/official four digit codes of Form No. 138/);
  expect(errorsOf(edited(s,4,{remark:""}))).toMatch(/Row 4: no tax was deducted and no challan is given. Give the reason code for no deduction, such as A/);
  expect(errorsOf(edited(s,4,{remark:"Y"}))).toMatch(/reason code Y does not go with section code 1032/);
});

const abroad=()=>statementOf("TDS144",[
  lines("p",2,{pan:"ZZZPZ0002Z",name:"Invented Overseas Ltd",section:"1057",paid_on:"2026-07-15",amount:"100000",tds:"10000",status:"1",country:"265",rate:"10",dtaa:"B",remittance:"49",challan:"7",form121:"INVENTEDFORMNUMBERABCDEFGH"}),
  lines("p",3,{pan:"",name:"Invented Investor",section:"1048",paid_on:"2026-08-10",amount:"50000",tds:"5000",status:"2",country:"267",rate:"10",dtaa:"b",remittance:"27",challan:"7",remark:"C",address:"1 Invented Street London",email:"investor@invented.test",phone:"+44 1234 567890",tin:"INV12345"}),
  lines("p",4,{pan:"ZZZPZ0004Z",name:"Invented Winner",section:"1059",paid_on:"2026-09-20",amount:"20000",tds:"0",rate:"0",status:"2",country:"265",dtaa:"A",remark:"Y",grossed:"n",opted_out:"Y"}),
  lines("c",1,{bsr:"510308",date:"2026-09-05",number:"7",tax:"15000",minor:"200"}),
].flat());
it("writes Form No. 144 (payments to non residents) field by field from its own format",()=>{
  const {records,warnings}=written(abroad());
  expect(records).toEqual([head("NS1"),batch("144","2","15000.00"),
    challan("3","1","2",{8:"15000.00",12:"15000.00",15:"0510308",17:"00007",19:"05092026",21:"15000.00",22:"15000.00",23:"200"}),
    // Rows 165 to 194: status, opting out (empty is N), remittance, country, grossing up, rate, DTAA, Form No. 121 and the details abroad.
    deductee("4","1","1",{8:"ZZZPZ0002Z",9:"Invented Overseas Ltd",12:"1",14:"N",15:"1057",16:"49",17:"265",19:"15072026",20:"100000.00",21:"N",24:"10000.00",25:"10000.00",27:"15072026",28:"10.0000",30:"B",31:"INVENTEDFORMNUMBERABCDEFGH"}),
    deductee("5","2","1",{8:"PANNOTAVBL",9:"Invented Investor",12:"2",14:"N",15:"1048",16:"27",17:"267",19:"10082026",20:"50000.00",21:"N",24:"5000.00",25:"5000.00",27:"10082026",28:"10.0000",30:"B",32:"C",37:"1 Invented Street London",38:"investor@invented.test",39:"441234567890",41:"INV12345"}),
    nilChallan("6","2","1"),
    deductee("7","1","2",{8:"ZZZPZ0004Z",9:"Invented Winner",12:"2",14:"Y",15:"1059",17:"265",19:"20092026",20:"20000.00",21:"N",24:"0.00",25:"0.00",28:"0.0000",30:"A",32:"Y"})]);
  // Row 2's ₹10,000 deducted 15 July, paid 5 September: 2 months at 1.5%.
  expect(warnings).toEqual([expect.stringContaining("Row 3: no PAN"),expect.stringMatching(/^Challan 7: .*₹300\.00/)]);
});
it("checks Form No. 144 by its own rules: status, country, remittance, DTAA and the details of a deductee with no PAN",()=>{
  const s=abroad();
  expect(errorsOf(edited(s,2,{},{remittance:""}))).toMatch(/Row 2: code 1057 needs the nature of remittance code, one of 27, 73, 16/);
  expect(errorsOf(edited(s,2,{},{remittance:"71"}))).toMatch(/code 1057 needs the nature of remittance code/);
  expect(errorsOf(edited(s,2,{section:"1004"}))).toMatch(/code 1004 takes no nature of remittance code/);
  expect(errorsOf(edited(s,2,{},{country:"99"}))).toMatch(/Row 2: the country code must be one of the official codes/);
  expect(errorsOf(edited(s,2,{},{status:"11"}))).toMatch(/Row 2: the status code must be 1 to 10/);
  expect(errorsOf(edited(s,2,{},{dtaa:""}))).toMatch(/under the Act \(A\) or a DTAA \(B\)/);
  expect(errorsOf(edited(s,2,{},{grossed:"Yes"}))).toMatch(/grossed up and opted out of section 202\(1\) are Y or N/);
  expect(errorsOf(edited(s,3,{},{tin:""}))).toMatch(/Row 3: with no PAN, a rate below 20%, reason C and this nature of remittance, the format needs/);
  const other=checkStatement(edited(edited(s,3,{},{tin:""}),3,{remark:""}));
  expect(other.errors).toEqual([]);expect(other.warnings.map(issue=>issue.text)).toContainEqual(expect.stringMatching(/Row 3: no PAN. Give the deductee's address abroad/));
  expect(errorsOf(edited(s,4,{pan:"PANNOTAVBL"}))).toMatch(/code 1059 needs the deductee's real PAN/);
  expect(errorsOf(edited(s,4,{remark:"C"}))).toMatch(/reason code C does not go with section code 1059/);
  expect(errorsOf(edited(s,2,{section:"1027"}))).toMatch(/official four digit codes of Form No. 144/);
});

const collections=()=>statementOf("TDS143",[
  lines("p",2,{pan:"ZZZPZ0002Z",name:"Invented Scrap Buyer",section:"1073",paid_on:"2026-07-20",amount:"200000",tds:"2000",status:"7",rate:"1",challan:"21"}),
  lines("p",3,{pan:"ZZZPZ0003Z",name:"Invented Traveller",section:"1089",paid_on:"2026-08-12",amount:"900000",tds:"0",rate:"0",status:"2",remark:"F",f_tds:"Y",f_challan:"456",f_paid_on:"2026-08-12",non_resident:"y",establishment:"N"}),
  lines("c",1,{bsr:"510308",date:"2026-08-07",number:"21",tax:"2000",minor:"200"}),
].flat());
it("writes Form No. 143 (TCS) field by field from its own format",()=>{
  const {records,warnings}=written(collections());
  expect(records).toEqual([head("TC1"),batch("143","2","2000.00"),
    challan("3","1","1",{8:"2000.00",12:"2000.00",15:"0510308",17:"00021",19:"07082026",21:"2000.00",22:"2000.00",23:"200"}),
    // Rows 164 to 189: non resident (empty is N), collectee code, permanent establishment, opting out, rate, and the TDS answers of reason F.
    deductee("4","1","1",{8:"ZZZPZ0002Z",9:"Invented Scrap Buyer",11:"N",12:"7",14:"N",15:"1073",19:"20072026",20:"200000.00",24:"2000.00",25:"2000.00",27:"20072026",28:"1.0000"}),
    nilChallan("5","2","1"),
    deductee("6","1","2",{8:"ZZZPZ0003Z",9:"Invented Traveller",11:"Y",12:"2",13:"N",14:"N",15:"1089",19:"12082026",20:"900000.00",24:"0.00",25:"0.00",28:"0.0000",32:"F",34:"Y",35:"456",36:"12082026"})]);
  expect(warnings).toEqual([]);
});
it("checks Form No. 143 by its own rules, in a collector's words",()=>{
  const s=collections();
  expect(errorsOf({...s,deductor:{...deductor,type:""}})).toMatch(/Choose the type of collector/);
  expect(errorsOf(edited(s,2,{deposited:BigInt(100000)}))).toMatch(/Row 2: the tax deposited must equal the tax collected/);
  expect(errorsOf(edited(s,2,{},{status:""}))).toMatch(/Row 2: the collectee code must be 1 to 10/);
  expect(errorsOf(edited(s,2,{},{establishment:"Y"}))).toMatch(/permanent establishment answer is only for a non resident collectee/);
  expect(errorsOf(edited(s,3,{},{establishment:""}))).toMatch(/Row 3: say whether this non resident collectee has a permanent establishment/);
  expect(errorsOf(edited(s,2,{},{f_tds:"N"}))).toMatch(/only for reason code F with codes 1086 to 1089/);
  expect(errorsOf(edited(s,3,{},{f_challan:""}))).toMatch(/Row 3: with Y, give the TDS challan number/);
  expect(errorsOf(edited(s,3,{remark:"Y"}))).toMatch(/reason code Y does not go with section code 1089/);
  expect(errorsOf(edited(s,2,{section:"1024"}))).toMatch(/official four digit codes of Form No. 143/);
  expect(errorsOf(edited(s,3,{remark:""}))).toMatch(/no tax was collected and no challan is given. Give the reason code for no collection/);
});

// Where CAs lose time: tax with no challan, or a challan that does not cover its rows, is flagged.
it("flags tax no challan covers, for every form",()=>{
  for(const s of [salaries(),abroad(),collections()]) {
    expect(errorsOf(edited(s,2,{challan:""}))).toMatch(/Row 2: tax was (deducted|collected), so give the serial number of the challan it was paid with. Until then no challan covers it/);
    expect(errorsOf(edited(s,2,{challan:"999"}))).toMatch(/Row 2: no challan with serial number 999 is in this statement, so no challan covers this tax/);
    expect(errorsOf({...s,challans:s.challans.map(c=>({...c,tax:BigInt(100000)}))})).toMatch(/Challan \d+: does not cover its rows. They show ₹[\d,.]+ of tax deposited, more than its tax of ₹1,000.00, short by ₹/);
  }
});

it("reads a non resident register only with its status and country columns chosen",()=>{
  const rows=[["PAN","Name","Code","Paid","Amount","TDS","Status","Country"],["ZZZPZ0002Z","Invented Overseas Ltd","1057.0","15/07/2026","100000","10000","1.0","265"]];
  const mapping={kind:"nonresident" as const,header:0,headings:rows[0],columns:[0,1,2,3,4,5,6,7,...Array(16).fill(-1)]};
  expect(extractTds(rows,mapping).map(line=>[line.field,line.value])).toEqual([["tds.p2.pan","ZZZPZ0002Z"],["tds.p2.name","Invented Overseas Ltd"],["tds.p2.section","1057"],["tds.p2.paid_on","2026-07-15"],["tds.p2.amount","100000"],["tds.p2.tds","10000"],["tds.p2.status","1"],["tds.p2.country","265"]]);
  expect(()=>extractTds(rows,{...mapping,columns:[0,1,2,3,4,5,6,-1,...Array(16).fill(-1)]})).toThrow(/Choose a column for .*Country code/);
});

// Health checks before approval, each figure worked by hand from the Act's own rates and dates
// (sources beside each rule in src/lib/tds.ts). They warn; no figure is changed.
const warned=(statement:Parameters<typeof checkStatement>[0])=>{const checked=checkStatement(statement);expect(checked.errors).toEqual([]);return checked.warnings.map(issue=>issue.text).join("\n");};
const tdsOf=(rupees:number)=>({tds:BigInt(rupees*100),deposited:BigInt(rupees*100)});
it("warns when tax with no valid PAN is below the higher rate of section 397(2)(b)",()=>{
  const s=base(),changed=(row:number,values:Partial<Payment>)=>edited(s as ReturnType<typeof statementOf>,row,values);
  // Row 4: ₹30,000 of rent with no PAN needs at least 20%, ₹6,000; ₹3,000 is short by ₹3,000.
  expect(warned(changed(4,{...tdsOf(3000),rate:"10"}))).toMatch(/Row 4: .*397\(2\)\(b\).*₹6,000\.00 on ₹30,000\.00.*short by ₹3,000\.00/);
  expect(warned(changed(4,{pan:"PANINVALID",...tdsOf(3000),rate:"10"}))).toMatch(/Row 4: .*short by ₹3,000\.00/);
  expect(warned(s)).not.toMatch(/short by/);
  // Code 1035 (section 393(1) Table Sl. No. 8(v)) takes 5% with no PAN: ₹1,00,000 needs ₹5,000.
  expect(warned(changed(4,{section:"1035",amount:BigInt(10000000),...tdsOf(1000),rate:"1",remark:""}))).toMatch(/Row 4: .*at least 5%, ₹5,000\.00.*short by ₹4,000\.00/);
  // Tax collected with no PAN: at least 5%. ₹2,00,000 of scrap needs ₹10,000.
  const c=collections();
  expect(warned(edited({...c,challans:c.challans.map(one=>({...one,tax:BigInt(200000)}))},2,{pan:""}))).toMatch(/Row 2: .*at least 5%, ₹10,000\.00.*short by ₹8,000\.00/);
  // Salary and non residents take conditions InboxCA cannot see: no rate warning.
  expect(warned(edited(salaries(),3,{...tdsOf(1000),remark:""}))).not.toMatch(/short by/);
});
it("warns when tax deducted is below the section 393(1) rate of its code",()=>{
  const s=base(),changed=(row:number,values:Partial<Payment>)=>edited(s as ReturnType<typeof statementOf>,row,values);
  // Code 1024 (Sl. No. 6(i), 2%): ₹1,00,000 needs ₹2,000.
  expect(warned(changed(2,{...tdsOf(1000),rate:"1"}))).toMatch(/Row 2: .*₹2,000\.00, the 2% section 393\(1\) Table Sl\. No\. 6\(i\)\.D\(b\).*short by ₹1,000\.00/);
  // Code 1023 (Sl. No. 6(i), 1% for an individual or HUF): ₹1,000 is right.
  expect(warned(changed(2,{section:"1023",...tdsOf(1000),rate:"1"}))).not.toMatch(/short by/);
  // Code 1027 (Sl. No. 6(iii)(b), 10%): ₹50,000 needs ₹5,000; code 1026 (6(iii)(a)) takes 2%.
  expect(warned(changed(3,{...tdsOf(1000),rate:"2"}))).toMatch(/Row 3: .*₹5,000\.00, the 10%.*short by ₹4,000\.00/);
  expect(warned(changed(3,{section:"1026",...tdsOf(1000),rate:"2"}))).not.toMatch(/short by/);
  // Within a rupee, or with a reason code for lower deduction, is not flagged.
  expect(warned(changed(2,{tds:BigInt(199950),deposited:BigInt(199950)}))).not.toMatch(/short by/);
  expect(warned(changed(2,{...tdsOf(1000),rate:"1",remark:"A",certificate:"ZZZCERT001"}))).not.toMatch(/short by/);
});
it("warns of a challan no row uses",()=>{
  const s=base(),spare={...s.challans[0],row:3,number:"77",line:"spare",payments:[]};
  expect(checkStatement({...s,challans:[...s.challans,spare]}).warnings).toContainEqual({text:expect.stringMatching(/^Challan 77: /),line:"spare"});
});
it("estimates interest under section 398(3)(a)(ii) and the fee under section 427, by the Rules' dates",()=>{
  const s=base(),dated=(date:string)=>({...s,challans:s.challans.map(c=>c.row===1 ? {...c,date} : c)});
  // Row 2: ₹2,000 deducted 10 July, due by 7 August; row 3: ₹5,000 deducted 4 August, due by
  // 7 September. Paid 7 September: row 2 only, 2 months at 1.5%, ₹60. Paid 10 September: ₹60
  // and row 3's 2 months, ₹150. Paid 11 September: row 2 is 3 months, ₹90, with ₹150.
  expect(checkStatement(dated("2026-09-07")).challans[0].estimate).toBe(BigInt(6000));
  expect(checkStatement(dated("2026-09-10")).challans[0].estimate).toBe(BigInt(21000));
  expect(checkStatement(dated("2026-09-11")).challans[0].estimate).toBe(BigInt(24000));
  // Paid by 7 August: no interest.
  expect(checkStatement(dated("2026-08-07")).challans[0].estimate).toBe(BigInt(0));
  // An office of the Government pays by Rule 218(1): no estimate.
  expect(checkStatement({...s,deductor:{...deductor,type:"A",ministry:"11"},pan:"PANNOTREQD"}).challans[0].estimate).toBeUndefined();
  // March tax is due by 30 April (Rule 218(2)(a)); the statement by 31 May (Rule 219(4)).
  const march=(date:string,today:string)=>checkStatement({...readStatement([{id:draft,lines:[...lines("p",2,{pan:"ZZZPZ0002Z",name:"Invented Contractor",section:"1024",paid_on:"2027-03-15",amount:"100000",tds:"2000",rate:"2",challan:"5"}),
    ...lines("c",1,{bsr:"510308",date,number:"5",tax:"2000",minor:"200"}),{id:"s1",field:"tds.s.previous",value:"N"}]}]),tan,pan,deductor,period:"2027-03",today});
  expect(march("2027-04-30","2027-05-31").challans[0].estimate).toBe(BigInt(0));
  expect(march("2027-05-01","2027-05-31").challans[0].estimate).toBe(BigInt(6000));
  expect(march("2027-04-30","2027-05-31").warnings.map(issue=>issue.text).join("\n")).not.toMatch(/section 427/);
  // Two days late: ₹200 a day is ₹400.
  expect(march("2027-04-30","2027-06-02").warnings.map(issue=>issue.text).join("\n")).toMatch(/₹400\.00 \(section 427\)/);
  // The Q2 statement was due 31 October: 5 days to 5 November is ₹1,000; by 1 February 2027,
  // 93 days, the fee stops at the ₹13,000 of tax deducted.
  expect(warned({...s,today:"2026-11-05"})).toMatch(/₹1,000\.00 \(section 427\)/);
  expect(warned({...s,today:"2027-02-01"})).toMatch(/₹13,000\.00 \(section 427\)/);
});
