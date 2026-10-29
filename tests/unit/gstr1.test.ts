import {readFileSync} from "node:fs";
import {createHash,randomBytes} from "node:crypto";
import {expect,it,vi} from "vitest";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "@/src/lib/templates";
import {gstr1Json,gstr1Workbook,portalFiles} from "../../worker/gstr1";
import {officialSchema} from "../../worker/schema";
import {unpack,zipEntries,zipFiles} from "../../worker/zip";
import {xlsxEntries} from "@/src/lib/sheet";
import {b2bRow,hsnRow,inventedGstin,salesRow as rows} from "@/src/lib/form-samples";

// Each fill rewrites the 7 MB official workbook: its 60 MB of sheets are compressed again
// (worker/workbook.ts), about 0.6 s a call on an idle laptop and several times that when
// other runs load the machine. A test makes up to 20 calls.
const slow=120_000;
// Columns and choices: the blank official workbooks. JSON checks: the pinned GSTN schemas.
const templates=catalog.filter(row=>row.form_code==="GSTR1").map(row=>templateSchema.parse(row));
// The same invented rows the daily check fills a new version with (src/lib/form-samples.ts).
const b2b=()=>b2bRow("2026-09");

it("fills current and older official workbooks without changing their headings, choices or other parts",()=>{
  for(const template of templates) {
    const period=template.version==="2.0" ? "2024-09" : "2026-09",draft=b2bRow(period);
    const output=gstr1Workbook(template,period,inventedGstin(),[draft]),files=xlsxEntries(output);
    const sheet=files.get("xl/worksheets/sheet2.xml")!().toString();
    expect(sheet).toContain('r="C5"');expect(sheet).toContain('>INV/1<');expect(sheet).toContain('<v>100</v>');
    const original=xlsxEntries(readFileSync(`reference/official/${template.source.file}`));
    for(const [name,read] of original) if(name!=="xl/worksheets/sheet2.xml" && name!=="xl/workbook.xml") expect(files.get(name)!().equals(read())).toBe(true);
    expect(sheet).not.toMatch(/<f>[^<]*<\/f><v>/);
    expect(createHash("sha256").update(readFileSync(`reference/official/${template.source.file}`)).digest("hex")).toBe(template.source.sha256);
    const hsn=hsnRow(template.version==="2.0" ? "hsn" : "hsn_b2b");
    expect(gstr1Workbook(template,period,inventedGstin(),[hsn]).length).toBeGreaterThan(1000);
  }
},slow);
it("checks B2CS and notes against official keys, required fields and code lists",()=>{
  const template=templates[1];
  const small=rows("b2cs",["OE","24-Gujarat","65","18","100","0",""]);
  const note=rows("cdnr",[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","CN/1","2026-09-10","C","24-Gujarat","N","Regular B2B","118","","18","100","0"]);
  expect(gstr1Workbook(template,"2026-09",inventedGstin(),[small,note]).length).toBeGreaterThan(1000);
  const decimalRate=b2b();decimalRate.get("b2b.r2.c10")!.value="18.00";
  expect(gstr1Workbook(template,"2026-09",inventedGstin(),[decimalRate]).length).toBeGreaterThan(1000);
  for(const [field,value] of [["b2b.r2.c0",inventedGstin()],["b2b.r2.c2","bad invoice!"],["b2b.r2.c3","2026-10-01"],["b2b.r2.c5","99-Unknown"],["b2b.r2.c10","19"],["b2b.r2.c11","1.001"]]) {
    const draft=b2b();draft.get(field)!.value=value;
    expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[draft])).toThrow();
  }
  const missing=b2b();missing.delete("b2b.r2.c11");
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[missing])).toThrow("required");
  const conflicting=b2b();conflicting.get("b2b.r2.c4")!.value="119";
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[b2b(),conflicting])).toThrow("disagree");
  expect(()=>gstr1Workbook(templates[0],"2026-09",inventedGstin(),[b2b()])).toThrow("not ready");
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[rows("hsn",["1001","Invented goods","NOS-NUMBERS","1","118","18","100"])] )).toThrow("month");
  expect(()=>gstr1Workbook({...template,source:{...template.source,sha256:"0".repeat(64)}},"2026-09",inventedGstin(),[b2b()])).toThrow("changed"); // ggignore: deliberately wrong file hash.
  expect(()=>gstr1Workbook({...template,mappings:{...template.mappings,sheets:{b2b:6}}},"2026-09",inventedGstin(),[b2b()])).toThrow("headings");
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[rows("hsn_b2b",["1001","Invented goods","NOS-NUMBERS","1.125","118","18","100"])] )).toThrow();
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[rows("b2cs",["E","24-Gujarat","","18","100"])] )).toThrow("operator");
  const badCheck=b2b(),taxNumber=badCheck.get("b2b.r2.c0")!.value;
  badCheck.get("b2b.r2.c0")!.value=taxNumber.slice(0,-1)+(taxNumber.endsWith("0") ? "1" : "0");
  expect(()=>gstr1Workbook(template,"2026-09",inventedGstin(),[badCheck])).toThrow("last character");
},slow);

