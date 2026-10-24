import {createHash} from "node:crypto";
import {officialSchema} from "./schema.ts";
import {itrFields,itrSources,type ItrForm} from "../src/lib/itr-fields.ts";
import type {Template} from "../src/lib/templates.ts";
import type {FormRequest,ItrEntry} from "../src/lib/form-worker.ts";
import {jsonSource} from "./json-source.ts";
import {itrChecks} from "./itr-rules.ts";

type Schema={type?:string;$ref?:string;allOf?:Schema[];properties?:Record<string,Schema>;items?:Schema;required?:string[];enum?:unknown[];default?:unknown;format?:string;description?:string;pattern?:string};
const words=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ");
const groups:Record<string,string>={PersonalInfo:"Client details",FilingStatus:"Filing details",ITR1_IncomeDeductions:"Income and deductions",IncomeDeductions:"Income and deductions",ITR1_TaxComputation:"Tax amounts",TaxComputation:"Tax amounts",TaxPaid:"Taxes paid",Refund:"Refund and bank details",Verification:"Declaration",TDSonSalaries:"TDS on salary",TDSonOthThanSals:"Other TDS",ScheduleTCS:"TCS",TaxPayments:"Tax challans",ScheduleIT:"Tax challans",ScheduleBP:"Business details"};
const entries=new Map<string,ItrEntry[]>();
const sourceFor=(template:Template)=>{
  const form=template.form_code as ItrForm,source=itrSources[form];
  if(!source || template.version!==source.version || template.source.file!==`itr/${source.file}` || template.source.sha256!==source.sha256) throw new Error("This official ITR version is not ready yet");
  return officialSchema(template.source.file,template.source.sha256);
};

// Every entry comes from a leaf in the pinned official schema. No invented JSON keys.
export function itrEntries(template:Template) {
  const {schema}=sourceFor(template),form=template.form_code as ItrForm;
  const cached=entries.get(template.source.sha256);if(cached) return cached;
  const resolve=(node:Schema):Schema=>{
    if(node.$ref) {
      let found:unknown=schema;
      if(!node.$ref.startsWith("#/")) throw new Error("Unknown official reference");
      for(const key of node.$ref.slice(2).split("/")) found=(found as Record<string,unknown>)[key.replaceAll("~1","/").replaceAll("~0","~")];
      return resolve(found as Schema);
    }
    return Object.assign({},...(node.allOf ?? []).map(resolve),node);
  };
  const result:ItrEntry[]=[];
  const walk=(node:Schema,path:string[],required:boolean)=>{
    if(path.length>25 || result.length>10000) throw new Error("This form is too large");
    node=resolve(node);
    if(node.properties) {for(const [key,value] of Object.entries(node.properties)) walk(value,[...path,key],!!node.required?.includes(key));return;}
    if(node.items) {walk(node.items,[...path,"*"],required);return;}
    if(path[0]==="CreationInfo" || path[0]===`Form_${form}`) return;
    const target=path.join("."),rows=path.filter(key=>key==="*").length;
    const named=Object.entries(itrFields).find(([,entry])=>(entry.paths as Partial<Record<ItrForm,string>>)[form]===target);
    const field=named?.[0] ?? `itr.f.${createHash("sha256").update(target).digest("hex").slice(0,16)}${".*".repeat(rows)}`;
    const primitive=node.type ?? (node.enum?.length ? typeof node.enum[0] : "string");
    if(!["string","integer","number","boolean"].includes(primitive)) throw new Error("Unknown official value type");
    const kind=primitive==="integer" || primitive==="number" ? "number" : /YYYY-MM-DD/.test(node.description ?? "") || /^(DOB|DateDep|.*Date)$/.test(path.at(-1)!) && /\\d\{3\}/.test(node.pattern ?? "") ? "date" : "text";
    const label=named?.[1].label ?? path.slice(1).filter(key=>key!=="*").map(words).join(" · ").slice(0,120);
    result.push({field,path:target,group:groups[path[0]] ?? words(path[0]),label,kind,primitive:primitive as ItrEntry["primitive"],rows,required,...(node.enum && {choices:node.enum.map(String)}),...(node.default!==undefined && {defaultValue:String(node.default)})});
  };
  const root=resolve(resolve(schema as Schema).properties!.ITR).properties![form];
  for(const [key,node] of Object.entries(resolve(root).properties!)) walk(node,[key],!!resolve(root).required?.includes(key));
  if(new Set(result.map(entry=>entry.field)).size!==result.length) throw new Error("Repeated ITR entry");
  entries.set(template.source.sha256,result);return result;
}

export function itrEntry(template:Template,field:string) {
  const pattern=field.replace(/\.(0|[1-9]\d{0,2})(?=\.|$)/g,".*");
  const entry=itrEntries(template).find(entry=>entry.field===pattern);
  if(!entry) throw new Error("Choose a field from this official form");
  const indexes=[...field.matchAll(/\.(0|[1-9]\d{0,2})(?=\.|$)/g)].map(match=>match[1]);
  let index=0;const path=entry.path.replaceAll("*",()=>indexes[index++]);
  if(index!==indexes.length || path.includes("undefined")) throw new Error("Choose the row");
  return {...entry,path};
}

function put(root:Record<string,unknown>,path:string,value:unknown) {
  const keys=path.split(".");let current:Record<string,unknown>|unknown[]=root;
  for(let i=0;i<keys.length;i++) {
    const key=keys[i];if(["__proto__","prototype","constructor"].includes(key)) throw new Error("Unknown field");
    const object=current as Record<string,unknown>;
    if(i===keys.length-1) {object[key]=value;return;}
    if(!object[key]) object[key]=/^\d+$/.test(keys[i+1]) ? [] : {};
    current=object[key] as Record<string,unknown>;
  }
}

