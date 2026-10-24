import { z } from "zod";
import type { Json } from "@/src/db/types";
import { serverCrypto } from "./crypto";
import { supabaseAdmin } from "./supabase";

const source = z.object({document:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),page:z.number().int().min(1).max(30),sheet:z.number().int().min(1).max(100).optional(),cell:z.string().regex(/^[A-Z]([1-9][0-9]{0,2}|100[0-4])$/).optional(),path:z.string().startsWith("/").max(256).optional(),reader:z.string().regex(/^gstr2b-v4\.[45]$/).optional()}).refine((s)=>!!s.sheet===!!s.cell && (!s.cell || s.page===Math.ceil(Number(s.cell.replace(/^[A-Z]/,""))/40)));
export const draftSchema = z.object({
  lines:z.array(z.object({id:z.uuid(),field:z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/),value_enc:z.string().min(20).max(20000),source,state:z.enum(["pending","confirmed","rejected"]),by:z.uuid().optional(),at:z.iso.datetime().optional()}).refine((line)=>line.state==="pending" || !!line.by && !!line.at)).min(1).max(10000),
  checks:z.array(z.discriminatedUnion("kind",[
    z.object({kind:z.literal("sum"),parts:z.array(z.uuid()).min(1).max(10000),total:z.uuid()}),
    z.object({kind:z.literal("tax"),base:z.uuid(),rate:z.uuid(),total:z.uuid()}),
  ])).max(1000),
  edits:z.record(z.uuid(),z.record(z.uuid(),z.object({base:z.string(),value_enc:z.string().max(20000)}))).optional(),
  // The client's GST number a register belongs to, when the client has more than one.
  registration:z.uuid().optional(),
});
export type Draft = z.infer<typeof draftSchema>;
export const figureSchema=z.object({label:z.string().min(1).max(120),value:z.string().max(2000),kind:z.enum(["number","text","date"]).optional()});
export type Figure = z.infer<typeof figureSchema>;
export function checkValue(figure:Figure) {
  figureSchema.parse(figure);
  if(!figure.kind || figure.kind==="number") hundredths(figure.value);
  else if(figure.kind==="date" && (!/^\d{4}-\d{2}-\d{2}$/.test(figure.value) || new Date(figure.value).toISOString().slice(0,10)!==figure.value)) throw new Error("Enter a valid date.");
  else if(!figure.value.trim()) throw new Error("Enter a value.");
}
export const place = (draft:string,line:string)=>`datasets/${draft}/lines/${line}`;

