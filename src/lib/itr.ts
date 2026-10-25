import {z} from "zod";
import {formContext,requestFor,workerForm} from "./prepare-form";
import {itrEntrySchema,itrReviewSchema,type ItrEntry} from "./form-worker";
import {checkValue,draftSchema,openFigures,place,saveDraft,type Draft} from "./datasets";
import {serverCrypto} from "./crypto";
import {itrReturns} from "./itr-fields";

// The official fields depend only on the pinned schema, so each version is asked for once.
const known=new Map<string,ItrEntry[]>();
export async function itrDetails(client:string,form:string,period:string,edit=true) {
  z.enum(itrReturns).parse(form);
  const context=await formContext({client,form,period},edit),key=context.template.source.sha256;
  if(!known.has(key)) known.set(key,z.array(itrEntrySchema).max(10000).parse(await (await workerForm(requestFor(context,[],"fields"))).json()));
  return {context,entries:known.get(key)!};
}
const figuresOf=(id:string,revision:number,data:Draft,figures:Awaited<ReturnType<typeof openFigures>>)=>{
  const list=data.lines.filter(line=>line.state!=="rejected").map(line=>[line.field,figures.get(line.id)!] as [string,{label:string;value:string;kind?:"number"|"text"|"date"}]);
  return list.length ? [{id,revision,figures:list}] : [];
};
export async function checkItr(client:string,period:string,id:string,revision:number,data:Draft,figures:Awaited<ReturnType<typeof openFigures>>) {
  if(!data.target) return [];
  const context=await formContext({client,form:data.target.form,period,version:data.target.version,reason:"checking"},false);
  const response=await workerForm(requestFor(context,figuresOf(id,revision,data,figures),"check"));
  return itrReviewSchema.parse(await response.json()).issues;
}

// A return is built from its own entered figures and the figures read from the client's
// papers for the year (Form 16 and other statements). Rejected figures are left out.
export async function itrWork(client:string,form:string,period:string) {
  const {context,entries}=await itrDetails(client,form,period,false),{supabase,membership}=context;
  const {data:rows,error}=await supabase.from("datasets").select("id,revision,data").eq("firm_id",membership.firmId).eq("client_id",client).eq("form_code","ITR").eq("period_key",period).order("id").limit(25);
  if(error) throw new Error("The figures could not be read.");
  const drafts=[];
  for(const row of rows ?? []) {
    const data=draftSchema.parse(row.data);
    // A return corrected outside InboxCA is its own source, checked on its own; it is left out here.
    if(!data.target || data.target.form===form && data.lines.some(line=>line.source.entered_by)) drafts.push({id:row.id,revision:row.revision,data,figures:await openFigures(membership.firmId,row.id,data)});
  }
  const response=await workerForm(requestFor(context,drafts.flatMap(row=>figuresOf(row.id,row.revision,row.data,row.figures)),"check"));
  return {context,entries,drafts,review:itrReviewSchema.parse(await response.json())};
}

// The form supplies values only. The server supplies their labels, source and person.
export async function enterItr(client:string,form:string,period:string,input:FormData) {
  const {context,entries}=await itrDetails(client,form,period),{supabase,membership,userId,permission}=context;
  const chosen=String(input.get("draft") ?? "");if(chosen) z.uuid().parse(chosen);
  const {data:row,error}=chosen ? await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",client).eq("form_code","ITR").eq("period_key",period).eq("id",chosen).maybeSingle() : {data:null,error:null};
  if(error) throw new Error("The figures could not be read.");
  if(chosen && !row) throw new Error("Choose the latest draft.");
  const id=row?.id ?? crypto.randomUUID(),data:Draft=row ? draftSchema.parse(row.data) : {lines:[],checks:[]};
  if(row && (row.revision!==Number(input.get("revision")) || data.target && (data.target.form!==form || data.target.version!==context.template.version))) throw new Error("These figures changed. Open the latest draft.");
  const fields=new Set(data.lines.map(line=>line.field));
  let added=0;
  for(const [field,value] of input) {
    if(!field.startsWith("itr.") || typeof value!=="string" || !value.trim()) continue;
    const pattern=field.replace(/\.(0|[1-9]\d{0,2})(?=\.|$)/g,".*"),entry=entries.find(entry=>entry.field===pattern);
    // The PAN always comes from the client's PAN registration, so it is never typed.
    if(!entry || field==="itr.personal.pan" || value.length>2000 || fields.has(field)) throw new Error("Correct an existing figure on the review screen.");
    const indexes=[...field.matchAll(/\.(0|[1-9]\d{0,2})(?=\.|$)/g)];
    if(indexes.length!==entry.rows || entry.choices && !entry.choices.includes(value.trim())) throw new Error("Choose a value from the official form.");
    const line=crypto.randomUUID(),figure={label:entry.label,value:value.trim(),kind:entry.kind};
    checkValue(figure);
    data.lines.push({id:line,field,value_enc:await serverCrypto().encrypt(membership.firmId,place(id,line),JSON.stringify(figure)),source:{entered_by:userId,entered_at:new Date().toISOString()},state:"pending"});fields.add(field);added++;
  }
  if(!added) throw new Error("Enter a figure first.");
  data.target={form:z.enum(itrReturns).parse(form),version:context.template.version};
  if(!await saveDraft({id,firm_id:membership.firmId,client_id:client,form_code:"ITR",period_key:period,revision:row?.revision ?? 0},data,userId,row ? "dataset.changed" : "dataset.created",{entered:added},permission)) throw new Error("The figures changed. Try again.");
  return id;
}
export function itrField(entry:ItrEntry,rows:number[]) {let at=0;return entry.field.replaceAll("*",()=>String(rows[at++] ?? 0));}