it("reads an edited official workbook into fresh source cells and rejects changed headings and unsupported work",async()=>{
  const {editedForm}=await import("../../worker/edited-form"),{writeWorkbook}=await import("../../worker/workbook");
  const template=templates[1],context={template,period:"2026-09",gstin:inventedGstin()},bytes=gstr1Workbook(template,context.period,context.gstin,[b2b()]);
  const read=editedForm(bytes,context);
  expect(read.lines.find(line=>line.field==="b2b.r5.c11")).toMatchObject({value:"100",cell:"L5",sheet:2,page:1,kind:"number"});
  expect(read.lines.find(line=>line.field==="b2b.r5.c3")?.value).toBe("2026-09-10");
  for(const [path,ref,value] of [["xl/worksheets/sheet2.xml","L4","Changed heading"],["xl/worksheets/sheet3.xml","A5","Unsupported export"],["xl/worksheets/sheet2.xml","L5","wrong amount"]]) {
    const changed=writeWorkbook(bytes,new Map([[path,new Map([[ref,{value,number:false}]])]]));
    expect(()=>editedForm(changed,context)).toThrow();
  }
},slow);

it("refuses a formula in a data cell even when its cached value is blank",async()=>{
  const {editedForm}=await import("../../worker/edited-form"),sheets=await import("@/src/lib/sheet");
  const template=templates[1],context={template,period:"2026-09",gstin:inventedGstin()},bytes=gstr1Workbook(template,context.period,context.gstin,[b2b()]);
  const original=sheets.xlsxEntries,parts=original(bytes),path="xl/worksheets/sheet2.xml",xml=parts.get(path)!().toString();
  parts.set(path,()=>Buffer.from(xml.replace(/<c\b[^>]*r="L5"[^>]*>[\s\S]*?<\/c>/,'<c r="L5"><f>100+1</f><v></v></c>')));
  const spy=vi.spyOn(sheets,"xlsxEntries").mockImplementation(input=>input===bytes ? parts : original(input));
  try {expect(()=>editedForm(bytes,context)).toThrow("Use values");} finally {spy.mockRestore();}
},slow);

