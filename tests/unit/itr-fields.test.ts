import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {itrChoice,itrChoiceNames,itrFields,itrForms,itrSources,itrYear} from "@/src/lib/itr-fields";

type Node={properties?:Record<string,Node>;items?:Node;$ref?:string;type?:string;definitions?:Record<string,Node>};
it("every ITR figure points to a field in the unchanged official AY schema",()=>{
  for(const form of itrForms) {
    const source=itrSources[form],bytes=readFileSync(new URL(`../../reference/official/itr/${source.file}`,import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
    const schema:Node=JSON.parse(bytes.toString());
    const resolve=(value:Node):Node=>value.$ref ? resolve(schema.definitions![value.$ref.split("/").at(-1)!]) : value;
    for(const [field,entry] of Object.entries(itrFields)) {
      const path=(entry.paths as Partial<Record<typeof form,string>>)[form];if(!path) continue;
      let node=schema;
      for(const part of ["ITR",form,...path.split(".")]) {
        node=resolve(node);const next=part==="*" ? node.items : node.properties?.[part];
        expect(next,`${form}: ${field} points to ${path}`).toBeDefined();node=next!;
      }
      expect(resolve(node).type,field).not.toBe("object");
      expect(resolve(node).type,field).not.toBe("array");
      expect(field.replaceAll("*","0")).toMatch(/^[a-z][a-z0-9_.]{0,99}$/);
    }
  }
});
it("does not label unrestricted gains as section 112A or give firms a salary schedule",()=>{
  expect(itrFields["itr.capital_gains.total"].paths.ITR1).toBeUndefined();
  expect(itrFields["itr.capital_gains.ltcg112a"].paths.ITR2).toBeUndefined();
  expect(itrFields["itr.salary.gross"].paths).not.toHaveProperty("ITR5");
  expect(itrFields["itr.salary.gross"].paths).not.toHaveProperty("ITR6");
});

it("names a return's year as the law of that year does",()=>{
  // Income up to 31 Mar 2026 is under the 1961 Act (assessment years); from 1 Apr 2026 the
  // Income-tax Act 2025 names a tax year.
  expect(itrYear("2026")).toBe("AY 2026-27 (FY 2025-26)");
  expect(itrYear("2027")).toBe("Tax year 2026-27");
});

// A wrong pick goes into the return, so a code's meaning is only ever the official schema's own.
it("names every official code from its schema's description, else shows the bare code",()=>{
  type Enum={description?:string;enum?:unknown[]};
  const lists:Record<string,{description?:string;values:string[]}[]>={};
  for(const form of itrForms) {
    const walk=(node:unknown,key:string)=>{
      if(!node || typeof node!=="object") return;
      if(Array.isArray(node)) {node.forEach(item=>walk(item,key));return;}
      const {enum:values,description}=node as Enum;
      if(values) (lists[`${form}.${key}`] ??= []).push({description,values:values.map(String)});
      for(const [child,value] of Object.entries(node)) if(child!=="enum") walk(value,child);
    };
    walk(JSON.parse(readFileSync(new URL(`../../reference/official/itr/${itrSources[form].file}`,import.meta.url),"utf8")),"");
  }
  for(const [where,all] of Object.entries(lists)) for(const {description,values} of all) {
    const names=itrChoiceNames(description,values);
    if(names) expect(names,where).toHaveLength(values.length);
    for(const [index,value] of values.entries()) {
      const {text}=itrChoice({choices:values,names},value);
      if(!names?.[index]) expect(text,where).toBe(value);
      else expect(text,where).not.toMatch(/\s-|-\s/);
    }
  }
  const named=(where:string,value:string)=>{const {description,values}=lists[where][0];return itrChoice({choices:values,names:itrChoiceNames(description,values)},value).text;};
  expect(named("ITR1.EmployerCategory","CGOV")).toBe("Central Government");
  expect(named("ITR1.ReturnFileSec","11")).toBe("139(1), On or before due date (11)");
  expect(named("ITR1.PropertyOwner","SE")).toBe("Self");
  expect(named("ITR1.StateCode","11")).toBe("Gujarat (11)");
  expect(named("ITR1.CountryCode","91")).toBe("INDIA (91)");
  expect(named("ITR2.SecondaryAdd","Y")).toBe("Yes");
  // Codes the description writes another way ("80GGA(2)(a)" for 80GGA2a) are never matched up by guess.
  expect(named("ITR1.RelevantClauseUndrDedClaimed","80GGA2a")).toBe("80GGA2a");
});
