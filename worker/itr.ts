import {officialSchema} from "./schema.ts";
import {itrFieldName,itrFields,itrReady,itrSources,type ItrForm} from "../src/lib/itr-fields.ts";
import type {Template} from "../src/lib/templates.ts";
import type {FormRequest,ItrEntry,ItrReview} from "../src/lib/form-worker.ts";
import {jsonSource} from "./json-source.ts";
import {itrChecks} from "./itr-rules.ts";

type Schema={type?:string;$ref?:string;allOf?:Schema[];properties?:Record<string,Schema>;items?:Schema;required?:string[];enum?:unknown[];default?:unknown;format?:string;description?:string;pattern?:string};
type Values=Record<string,unknown>;
const words=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ");
const groups:Record<string,string>={PersonalInfo:"Client details",FilingStatus:"Filing details",ITR1_IncomeDeductions:"Income and deductions",IncomeDeductions:"Income and deductions",ITR1_TaxComputation:"Tax amounts",TaxComputation:"Tax amounts",TaxPaid:"Taxes paid",Refund:"Refund and bank details",Verification:"Declaration",TDSonSalaries:"TDS on salary",TDSonOthThanSals:"Other TDS",ScheduleTCS:"TCS",TaxPayments:"Tax challans",ScheduleIT:"Tax challans",ScheduleBP:"Business details",
  PartA_GEN1:"Client and filing details",PartA_GEN2:"Business and audit details",PARTA_BS:"Balance sheet",ManufacturingAccount:"Manufacturing account",TradingAccount:"Trading account",PARTA_PL:"Profit and loss account",PARTA_OI:"Other information",PARTA_QD:"Quantity details","PartB-TI":"Total income",PartB_TTI:"Tax, taxes paid and refund",ScheduleTDS1:"TDS on salary",ScheduleTDS2:"Other TDS",ScheduleCGFor23:"Schedule CG",ScheduleTDS3Dtls:"Schedule TDS3",ScheduleTDS3:"Schedule TDS3",ScheduleEA10_13A:"House rent allowance"};
// Schedules keep the official names CA staff know, such as Schedule HP or Schedule 80C.
const group=(key:string)=>groups[key] ?? (/^(ITR\d)?Schedule/.test(key) ? `Schedule ${key.replace(/^(ITR\d)?Schedule_?/,"").replace(/_/g,"-")}` : words(key));
const entries=new Map<string,ItrEntry[]>();
const sourceFor=(template:Template)=>{
  const form=template.form_code as ItrForm,source=itrSources[form];
  if(!/^ITR[1-4]$/.test(form) || !source || template.version!==source.version || template.source.file!==`itr/${source.file}` || template.source.sha256!==source.sha256) throw new Error("This official ITR version is not ready yet");
  return officialSchema(template.source.file,template.source.sha256);
};
const resolver=(schema:unknown)=>{
  const resolve=(node:Schema):Schema=>{
    if(node.$ref) {
      let found:unknown=schema;
      if(!node.$ref.startsWith("#/")) throw new Error("Unknown official reference");
      for(const key of node.$ref.slice(2).split("/")) found=(found as Values)[key.replaceAll("~1","/").replaceAll("~0","~")];
      return resolve(found as Schema);
    }
    return Object.assign({},...(node.allOf ?? []).map(resolve),node);
  };
  return resolve;
};
const rootOf=(template:Template)=>{const {schema}=sourceFor(template),resolve=resolver(schema);return {resolve,root:resolve(resolve(resolve(schema as Schema).properties!.ITR).properties![template.form_code])};};