// The supplier is in Gujarat (24); Maharashtra (27) is another State.
it("fills large B2C sales, unregistered notes, exports, advances and documents issued in both workbooks",()=>{
  for(const template of templates) {
    const period=template.version==="2.0" ? "2024-09" : "2026-09",day=`${period}-10`;
    const filled=[
      rows("b2cl",["INV/7",day,"236000","27-Maharashtra","","18","200000","0",""]),
      rows("cdnur",["B2CL","CN/7",day,"C","27-Maharashtra","11800","","18","10000","0"]),
      rows("cdnur",["EXPWP","CN/8",day,"C","","5900","","18","5000",""]),
      rows("exp",["WPAY","EXP/1",day,"118000","INNSA1","1234567",day,"18","100000","0"]),
      rows("at",["27-Maharashtra","","18","50000","0"]),
      rows("atadj",["27-Maharashtra","","18","20000",""]),
      rows("docs",["Invoices for outward supply","INV/1","INV/250","250","3"]),
      rows("exemp",["Intra-State supplies to unregistered persons","1200","0","350.50"]),
    ];
    const files=xlsxEntries(gstr1Workbook(template,period,inventedGstin(),filled));
    for(const [section,text] of [["b2cl","INV/7"],["cdnur","CN/7"],["exp","EXP/1"],["docs","INV/250"]] as const)
      expect(files.get(`xl/worksheets/sheet${template.mappings.sheets![section]}.xml`)!().toString()).toContain(`>${text}<`);
    expect(files.get(`xl/worksheets/sheet${template.mappings.sheets!.at}.xml`)!().toString()).toContain("<v>50000</v>");
    expect(files.get(`xl/worksheets/sheet${template.mappings.sheets!.exemp}.xml`)!().toString()).toContain("<v>350.50</v>");
  }
},slow);

// The portal JSON for Prepare Offline, from the rows that fill the workbook, against each version's pinned GSTN schema.
it("makes the portal JSON with tax, HSN and documents, leaving out invoices that came from e-invoices",()=>{
  for(const template of templates) {
    const v2=template.version==="2.0",period=v2 ? "2024-09" : "2026-09",day=`${period}-10`,gstin=inventedGstin(),buyer=inventedGstin("ZZZPZ0002Z");
    const rate5=b2bRow(period);rate5.get("b2b.r2.c10")!.value="5";rate5.get("b2b.r2.c11")!.value="40";
    const einvoice=rows("b2b",[buyer,"Invented Recipient","INV/2",day,"236","27-Maharashtra","N","","Regular B2B","","18","200","0",randomBytes(32).toString("hex")]);
    const hsn=["1001","Invented goods","NOS-NUMBERS","1.25","118","18","100","0","9","9","0"];
    const drafts=[b2bRow(period),rate5,einvoice,
      rows("b2cl",["INV/7",day,"236000","27-Maharashtra","","18","200000","0",""]),
      rows("b2cs",["OE","24-Gujarat",v2 ? "" : "65","18","100","0",""]),
      rows("cdnr",[buyer,"Invented Recipient","CN/1",day,"C","24-Gujarat","N","Regular B2B","118","","18","100","0"]),
      rows("exp",["WPAY","EXP/1",day,"118000","INNSA1","1234567",day,"18","100000","0"]),
      rows("exp",["WOPAY","EXP/2",day,"100000","","","","0","100000",""]),
      ...(v2 ? [rows("hsn",hsn)] : [rows("hsn_b2b",hsn),rows("hsn_b2c",hsn)]),
      rows("docs",["Invoices for outward supply","INV/1","INV/250","250","3"])];
    const [file,...more]=gstr1Json(template,period,gstin,drafts),json=JSON.parse(file.toString());
    expect(more).toHaveLength(0);
    expect(officialSchema(template.mappings.validator!.file,template.mappings.validator!.sha256).validate(json)).toBe(true);
    expect(json).toMatchObject({gstin,fp:`09${period.slice(0,4)}`});
    // One invoice with two rates; tax from rate and taxable value, CGST and SGST halves within the State, IGST across.
    expect(json.b2b).toEqual([{ctin:buyer,inv:[expect.objectContaining({inum:"INV/1",itms:[{num:1,itm_det:{rt:18,txval:100,csamt:0,camt:9,samt:9}},{num:2,itm_det:{rt:5,txval:40,csamt:0,camt:1,samt:1}}]})]}]);
    expect(json.b2cl[0].inv[0].itms[0].itm_det).toMatchObject({txval:200000,iamt:36000});
    expect(json.b2cs[0]).toMatchObject(v2 ? {camt:9,samt:9} : {diff_percent:0.65,camt:5.85,samt:5.85});
    expect(json.cdnr[0].nt[0].itms[0].itm_det).toMatchObject({camt:9,samt:9});
    expect(json.exp.map((entry:{inv:{itms:unknown[]}[]})=>entry.inv[0].itms)).toEqual([[{rt:18,txval:100000,csamt:0,iamt:18000}],[{rt:0,txval:100000}]]);
    expect(Object.keys(json.hsn)).toEqual(v2 ? ["data"] : ["hsn_b2b","hsn_b2c"]);
    expect((v2 ? json.doc_issue.doc_det : json.doc_issue.doc_det_new)[0].docs).toEqual([{num:1,from:"INV/1",to:"INV/250",totnum:250,cancel:3,net_issue:247}]);
    if(v2) continue;
    // The e-invoice stays in the Excel; a value that is not an IRN is refused; table 15 has no published flag.
    expect(xlsxEntries(gstr1Workbook(template,period,gstin,drafts)).get("xl/worksheets/sheet2.xml")!().toString()).toContain(">INV/2<");
    einvoice.get("b2b.r2.c13")!.value="NA";
    expect(()=>gstr1Json(template,period,gstin,drafts)).toThrow("IRN");
    expect(()=>gstr1Json(template,period,gstin,[rows("ecob2b",[inventedGstin("ZZZPZ0004Z"),"Invented Supplier",buyer,"Invented Recipient","DOC/1",day,"118","24-Gujarat","Regular","18","100","0"])])).toThrow("table 15");
  }
},slow);