// Decimal strings become integer hundredths; no floating point money or silent rounding.
export function hundredths(value:string) {
  if (!/^-?\d{1,13}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a number with up to two decimal places.");
  const [whole,fraction=""]=value.replace("-","").split(".");
  const number=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));
  return value.startsWith("-") ? -number : number;
}
const amount=hundredths;
export function checkFigures(draft:Draft,figures:Map<string,Figure>) {
  const lines=new Map(draft.lines.map((line)=>[line.id,line]));
  const ids=new Set(lines.keys());
  if(ids.size!==draft.lines.length || new Set(draft.lines.map((line)=>line.field)).size!==draft.lines.length) throw new Error("Repeated figure");
  const read=(id:string)=>{
    const line=lines.get(id),figure=figures.get(id);
    if(!line || !figure || line.state==="rejected") throw new Error("Missing figure");
    return amount(figure.value);
  };
  return draft.checks.flatMap((check,index)=>{
    try {
      let expected:bigint;
      if(check.kind==="sum") expected=check.parts.reduce((sum,id)=>sum+read(id),BigInt(0));
      else {
        const product=read(check.base)*read(check.rate),sign=product<BigInt(0) ? BigInt(-1) : BigInt(1);
        expected=sign*((product*sign+BigInt(5000))/BigInt(10000));
      }
      return expected===read(check.total) ? [] : [`${figures.get(check.total)?.label ?? `Check ${index+1}`}: the figures do not add up.`];
    } catch {return [`Check ${index+1}: a required figure is missing or rejected.`];}
  });
}
export async function openFigures(firm:string,id:string,draft:Draft) {
  const crypto=serverCrypto();
  const values=new Map<string,Figure>();
  for(const line of draft.lines) {
    const figure=figureSchema.parse(JSON.parse(await crypto.decrypt(firm,place(id,line.id),line.value_enc)));
    checkValue(figure);values.set(line.id,figure);
  }
  return values;
}
// All later generators use this gate, including drafts with no arithmetic checks.
export async function confirmedFigures(firm:string,id:string,data:unknown) {
  const draft=draftSchema.parse(data);
  const {data:row}=await supabaseAdmin().from("datasets").select("client_id").eq("firm_id",firm).eq("id",id).single();
  if(!row) throw new Error("Draft not found");
  await verifySources(firm,row.client_id,draft);
  const figures=await openFigures(firm,id,draft);
  if(draft.lines.some((line)=>line.state!=="confirmed") || checkFigures(draft,figures).length) throw new Error("Every figure must pass the check first.");
  return new Map(draft.lines.map((line)=>[line.field,figures.get(line.id)!]));
}
export async function saveDraft(row:{id:string;firm_id:string;client_id:string;form_code:string;period_key:string;revision:number},data:Draft,person:string|null,event:string,audit:Json,permission:string|null=null) {
  if(person===null && permission) throw new Error("Automatic reads cannot use a person's permission.");
  draftSchema.parse(data);
  await verifySources(row.firm_id,row.client_id,data);
  if(JSON.stringify(data).length>5_000_000) throw new Error("Split these figures into smaller drafts.");
  const common={draft:row.id,firm:row.firm_id,client:row.client_id,form:row.form_code,period:row.period_key,body:data as unknown as Json};
  const {data:saved,error}=person===null ? await (row.revision===0 ? supabaseAdmin().rpc("create_automatic_dataset",common) : supabaseAdmin().rpc("append_automatic_dataset",{...common,expected:row.revision})) : await supabaseAdmin().rpc("save_dataset",{...common,expected:row.revision,person,event,audit,...(permission ? {permission} : {})});
  if(error) throw new Error("The figures could not be saved.");
  return saved===true;
}

export async function verifySources(firm:string,client:string,draft:Draft) {
  const ids=[...new Set(draft.lines.map((line)=>line.source.document))];
  if(ids.length>100) throw new Error("Split these source files into smaller drafts.");
  const {data,error}=await supabaseAdmin().from("documents").select("id,name,sha256").eq("firm_id",firm).eq("client_id",client).in("status",["filed","to_check"]).in("id",ids);
  if(error || data?.length!==ids.length || data.some((doc)=>! /\.(pdf|xlsx|xls|csv|json)$/i.test(doc.name)) || draft.lines.some((line)=>data.find((doc)=>doc.id===line.source.document)?.sha256!==line.source.sha256)) throw new Error("A source file is not available.");
}

// Called by the document jobs, never with email text. Source ids are checked before saving.
export async function createDraft(input:{id:string;firm_id:string;client_id:string;form_code:string;period_key:string;lines:(Figure & {id:string;field:string;source:Draft["lines"][number]["source"]})[];checks:Draft["checks"];registration?:string},person:string|null,permission:string|null=null) {
  const crypto=serverCrypto(),lines:Draft["lines"]=[];
  for(const line of input.lines) {
    checkValue(line);
    lines.push({id:line.id,field:line.field,value_enc:await crypto.encrypt(input.firm_id,place(input.id,line.id),JSON.stringify({label:line.label,value:line.value,kind:line.kind})),source:line.source,state:"pending"});
  }
  return saveDraft({...input,revision:0},{lines,checks:input.checks,...(input.registration && {registration:input.registration})},person,"dataset.created",{},permission);
}
