import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "@/src/lib/templates";
import {gstr1Workbook} from "../../worker/gstr1";
import {xlsxEntries} from "@/src/lib/sheet";
import type {Figure} from "@/src/lib/datasets";
import {inventedGstin} from "../fixtures/portal";

// Columns and choices: the blank official workbooks. JSON checks: the pinned GSTN schemas.
const templates=catalog.filter(row=>row.form_code==="GSTR1").map(row=>templateSchema.parse(row));
const rows=(section:string,values:string[]):Map<string,Figure>=>new Map(values.flatMap((value,column)=>value==="" ? [] : [[`${section}.r2.c${column}`,{label:"Invented register field",value,kind:"text"} as Figure] as const]));
const b2b=()=>rows("b2b",[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","INV/1","2026-09-10","118","24-Gujarat","N","","Regular B2B","","18","100","0"]);

it("fills current and older official workbooks without changing their headings, choices or other parts",()=>{
  for(const template of templates) {
    const period=template.version==="2.0" ? "2024-09" : "2026-09",draft=b2b();draft.get("b2b.r2.c3")!.value=`${period}-10`;
    const output=gstr1Workbook(template,period,inventedGstin(),[draft]),files=xlsxEntries(output);
    const sheet=files.get("xl/worksheets/sheet2.xml")!().toString();
    expect(sheet).toContain('r="C5"');expect(sheet).toContain('>INV/1<');expect(sheet).toContain('<v>100</v>');
    const original=xlsxEntries(readFileSync(`reference/official/${template.source.file}`));
    for(const [name,read] of original) if(name!=="xl/worksheets/sheet2.xml" && name!=="xl/workbook.xml") expect(files.get(name)!().equals(read())).toBe(true);
    expect(sheet).not.toMatch(/<f>[^<]*<\/f><v>/);
    expect(createHash("sha256").update(readFileSync(`reference/official/${template.source.file}`)).digest("hex")).toBe(template.source.sha256);
    const hsn=rows(template.version==="2.0" ? "hsn" : "hsn_b2b",["1001","Invented goods","NOS-NUMBERS","1.25","118","18","100","0","9","9","0"]);
    expect(gstr1Workbook(template,period,inventedGstin(),[hsn]).length).toBeGreaterThan(1000);
  }
},30_000);
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
},30_000);

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
},30_000);

it("refuses a formula in a data cell even when its cached value is blank",async()=>{
  const {editedForm}=await import("../../worker/edited-form"),sheets=await import("@/src/lib/sheet");
  const template=templates[1],context={template,period:"2026-09",gstin:inventedGstin()},bytes=gstr1Workbook(template,context.period,context.gstin,[b2b()]);
  const original=sheets.xlsxEntries,parts=original(bytes),path="xl/worksheets/sheet2.xml",xml=parts.get(path)!().toString();
  parts.set(path,()=>Buffer.from(xml.replace(/<c\b[^>]*r="L5"[^>]*>[\s\S]*?<\/c>/,'<c r="L5"><f>100+1</f><v></v></c>')));
  const spy=vi.spyOn(sheets,"xlsxEntries").mockImplementation(input=>input===bytes ? parts : original(input));
  try {expect(()=>editedForm(bytes,context)).toThrow("Use values");} finally {spy.mockRestore();}
},30_000);

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
},30_000);

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
},30_000);
