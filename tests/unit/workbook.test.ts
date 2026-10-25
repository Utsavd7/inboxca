import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {xlsxEntries} from "@/src/lib/sheet";
import {writeWorkbook} from "../../worker/workbook";

it("fills literal cells in the official workbook while preserving every other part",()=>{
  const original=readFileSync("reference/official/gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx"),file="xl/worksheets/sheet2.xml";
  const output=writeWorkbook(original,new Map([[file,new Map([["C5",{value:"=Invented & <sale>",number:false}],["L5",{value:"1234.56",number:true}]])]]));
  const before=xlsxEntries(original),after=xlsxEntries(output);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for(const [name,read] of before) if(name!==file && name!=="xl/workbook.xml") expect(after.get(name)!().equals(read())).toBe(true);
  expect(after.get("xl/workbook.xml")!().toString()).toContain('fullCalcOnLoad="1"');
  const xml=after.get(file)!().toString();
  expect(xml).toContain('<t xml:space="preserve">=Invented &amp; &lt;sale&gt;</t>');expect(xml).toContain('<v>1234.56</v>');expect(xml).not.toContain('<f>=Invented');
  expect(()=>writeWorkbook(original,new Map([[file,new Map([["XFD1048576",{value:"1",number:true}]])]]))).toThrow("does not have");
  expect(()=>writeWorkbook(original,new Map([["missing.xml",new Map([["A5",{value:"1",number:true}]])]]))).toThrow("sheets");
  expect(()=>writeWorkbook(original,new Map([[file,new Map([["C5",{value:"bad\u0000text",number:false}]])]]))).toThrow("text");
},30_000); // The official workbook is 7 MB; a busy machine needs more than 5 seconds.