it("splits a large month into portal files of at most 5 MB with whole invoices, each with the GSTIN and month",()=>{
  const template=templates[1],{validate}=officialSchema(template.mappings.validator!.file,template.mappings.validator!.sha256),gstin=inventedGstin(),buyer=inventedGstin("ZZZPZ0002Z");
  const inv=Array.from({length:40000},(_,n)=>({inum:`INV/${n+1}`,idt:"10-09-2026",val:118,pos:"24",rchrg:"N",inv_typ:"R",itms:[{num:1,itm_det:{rt:18,txval:100,camt:9,samt:9}}]}));
  const files=portalFiles({gstin,fp:"092026",b2b:[{ctin:buyer,inv}],doc_issue:{doc_det_new:[{doc_num:"1",doc_typ:"Invoices for outward supply",docs:[{num:1,from:"INV/1",to:"INV/40000",totnum:40000,cancel:0,net_issue:40000}]}]}});
  expect(files.length).toBeGreaterThan(1);
  for(const file of files) {expect(Buffer.byteLength(JSON.stringify(file))).toBeLessThanOrEqual(5_000_000);expect(validate(file)).toBe(true);expect(file).toMatchObject({gstin,fp:"092026"});}
  expect(files.flatMap((file)=>((file.b2b ?? []) as {inv:{inum:string}[]}[]).flatMap((entry)=>entry.inv.map((item)=>item.inum)))).toEqual(inv.map((item)=>item.inum));
  expect(files.filter((file)=>file.doc_issue)).toHaveLength(1);
  // Several files come as one ZIP that reads back unchanged.
  const zip=zipFiles(files.map((file,n)=>[`${n+1}.json`,Buffer.from(JSON.stringify(file))]));
  expect(zipEntries(zip).map((entry)=>JSON.parse(unpack(entry).toString()))).toEqual(files);
},slow);

