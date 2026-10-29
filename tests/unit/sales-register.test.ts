import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {expect,it} from "vitest";
import {xlsxEntries,readSheet} from "@/src/lib/sheet";
import {salesSections} from "@/src/lib/gstr1-fields";
import {exactMapping,extractSales,type SalesMapping} from "@/src/lib/sales-register";

// Structure: row 4 of each section in the unchanged official GSTN workbook.
it("uses the official section headings, never an invented portal layout",()=>{
  const files=xlsxEntries(readFileSync("reference/official/gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx"));
  const text=(xml:string)=>[...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([,value])=>value.replaceAll("&amp;","&")).join("");
  const shared=[...files.get("xl/sharedStrings.xml")!().toString().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([,value])=>text(value));
  for(const [key,sheet] of Object.entries({b2b:2,b2cs:6,cdnr:8,hsn_b2b:19,hsn_b2c:20})) {
    const row=/<row r="4"[^>]*>([\s\S]*?)<\/row>/.exec(files.get(`xl/worksheets/sheet${sheet}.xml`)!().toString())![1];
    const headings=[...row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].filter(([,attrs])=>attrs.includes('t="s"')).map(([, ,body])=>shared[Number(/<v>(\d+)<\/v>/.exec(body)![1])]);
    expect(salesSections[key as keyof typeof salesSections].headings).toEqual(headings);
  }
  const rows=[Array.from(salesSections.hsn_b2b.headings)];
  expect(exactMapping(rows)).toBeUndefined();
  expect(exactMapping([Array.from(salesSections.b2cs.headings)])?.section).toBe("b2cs");
});
it("reads confirmed column choices without shifting empty rows or rounding figures",()=>{
  const rows=readSheet(Buffer.from('Name,Amount,Cess\nInvented sale,"1,23,456.78",0.00\n\nTotal,"1,23,456.78",0.00'),"register.csv",{rows:1000,columns:26,keepEmpty:true});
  const mapping:SalesMapping={section:"b2cs",header:0,headings:rows[0],columns:[-1,-1,-1,-1,1,2,-1]};
  const lines=extractSales(rows,mapping);
  expect(lines[0]).toMatchObject({value:"123456.78",row:2,column:1,field:"b2cs.r2.c4"});
  expect(lines[2]).toMatchObject({total:true,row:4,field:"b2cs.t4.c4"});
  expect(()=>extractSales([["Name","New column","Cess"],...rows.slice(1)],mapping)).toThrow("columns changed");
  expect(()=>extractSales(rows,{...mapping,columns:[-1,-1,-1,-1,1,1,-1]})).toThrow("different column");
  expect(()=>extractSales([rows[0],["Invented sale","1.234","0"]],mapping)).toThrow("row 2");
});
it("reads Excel date cells and note dates deterministically",()=>{
  const headings=Array.from(salesSections.cdnr.headings),columns=headings.map((_,i)=>i);
  const rows=[headings,["","Invented Firm","C1","10-Oct-2026","C","","N","Regular B2B","118.00","","18","100.00","0"]];
  expect(extractSales(rows,{section:"cdnr",header:0,headings,columns}).find((line)=>line.kind==="date")?.value).toBe("2026-10-10");
  rows[1][3]="31-Feb-2026";
  expect(()=>extractSales(rows,{section:"cdnr",header:0,headings,columns})).toThrow();
  // A register may name each e-invoice's IRN after the official columns; the portal JSON leaves those out.
  rows[1][3]="10-Oct-2026";rows[0].push("IRN");rows[1].push(randomBytes(32).toString("hex"));
  expect(extractSales(rows,{section:"cdnr",header:0,headings:rows[0],columns:[...columns,13]}).find((line)=>line.field==="cdnr.r2.c13")?.value).toBe(rows[1][13]);
  expect(exactMapping(rows)?.columns.at(-1)).toBe(13);
});
