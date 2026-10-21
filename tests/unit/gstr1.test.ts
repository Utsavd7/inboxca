import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
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