it("refuses rows the official rules put elsewhere or leave out",()=>{
  const template=templates[1],day="2026-09-10",gstin=inventedGstin();
  const refused:[string,string[],string][]=[
    ["b2cl",["INV/7",day,"236000","24-Gujarat","","18","200000","0",""],"inter-State"],
    ["b2cl",["INV/7",day,"90000","27-Maharashtra","","18","76271","0",""],"B2CS"],
    ["cdnur",["EXPWP","CN/8",day,"C","27-Maharashtra","5900","","18","5000",""],"empty"],
    ["cdnur",["B2CL","CN/7",day,"C","","11800","","18","10000",""],"place of supply"],
    ["exp",["WITH PAY","EXP/1",day,"118000","","","","18","100000",""],"official choices"],
    ["docs",["Invoices",  "INV/1","INV/250","250","3"],"official choices"],
    ["docs",["Invoices for outward supply","INV/1","INV/250","2.5","0"],"whole number"],
    ["docs",["Invoices for outward supply","INV/1","INV/250","2","3"],"cancelled"],
    ["exemp",["Supplies to registered persons","1","0","0"],"official choices"],
    ["exemp",["Inter-State supplies to registered persons","1","0",""],"required"],
  ];
  for(const [section,values,message] of refused) expect(()=>gstr1Workbook(template,"2026-09",gstin,[rows(section,values)])).toThrow(message);
  // Before August 2024 the large B2C limit was Rs 2.5 lakh.
  expect(()=>gstr1Workbook(templates[0],"2024-07",gstin,[rows("b2cl",["INV/7","2024-07-10","200000","27-Maharashtra","","18","169491","0",""])])).toThrow("B2CS");
  // A shipping bill dated after the month is allowed; the invoice is not.
  expect(gstr1Workbook(template,"2026-09",gstin,[rows("exp",["WOPAY","EXP/2",day,"100000","","","2026-10-02","0","100000",""])]).length).toBeGreaterThan(1000);
  expect(()=>gstr1Workbook(template,"2026-09",gstin,[rows("exp",["WOPAY","EXP/2","2026-10-02","100000","","","","0","100000",""])])).toThrow("after");
},slow);

// Amendments of earlier months and supplies through e-commerce operators (tables 14, 14A, 15, 15A).
it("fills the amendment sheets of both workbooks and the e-commerce sheets of v2.2, each row passing the official schema",async()=>{
  const {editedForm}=await import("../../worker/edited-form");
  for(const template of templates) {
    const v2=template.version==="2.0";
    const period=template.version==="2.0" ? "2024-09" : "2026-09",day=`${period}-10`,before="2024-04-10";
    const [fy,month]=template.version==="2.0" ? ["2024-25","APRIL"] : ["2025-26","MARCH"];
    const buyer=inventedGstin("ZZZPZ0002Z"),operator=inventedGstin("ZZZPZ0003Z"),supplier=inventedGstin("ZZZPZ0004Z");
    const filled:[string,string[],string][]=[
      ["b2ba",[buyer,"Invented Recipient","INV/1",before,"INV/1A",day,"118","24-Gujarat","N","","Regular B2B","","18","100","0"],">INV/1A<"],
      ["b2cla",["INV/7",before,"27-Maharashtra","INV/7A",day,"236000","","18","200000","0",""],">INV/7A<"],
      ["b2csa",[fy,month,"27-Maharashtra","OE","","18","10000","0",""],"<v>10000</v>"],
      ["cdnra",[buyer,"Invented Recipient","CN/1",before,"CN/1A",day,"C","24-Gujarat","N","Regular B2B","118","","18","100","0"],">CN/1A<"],
      ["cdnura",["B2CL","CN/7",before,"CN/7A",day,"C","27-Maharashtra","11800","","18","10000","0"],">CN/7A<"],
      ["expa",["WPAY","EXP/1",before,"EXP/1A",day,"118000","INNSA1","1234567",day,"18","100000","0"],">EXP/1A<"],
      ["ata",[fy,month,"27-Maharashtra","","18","50000","0"],"<v>50000</v>"],
      ["atadja",[fy,month,"27-Maharashtra","","18","20000",""],"<v>20000</v>"],
      ["eco",["Liable to collect tax u/s 52(TCS)",operator,"Invented Operator","10000","0","900","900","0"],">Invented Operator<"],
      ["ecoa",["Liable to pay tax u/s 9(5)",fy,month,operator,operator,"Invented Operator","12000","0","1080","1080",""],"<v>12000</v>"],
      ["ecob2b",[supplier,"Invented Supplier",buyer,"Invented Recipient","DOC/1",day,"118","24-Gujarat","Regular","18","100","0"],">DOC/1<"],
      ["ecourp2b",[buyer,"Invented Recipient","DOC/2",day,"118","27-Maharashtra","Deemed Exp","18","100",""],">DOC/2<"],
      ["ecob2c",[supplier,"Invented Supplier","27-Maharashtra","1000","18",""],">Invented Supplier<"],
      ["ecourp2c",["24-Gujarat","1000","5",""],"<v>1000</v>"],
      ["ecoab2b",[supplier,"Invented Supplier",buyer,"Invented Recipient","DOC/1",before,"DOC/1A",day,"118","24-Gujarat","SEZ supplies with payment","18","100","0"],">DOC/1A<"],
      ["ecoab2c",[fy,month,supplier,"Invented Supplier","27-Maharashtra","18","1000",""],">Invented Supplier<"],
      ["ecoaurp2b",[buyer,"Invented Recipient","DOC/2",before,"DOC/2A",day,"118","Regular","27-Maharashtra","18","100",""],">DOC/2A<"],
      ["ecoaurp2c",[fy,month,"24-Gujarat","5","1000",""],"<v>1000</v>"],
    ];
    // The v2.0 workbook ships GSTN's sample rows in its e-commerce sheets, so those stay out of it.
    const used=filled.filter(([section])=>!v2 || !section.startsWith("eco"));
    if(v2) expect(()=>gstr1Workbook(template,period,inventedGstin(),[rows(...filled[8].slice(0,2) as [string,string[]])])).toThrow("month");
    const bytes=gstr1Workbook(template,period,inventedGstin(),used.map(([section,values])=>rows(section,values))),files=xlsxEntries(bytes);
    for(const [section,,text] of used) expect(files.get(`xl/worksheets/sheet${template.mappings.sheets![section]}.xml`)!().toString()).toContain(text);
    // The filled workbook reads back, as an edited one does, into the same rows.
    expect(editedForm(bytes,{template,period,gstin:inventedGstin()}).lines.find(line=>line.field===(v2 ? "b2ba.r5.c4" : "ecoab2b.r5.c6"))?.value).toBe(v2 ? "INV/1A" : "DOC/1A");
  }
},slow);

