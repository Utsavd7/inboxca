import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {portalParsers,readPortal} from "../../worker/portal";
import {jsonSource} from "../../worker/json-source";
import {gstr2a,inventedGstin,statement} from "../fixtures/portal";
import {isGstin} from "@/src/lib/identifiers";

const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
it("reads credit figures only through the unchanged official schemas, with source locations",()=>{
  expect(isGstin(inventedGstin())).toBe(true);
  const input=statement(),read=readPortal(bytes(input))!;
  expect(read).toMatchObject({kind:"GSTR-2B",period:"2026-09",gstin:inventedGstin(),version:"v4.5"});
  expect(read.lines).toHaveLength(8);
  const line=read.lines.find((line)=>line.path==="/data/itcsumm/itcavl/nonrevsup/igst")!;
  expect(line).toMatchObject({value:"100",page:1});
  const source=jsonSource(input);expect(source.lines[source.positions.get(line.path)!-1]).toContain('"igst": 100');
  expect(portalParsers[1].read(input)?.version).toBe("v4.4");
  expect(readPortal(bytes({...input,data:{...input.data,itcsumm:{itcRejected:{nonrevsup:{igst:12,b2b:{igst:12}}}}}}))?.lines[0].field).toContain("itcrejected");
  // No credit eligibility or netting rule is inferred from the layout alone.
  expect(read.checks).toEqual([]);
  const pinned={"v4.5":"3351e86b8309ebe0cd45abcc217951cbb57401c24336a7bbaaaef5d687202e95","v4.4":"80ef571df18bee03c302af7e1957ecb1d0ae35d21dc14ac96a745f044f42b000"};
  for(const [version,sha] of Object.entries(pinned)) expect(createHash("sha256").update(readFileSync(`reference/official/gstn/gstr2b-${version}-response-schema.json`)).digest("hex")).toBe(sha);
});
it("refuses a different layout, invalid tax number, missing identity and amounts outside the official precision",()=>{
  const input=statement();
  for(const value of [null,{}, {data:input.data},{...input,data:{...input.data,gstin:input.data.gstin.slice(0,-1)+"!"}},{...input,data:{...input.data,rtnprd:"132026"}},{...input,data:{...input.data,itcsumm:{itcavl:{nonrevsup:{igst:1.001}}}}},{...input,data:{...input.data,itcsumm:{inventedBucket:{igst:10}}}}]) expect(readPortal(bytes(value))).toBeNull();
  expect(readPortal(Buffer.from("not a statement"))).toBeNull();
  // A GSTR-2A without B2B invoices has nothing to read.
  expect(readPortal(bytes({gstin:inventedGstin(),fp:"092026",b2b:[]}))).toBeNull();
});
it("reads GSTR-2A B2B invoices through the pinned v2.3 schema, and nothing it does not lay out",()=>{
  const input=gstr2a(),read=readPortal(bytes(input))!;
  expect(read).toMatchObject({kind:"GSTR-2A",version:"v2.3",gstin:inventedGstin(),period:"2026-09",checks:[]});
  expect(read.lines.map((line)=>line.field)).toEqual(["val","txval","rt","camt","samt","csamt"].map((key)=>`gstr2a.b2b.0.inv.0${key==="val" ? "" : ".itms.0.itm_det"}.${key}`));
  const line=read.lines.find((line)=>line.path==="/b2b/0/inv/0/itms/0/itm_det/camt")!;
  expect(line).toMatchObject({value:"90",page:1,label:`Central tax, from ${inventedGstin("ZZZPZ0002Z")}, invoice INV-1, item 1`});
  const source=jsonSource(input);expect(source.lines[source.positions.get(line.path)!-1]).toContain('"camt": 90');
  // Sections the schema does not lay out stay unread; a GSTR-2B is never taken for a GSTR-2A.
  expect(readPortal(bytes({...input,cdn:[{nt:[{val:5}]}]}))?.lines).toHaveLength(6);
  expect(readPortal(bytes(statement()))?.kind).toBe("GSTR-2B");
  const invoice=input.b2b[0].inv[0];
  for(const value of [{...input,fp:"132026"},{...input,gstin:"27AAPFU0939F1Z!"},{...input,b2b:[{...input.b2b[0],inv:[{...invoice,inventedField:1}]}]},{...input,b2b:[{...input.b2b[0],inv:[{...invoice,val:1.001}]}]},{...input,b2b:[{...input.b2b[0],inv:[{...invoice,idt:"2026-09-05"}]}]}]) expect(readPortal(bytes(value))).toBeNull();
  expect(createHash("sha256").update(readFileSync("reference/official/gstn/gstr2a-v2.3-response-schema.json")).digest("hex")).toBe("2b2e698870db2cd4a9826f09ad9ddec07abb507d268141252352e80f8c6972f0");
});
it("caps the source layout at thirty pages and preserves escaped entry paths",()=>{
  const source=jsonSource({"a/b":{"~name":5},rows:Array.from({length:2000},(_,n)=>n)});
  expect(source.positions.get("/a~1b/~0name")).toBe(3);
  expect(source.limited).toBe(true);expect(source.lines.length).toBeLessThanOrEqual(1200);
  expect(source.positions.has("/rows/1999")).toBe(false);
});
