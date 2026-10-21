import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {portalParsers,readPortal} from "../../worker/portal";
import {jsonSource} from "../../worker/json-source";
import {inventedGstin,statement} from "../fixtures/portal";
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
  // The B2B API response for 2A does not establish a whole portal download's identity.
  expect(readPortal(bytes({gstin:inventedGstin(),fp:"092026",b2b:[]}))).toBeNull();
});
it("caps the source layout at thirty pages and preserves escaped entry paths",()=>{
  const source=jsonSource({"a/b":{"~name":5},rows:Array.from({length:2000},(_,n)=>n)});
  expect(source.positions.get("/a~1b/~0name")).toBe(3);
  expect(source.limited).toBe(true);expect(source.lines.length).toBeLessThanOrEqual(1200);
  expect(source.positions.has("/rows/1999")).toBe(false);
});
