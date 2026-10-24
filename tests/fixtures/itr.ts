import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve as filePath} from "node:path";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "../../src/lib/templates";
import type {FormRequest} from "../../src/lib/form-worker";

// Structure and required fields come from the pinned AY 2026-27 department schemas.
// This is an invented schema fixture, not an example of a return accepted by the portal.
export function itrRequest(form="ITR1"):FormRequest {
  const template=templateSchema.parse(catalog.find(row=>row.form_code===form));
  const schema=JSON.parse(readFileSync(filePath("reference/official",template.source.file),"utf8"));
  type Node={type?:string;$ref?:string;allOf?:Node[];properties?:Record<string,Node>;items?:Node;required?:string[];default?:unknown;enum?:unknown[];minimum?:number;minItems?:number;pattern?:string};
  const resolve=(node:Node):Node=>{
    if(node.$ref) {let at:unknown=schema;for(const key of node.$ref.slice(2).split("/")) at=(at as Record<string,unknown>)[key];return resolve(at as Node);}
    return Object.assign({},...(node.allOf ?? []).map(resolve),node);
  };
  const text:Record<string,unknown>={PAN:"ZZZPZ0001Z",AssesseeVerPAN:"ZZZPZ0001Z",EmailAddress:"invented@invented.test",DOB:"1990-01-01",OptOutNewTaxRegime:"N",SecondaryAdd:"N",Form10IEAEarlierAYOldRegime:"NA",MobileNo:9000000000,CountryCodeMobile:91,CountryCode:"91",StateCode:"24",ReturnFileSec:11,EmployerCategory:"OTH",Capacity:"S",IFSCCode:"TSTB0000001",BankAccountNo:"000000000001"}; // ggignore: invented identity, phone and bank details for schema tests.
  const make=(node:Node,key=""):unknown=>{
    node=resolve(node);
    if(key in text) return text[key];
    if(node.properties) return Object.fromEntries((node.required ?? []).map(key=>[key,make(node.properties![key],key)]));
    if(node.items) return Array.from({length:node.minItems ?? 0},()=>make(node.items!));
    if(node.default!==undefined) return node.default;
    if(node.enum) return node.enum[0];
    if(node.type==="integer" || node.type==="number") return Math.max(node.minimum ?? 0,0);
    return /^20\d{2}-\d{2}-\d{2}$/.test(node.pattern ?? "") ? node.pattern : "Invented";
  };
  const root=resolve(resolve(schema as Node).properties!.ITR).properties![form],body=make(root) as Record<string,unknown>;
  const figures:FormRequest["drafts"][number]["figures"]=[];
  for(const [field,path] of Object.entries(template.mappings.fields!)) {
    // All optional repeating schedules are absent in this minimum schema fixture.
    if(path.includes("*")) continue;
    let at:unknown=body;
    for(const key of path.split(".")) at=at && typeof at==="object" ? (at as Record<string,unknown>)[key] : undefined;
    if(at!==undefined) figures.push([field,{label:path.split(".").at(-1)!,value:String(at),kind:typeof at==="number" ? "number" : /^\d{4}-\d{2}-\d{2}$/.test(String(at)) ? "date" : "text"}]);
  }
  return {purpose:"prepare",firm:randomUUID(),client:randomUUID(),registration:randomUUID(),pan:"ZZZPZ0001Z",period:"2026",expires:Math.floor(Date.now()/1000)+60,template,drafts:[{id:randomUUID(),revision:1,figures}]}; // ggignore: invented PAN for a schema test.
}