export function itrValue(entry:ItrEntry,value:string) {
  if(entry.primitive==="integer" && !/^-?\d{1,14}$/.test(value) || entry.primitive==="number" && !/^-?\d{1,13}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid amount");
  if(entry.primitive==="boolean") {if(!["true","false"].includes(value)) throw new Error("Choose yes or no");return value==="true";}
  return entry.kind==="number" ? Number(value) : value;
}

// The real provider identity and authentication are not guessed from an old manual.
export function itrCreation() {
  if(process.env.FILE_WORKER_TEST!=="1") throw new Error("ITR file preparation is not ready yet");
  return {SWVersionNo:"0.1.0",SWCreatedBy:"SW00000000",JSONCreatedBy:"SW00000000",JSONCreationDate:new Date(Date.now()+330*60_000).toISOString().slice(0,10),IntermediaryCity:"Invented City",Digest:"-"}; // ggignore: invented software identity for isolated tests only.
}

export function itrBody(request:FormRequest,creation:Record<string,string>,complete=true) {
  const {template,period,pan}=request,form=template.form_code;
  if(!["ITR1","ITR4"].includes(form) || period!=="2026" || !pan) throw new Error("This official ITR year is not ready yet");
  const entries=itrEntries(template),mappings=template.mappings.fields;
  if(!mappings || Object.keys(mappings).length!==entries.length || entries.some(entry=>mappings[entry.field]!==entry.path)) throw new Error("The official field choices changed");
  const body:Record<string,unknown>={CreationInfo:creation,[`Form_${form}`]:{FormName:`ITR-${form.slice(3)}`,Description:`ITR-${form.slice(3)}`,AssessmentYear:period,SchemaVer:"Ver1.0",FormVer:"Ver1.0"}},seen=new Set<string>();
  for(const draft of request.drafts) for(const [field,figure] of draft.figures) {
    const entry=itrEntry(template,field);
    if(seen.has(entry.path)) throw new Error("Two sources fill the same figure. Check them together first");
    seen.add(entry.path);put(body,entry.path,itrValue(entry,figure.value));
  }
  const personal=body.PersonalInfo as {PAN?:string}|undefined;
  if((complete || personal?.PAN) && personal?.PAN!==pan) throw new Error("The PAN in the figures must match this client");
  const output={ITR:{[form]:body}},official=sourceFor(template);
  // Required empty objects are structure, not invented figures or default amounts.
  const containers=(node:Schema,value:Record<string,unknown>|unknown[])=>{
    if(node.$ref) {let at:unknown=official.schema;for(const key of node.$ref.slice(2).split("/")) at=(at as Record<string,unknown>)[key];containers(at as Schema,value);return;}
    for(const part of node.allOf ?? []) containers(part,value);
    if(node.items && Array.isArray(value)) for(const row of value) if(row && typeof row==="object") containers(node.items,row as Record<string,unknown>);
    for(const [key,child] of Object.entries(node.properties ?? {})) {
      const object=value as Record<string,unknown>;
      if(object[key]===undefined && node.required?.includes(key)) {
        let type=child;
        if(type.$ref) {let at:unknown=official.schema;for(const name of type.$ref.slice(2).split("/")) at=(at as Record<string,unknown>)[name];type=at as Schema;}
        if(type.type==="object") object[key]={};
      }
      if(object[key] && typeof object[key]==="object") containers(child,object[key] as Record<string,unknown>);
    }
  };
  containers(official.schema as Schema,output);
  if(!official.validate(output) && (complete || official.validate.errors?.some(error=>error.keyword!=="required"))) throw new Error("Complete the required details and check the official choices");
  return output;
}

export function editedItr(bytes:Uint8Array,context:{template:Template;period:string;pan:string}) {
  const {template,period,pan}=context,form=template.form_code,output=JSON.parse(new TextDecoder().decode(bytes)),body=output?.ITR?.[form];
  if(!["ITR1","ITR4"].includes(form) || period!=="2026" || !sourceFor(template).validate(output) || Object.keys(output.ITR).length!==1 || body?.PersonalInfo?.PAN!==pan || body?.[`Form_${form}`]?.AssessmentYear!==period || itrChecks(body,form).length) throw new Error("Choose this client's checked official return for the same year");
  const layout=jsonSource(output);
  if(layout.limited) throw new Error("This form is too large to check here");
  const lines:({field:string;label:string;value:string;kind:ItrEntry["kind"];page:number;path:string})[]=[];
  for(const entry of itrEntries(template)) {
    const walk=(value:unknown,keys:string[],path:string[],rows:string[])=>{
      if(!keys.length) {
        const pointer=`/ITR/${form}/${path.join("/")}`,position=layout.positions.get(pointer);
        if(!position || value===undefined || value===null) return;
        let index=0;const field=entry.field.replaceAll("*",()=>rows[index++]);
        if(rows.some(row=>Number(row)>999) || String(value).length>2000) throw new Error("This form is too large to check here");
        lines.push({field,label:entry.label,value:String(value),kind:entry.kind,page:Math.ceil(position/40),path:pointer});return;
      }
      const [key,...rest]=keys;
      if(key==="*") {if(Array.isArray(value)) value.forEach((row,index)=>walk(row,rest,[...path,String(index)],[...rows,String(index)]));}
      else if(value && typeof value==="object") walk((value as Record<string,unknown>)[key],rest,[...path,key],rows);
    };
    walk(body,entry.path.split("."),[],[]);
  }
  if(!lines.length || lines.length>10000) throw new Error("Choose a filled official return");
  return {lines};
}
