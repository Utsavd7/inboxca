import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "@/src/lib/templates";
import {checkFigures,type Draft,type Figure} from "@/src/lib/datasets";
import {salesSections} from "@/src/lib/gstr1-fields";
import {sectionSummary} from "@/src/lib/section-check";
import {inventedGstin} from "@/src/lib/form-samples";
import {gstr1Json} from "../../worker/gstr1";

// An invented B2B register of three invoices and its total row, as sales-draft.ts reads one: a
// line a cell, a sum check for each total of an amount column.
const source={document:randomUUID(),sha256:"a".repeat(64),page:1,sheet:1,cell:"A1"}; // ggignore: invented source checksum.
const invoice=(gstin:string,number:string,value:string,taxable:string)=>[gstin,"Invented Recipient",number,"2026-09-10",value,"24-Gujarat","N","","Regular B2B","","18",taxable,"0"];
function register(rows:string[][],totals:Record<number,string>) {
  const draft:Draft={lines:[],checks:[]},figures=new Map<string,Figure>();
  const add=(field:string,label:string,value:string,kind:Figure["kind"])=>{const id=randomUUID();draft.lines.push({id,field,value_enc:"invented encrypted figure",source,state:"pending"});figures.set(id,{label,value,kind});return id;};
  const headings=salesSections.b2b.headings,parts=new Map<number,string[]>();
  rows.forEach((row,n)=>row.forEach((value,column)=>{
    if(!value) return;
    const id=add(`b2b.r${n+2}.c${column}`,`${headings[column]}, row ${n+2}`,value,/date$/i.test(headings[column]) ? "date" : /Value|Rate|Cess/.test(headings[column]) ? "number" : "text");
    if(!parts.has(column)) parts.set(column,[]);parts.get(column)!.push(id);
  }));
  for(const [column,value] of Object.entries(totals)) draft.checks.push({kind:"sum",parts:parts.get(Number(column))!,total:add(`b2b.t${rows.length+2}.c${column}`,`${headings[Number(column)]}, row ${rows.length+2}`,value,"number")});
  return {draft,figures};
}
const good=[invoice(inventedGstin("ZZZPZ0002Z"),"INV/1","118","100"),invoice(inventedGstin("ZZZPZ0003Z"),"INV/2","236","200")];
const template=templateSchema.parse(catalog.find((row)=>row.form_code==="GSTR1" && row.status==="active"));
const byField=(draft:Draft,figures:Map<string,Figure>)=>new Map(draft.lines.map((line)=>[line.field,figures.get(line.id)!]));

it("one Yes covers the rows that add up to the register's total, never a row with a wrong GSTIN, and the JSON is unchanged",()=>{
  const {draft,figures}=register([...good,invoice("24AAAAA0000A1Z0","INV/3","59","50")],{4:"413",11:"350",12:"0"});
  const [section]=sectionSummary(draft,figures);
  expect(section).toMatchObject({section:"b2b",rows:3,agree:true,checked:false});
  expect(section.totals.map((total)=>[total.label,total.ok])).toEqual([["Invoice Value",true],["Taxable Value",true],["Cess Amount",true]]);
  expect(section.byRate).toEqual([{rate:"18",taxable:BigInt(35000)}]);
  // The third row is flagged and left out of the one Yes; the two good rows and the totals are in it.
  expect(section.flagged).toEqual([{row:"r4",line:draft.lines.find((line)=>line.field==="b2b.r4.c0")!.id,why:"GSTIN/UIN of Recipient is not a valid GSTIN"}]);
  const wrong=new Set(draft.lines.filter((line)=>line.field.startsWith("b2b.r4.")).map((line)=>line.id));
  expect(section.lines.some((id)=>wrong.has(id))).toBe(false);
  expect(section.lines).toHaveLength(draft.lines.length-wrong.size);
  // Saying yes changes states only, never a figure: the portal JSON from the good rows is the same.
  const checked={draft:register(good,{4:"354",11:"300",12:"0"}),period:"2026-09",gstin:inventedGstin()};
  const before=gstr1Json(template,checked.period,checked.gstin,[byField(checked.draft.draft,checked.draft.figures)]).map(String);
  const ids=new Set(sectionSummary(checked.draft.draft,checked.draft.figures)[0].lines);
  for(const line of checked.draft.draft.lines) if(ids.has(line.id)) {line.state="confirmed";line.by="person";line.at="2026-11-02T05:00:00.000Z";}
  expect(checked.draft.draft.lines.every((line)=>line.state==="confirmed")).toBe(true);
  expect(gstr1Json(template,checked.period,checked.gstin,[byField(checked.draft.draft,checked.draft.figures)]).map(String)).toEqual(before);
  expect(before.join("")).toContain('"txval":100');expect(before.join("")).toContain('"txval":200');
});

it("a section whose rows do not add up to its total, or has no total row, cannot be said yes to at once",()=>{
  const off=register(good,{4:"354",11:"301",12:"0"});
  expect(sectionSummary(off.draft,off.figures)[0]).toMatchObject({agree:false});
  expect(checkFigures(off.draft,off.figures)).toHaveLength(1);
  const none=register(good,{});
  expect(sectionSummary(none.draft,none.figures)[0]).toMatchObject({agree:false,totals:[]});
  // A taxable value marked wrong is flagged and makes its total fail until it is corrected.
  const rejected=register(good,{4:"354",11:"300",12:"0"});
  rejected.draft.lines.find((line)=>line.field==="b2b.r2.c11")!.state="rejected";
  expect(sectionSummary(rejected.draft,rejected.figures)[0]).toMatchObject({agree:false,flagged:[{row:"r2",why:"Marked wrong"}]});
});
