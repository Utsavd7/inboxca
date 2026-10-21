import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {checkFigures,draftSchema,hundredths,confirmedFigures,type Draft} from "@/src/lib/datasets";
import {may} from "@/src/lib/rights";
const mock=vi.hoisted(()=>({decrypt:vi.fn()}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:mock.decrypt})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:()=>({select(){return this;},eq(){return this;},neq(){return this;},in(){return this;},single:async()=>({data:{client_id:"client"}}),then(resolve:(value:unknown)=>void){resolve({data:[{id:"document",name:"source.pdf"}]});}})})}));
const ids=Array.from({length:5},()=>randomUUID());
const source={document:randomUUID(),page:1};
const draft:Draft={lines:ids.map((id,n)=>({id,field:`figure${n}`,value_enc:"invented encrypted figure",source,state:"pending"})),checks:[{kind:"sum",parts:ids.slice(0,2),total:ids[2]},{kind:"tax",base:ids[2],rate:ids[3],total:ids[4]}]};
const values:Map<string,{label:string;value:string}>=new Map(ids.map((id,n)=>[id,{label:`Figure ${n}`,value:["0.10","0.20","0.30","18.00","0.05"][n]}]));
it("checks totals and tax without floating point, and blocks missing or rejected figures",()=>{
  expect(checkFigures(draft,values)).toEqual([]);
  const wrong=new Map(values);wrong.set(ids[2],{label:"Total",value:"0.31"});
  expect(checkFigures(draft,wrong)).toHaveLength(2);
  const rejected=structuredClone(draft);rejected.lines[0].state="rejected";
  expect(checkFigures(rejected,values)).toHaveLength(1);
  const missing=structuredClone(draft);missing.checks=[{kind:"sum",parts:[randomUUID()],total:ids[2]}];
  expect(checkFigures(missing,values)).toHaveLength(1);
  expect(hundredths("-123456.78")).toBe(BigInt(-12345678));
  for(const bad of ["1e6","1.234","NaN","Infinity","1,200.00",""]) expect(()=>hundredths(bad)).toThrow();
});
it("never exposes pending or rejected figures to a generator",async()=>{
  mock.decrypt.mockImplementation(async(_firm:string,path:string)=>JSON.stringify(values.get(path.split("/").pop()!)));
  await expect(confirmedFigures("firm","draft",draft)).rejects.toThrow("Every figure");
  const confirmed=structuredClone(draft);confirmed.lines.forEach((line)=>{line.state="confirmed";line.by=randomUUID();line.at="2026-10-21T05:00:00.000Z";});
  expect((await confirmedFigures("firm","draft",confirmed)).get("figure2")?.value).toBe("0.30");
  confirmed.lines[0].state="rejected";
  await expect(confirmedFigures("firm","draft",confirmed)).rejects.toThrow("Every figure");
});
it("keeps figure changes off by default and rejects invalid source coordinates",()=>{
  expect(may("staff","edit_figures")).toBe(false);
  expect(may("owner","edit_figures")).toBe(true);
  expect(may("staff","edit_figures",{employee:{edit_figures:true}})).toBe(true);
  const bad=structuredClone(draft);bad.lines[0].source={document:source.document,page:0};
  expect(draftSchema.safeParse(bad).success).toBe(false);
});