it("refuses amendments of this month, choices outside the workbook's lists and an operator from another State",()=>{
  const template=templates[1],day="2026-09-10",gstin=inventedGstin(),buyer=inventedGstin("ZZZPZ0002Z");
  const refused:[string,string[],string][]=[
    ["b2csa",["2026-27","APRIL","27-Maharashtra","OE","","18","10000","",""],"official choices"],
    ["b2csa",["2025-26","Sept","27-Maharashtra","OE","","18","10000","",""],"official choices"],
    ["ata",["2025-26","","27-Maharashtra","","18","50000",""],"required"],
    ["b2ba",[buyer,"Invented Recipient","","2024-04-10","INV/1A",day,"118","24-Gujarat","N","","Regular B2B","","18","100",""],"required"],
    ["b2cla",["INV/7","2024-04-10","24-Gujarat","INV/7A",day,"236000","","18","200000","",""],"inter-State"],
    ["eco",["Liable to collect tax",inventedGstin("ZZZPZ0003Z"),"","10000","0","900","900",""],"official choices"],
    ["eco",["Liable to pay tax u/s 9(5)","27ZZZPZ0003Z1C5","","10000","0","900","900",""],"State"],
    ["ecourp2b",[buyer,"","DOC/2",day,"118","27-Maharashtra","Regular B2B","18","100",""],"official choices"],
    // The GSTN schema wants a shipping bill number of 3 to 7 digits.
    ["expa",["WPAY","EXP/1","2024-04-10","EXP/1A",day,"118000","","12","","18","100000",""],"official form's checks"],
  ];
  for(const [section,values,message] of refused) expect(()=>gstr1Workbook(template,"2026-09",gstin,[rows(section,values)])).toThrow(message);
  // An amendment must be of an earlier month: 2025-26 SEPTEMBER is September 2025.
  expect(()=>gstr1Workbook(template,"2025-09",gstin,[rows("b2csa",["2025-26","SEPTEMBER","27-Maharashtra","OE","","18","10000","",""])])).toThrow("earlier month");
  expect(gstr1Workbook(template,"2026-09",gstin,[rows("b2csa",["2025-26","SEPTEMBER","27-Maharashtra","OE","","18","10000","",""])]).length).toBeGreaterThan(1000);
},slow);