// Every entry comes from a leaf in the pinned official schema. No invented JSON keys.
export function itrEntries(template:Template) {
  const form=template.form_code as ItrForm,{resolve,root}=rootOf(template);
  const cached=entries.get(template.source.sha256);if(cached) return cached;
  const leaves:{path:string[];node:Schema;required:boolean}[]=[];
  const walk=(node:Schema,path:string[],required:boolean)=>{
    if(path.length>25 || leaves.length>10000) throw new Error("This form is too large");
    node=resolve(node);
    if(node.properties) {for(const [key,value] of Object.entries(node.properties)) walk(value,[...path,key],!!node.required?.includes(key));return;}
    if(node.items) {walk(node.items,[...path,"*"],required);return;}
    if(path[0]!=="CreationInfo" && path[0]!==`Form_${form}`) leaves.push({path,node,required});
  };
  for(const [key,node] of Object.entries(root.properties!)) walk(node,[key],!!root.required?.includes(key));
  // A part with many details is split by its next heading, so one page shows one part.
  const sizes=new Map<string,number>();for(const {path} of leaves) sizes.set(path[0],(sizes.get(path[0]) ?? 0)+1);
  const result=leaves.map(({path,node,required}):ItrEntry=>{
    const target=path.join("."),rows=path.filter(key=>key==="*").length,split=sizes.get(path[0])!>80 && path.length>2;
    const field=itrFieldName(form,target),named=itrFields[field as keyof typeof itrFields];
    const primitive=node.type ?? (node.enum?.length ? typeof node.enum[0] : "string");
    if(!["string","integer","number","boolean"].includes(primitive)) throw new Error("Unknown official value type");
    // Numbers with a pattern (mobile numbers, PIN codes) are codes, not amounts.
    const kind=(primitive==="integer" || primitive==="number") && !node.pattern ? "number" : /YYYY-MM-DD/.test(node.description ?? "") || /^(DOB|DateDep|.*Date)$/.test(path.at(-1)!) && /\\d\{3\}/.test(node.pattern ?? "") ? "date" : "text";
    const label=named?.label ?? (path.slice(split ? 2 : 1).filter(key=>key!=="*").map(words).join(" · ").slice(0,120) || words(path.at(-1)!));
    // A value the schema fixes, such as the due date ITR-1 allows, is offered as its only choice.
    const choices=node.enum?.map(String) ?? (node.pattern && /^[A-Za-z0-9 .-]+$/.test(node.pattern) ? [node.pattern] : undefined);
    // Rules the schema states in words: the latest or earliest date it allows.
    const latest=node.description?.match(/maximum date allowed (\d{4}-\d{2}-\d{2})/)?.[1],earliest=node.description?.match(/on or after (\d{4}-\d{2}-\d{2})/)?.[1];
    return {field,path:target,group:split ? `${group(path[0])}: ${words(path[1])}` : group(path[0]),label,kind,primitive:primitive as ItrEntry["primitive"],rows,required,...(choices && {choices}),...(node.default!==undefined && {defaultValue:String(node.default)}),...(latest && {latest}),...(earliest && {earliest})};
  });
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

function put(root:Values,path:string,value:unknown) {
  const keys=path.split(".");let current:Values|unknown[]=root;
  for(let i=0;i<keys.length;i++) {
    const key=keys[i];if(["__proto__","prototype","constructor"].includes(key)) throw new Error("Unknown field");
    const object=current as Values;
    if(i===keys.length-1) {object[key]=value;return;}
    if(!object[key]) object[key]=/^\d+$/.test(keys[i+1]) ? [] : {};
    current=object[key] as Values;
  }
}
const read=(root:unknown,path:string)=>path.split(".").reduce<unknown>((at,key)=>at && typeof at==="object" ? (at as Values)[key] : undefined,root);

export function itrValue(entry:ItrEntry,value:string) {
  if(entry.primitive==="integer" && !/^-?\d{1,14}$/.test(value) || entry.primitive==="number" && !/^-?\d{1,13}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid amount");
  if(entry.primitive==="boolean") {if(!["true","false"].includes(value)) throw new Error("Choose yes or no");return value==="true";}
  return entry.primitive==="integer" || entry.primitive==="number" ? Number(value) : value;
}

// The department gives a registered software its own ID (SW and 8 digits). It is never guessed:
// until ITR_SOFTWARE_ID and ITR_SOFTWARE_CITY are set, no filing file is made.
export function itrCreation(template:Template,now=new Date()) {
  if(!itrReady()) throw new Error("ITR files are not set up yet");
  const {resolve,root}=rootOf(template),version=resolve(resolve(root.properties!.CreationInfo).properties!.SWVersionNo).default;
  const id=process.env.ITR_SOFTWARE_ID!;
  return {SWVersionNo:String(version),SWCreatedBy:id,JSONCreatedBy:id,JSONCreationDate:new Date(now.getTime()+330*60_000).toISOString().slice(0,10),IntermediaryCity:process.env.ITR_SOFTWARE_CITY!.trim(),Digest:"-"};
}

// Form_ITRn holds only what the schema fixes: the form name, the year and its versions.
function formMeta(template:Template) {
  const {resolve,root}=rootOf(template),form=template.form_code;
  return Object.fromEntries(Object.entries(resolve(root.properties![`Form_${form}`]).properties!).map(([key,node])=>{
    node=resolve(node);
    return [key,node.enum?.length===1 ? String(node.enum[0]) : node.pattern && /^[A-Za-z0-9 .-]+$/.test(node.pattern) ? node.pattern : `ITR-${form.slice(3)}`];
  }));
}
const panPath=(form:string)=>(itrFields["itr.personal.pan"].paths as Partial<Record<string,string>>)[form]!;

function build(request:FormRequest,creation:Values) {
  const {template,period,pan}=request,form=template.form_code,meta=formMeta(template);
  if(!pan || meta.AssessmentYear!==period) throw new Error("This official ITR year is not ready yet");
  const body:Values={CreationInfo:creation,[`Form_${form}`]:meta},seen=new Set<string>(),issues:string[]=[];
  for(const draft of request.drafts) for(const [field,figure] of draft.figures) {
    // A paper's own rows, such as Form 26AS's, are there to check the return against, not to fill it.
    if(!field.startsWith("itr.")) continue;
    const entry=itrEntry(template,field),value=itrValue(entry,figure.value),row=entry.rows ? `, row ${Number(entry.path.match(/\.(\d+)(\.|$)/)![1])+1}` : "";
    if(seen.has(entry.path)) throw new Error("Two sources fill the same figure. Check them together first");
    seen.add(entry.path);put(body,entry.path,value);
    if(entry.latest && String(value)>entry.latest) issues.push(`${entry.label}${row}: the official form allows dates up to ${entry.latest}.`);
    if(entry.earliest && String(value)<entry.earliest) issues.push(`${entry.label}${row}: the official form allows dates from ${entry.earliest}.`);
  }
  // The PAN is the client's own PAN registration in InboxCA, never a separate typed copy.
  if(seen.has(panPath(form)) && read(body,panPath(form))!==pan) throw new Error("The PAN in the figures must match this client");
  put(body,panPath(form),pan);
  const output={ITR:{[form]:body}},official=sourceFor(template),resolve=resolver(official.schema);
  // Required empty objects are structure, not invented figures or default amounts.
  const containers=(node:Schema,value:Values|unknown[])=>{
    node=resolve(node);
    if(node.items && Array.isArray(value)) for(const row of value) if(row && typeof row==="object") containers(node.items,row as Values);
    for(const [key,child] of Object.entries(node.properties ?? {})) {
      const object=value as Values;
      if(object[key]===undefined && node.required?.includes(key) && resolve(child).type==="object") object[key]={};
      if(object[key] && typeof object[key]==="object") containers(child,object[key] as Values);
    }
  };
  containers(official.schema as Schema,output);
  official.validate(output);
  return {output,body,issues,errors:official.validate.errors ?? []};
}

// What the schema still needs, and plain words for every other failure.
function review(request:FormRequest,creation:Values):ItrReview & {output:Values} {
  const form=request.template.form_code,{output,body,issues,errors}=build(request,creation),known=new Map(itrEntries(request.template).map(entry=>[entry.path,entry]));
  const missing:ItrReview["missing"]=[],seen=new Set<string>();
  for(const error of errors) {
    const at=error.dataPath+(error.keyword==="required" ? `/${(error.params as {missingProperty:string}).missingProperty.replace(/^[./]|^\['|'\]$/g,"")}` : "");
    const keys=at.split("/").slice(3).map(key=>key.replaceAll("~1","/").replaceAll("~0","~"));
    if(!at.startsWith(`/ITR/${form}/`) || keys[0]==="CreationInfo" && !Object.keys(creation).length) continue;
    const pattern=keys.map(key=>/^\d+$/.test(key) ? "*" : key).join("."),entry=known.get(pattern),rows=keys.filter(key=>/^\d+$/.test(key)).map(Number);
    const label=`${entry?.label ?? keys.filter(key=>!/^\d+$/.test(key)).map(words).slice(-2).join(" · ")}${rows.length ? `, row ${rows[0]+1}` : ""}`;
    if(error.keyword==="required") {
      if(seen.has(at)) continue;seen.add(at);
      let index=0;missing.push({label,group:entry?.group ?? group(keys[0]),...(entry && {field:entry.field.replaceAll("*",()=>String(rows[index++]))})});
      continue;
    }
    const limit=(error.params as {limit?:number}).limit;
    const text=error.keyword==="enum" ? "choose one of the official values" : error.keyword==="type" ? (read(output,`ITR.${form}.${keys.join(".")}`)===null ? "this row is empty. Fill the rows in order from row 1" : entry && entry.primitive!=="string" ? "enter a number" : "enter text") : ["pattern","format"].includes(error.keyword) ? "check the format" : error.keyword==="maximum" ? `must be ${limit} or less` : error.keyword==="minimum" ? `must be ${limit} or more` : error.keyword==="maxLength" ? `use ${limit} characters or fewer` : error.keyword==="minLength" ? "cannot be empty" : error.keyword==="maxItems" ? `use ${limit} rows or fewer` : error.keyword==="minItems" ? `add at least ${limit} rows` : "check this against the official form";
    const message=`${label}: ${text}.`;if(!issues.includes(message)) issues.push(message);
  }
  return {output,missing,issues:[...issues,...itrChecks(body,form)].slice(0,100)};
}
export function itrReview(request:FormRequest):ItrReview {
  try {const {missing,issues}=review(request,{});return {missing:missing.slice(0,2000),issues};}
  // Every message thrown here is InboxCA's own plain sentence, such as two sources filling one figure.
  catch(error) {return {missing:[],issues:[error instanceof Error ? error.message.slice(0,300) : "These figures could not be checked."]};}
}

// The filing file: only when nothing is missing and every check passes.
export function itrBody(request:FormRequest,creation:Values) {
  const {output,missing,issues}=review(request,creation);
  if(missing.length) throw new Error(`Still to fill: ${missing[0].label}`);
  if(issues.length) throw new Error(issues[0]);
  return output as {ITR:Record<string,Values>};
}

export function editedItr(bytes:Uint8Array,context:{template:Template;period:string;pan:string}) {
  const {template,period,pan}=context,form=template.form_code,output=JSON.parse(new TextDecoder().decode(bytes)),body=output?.ITR?.[form];
  if(!sourceFor(template).validate(output) || formMeta(template).AssessmentYear!==period || Object.keys(output.ITR).length!==1 || read(body,panPath(form))!==pan || body?.[`Form_${form}`]?.AssessmentYear!==period || itrChecks(body,form).length) throw new Error("Choose this client's checked official return for the same year");
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
      else if(value && typeof value==="object") walk((value as Values)[key],rest,[...path,key],rows);
    };
    walk(body,entry.path.split("."),[],[]);
  }
  if(!lines.length || lines.length>10000) throw new Error("Choose a filled official return");
  return {lines};
}
