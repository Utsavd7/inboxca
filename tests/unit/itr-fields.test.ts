import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {itrFields,itrForms,itrSources,itrYear} from "@/src/lib/itr-fields";

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
  expect(itrYear("2026")).toBe("AY 2026-27");
  expect(itrYear("2027")).toBe("Tax year 2026-27");
});
