import {randomUUID} from "node:crypto";
import {z} from "zod";
import {checkValue,createDraft,draftSchema,openFigures,place,saveDraft,verifySources,type Draft,type Figure} from "./datasets";
import {serverCrypto} from "./crypto";
import {supabaseAdmin} from "./supabase";
import {workerSheet} from "./worker-read";
import {sameHeadings} from "./sales-register";
import {todayInIndia} from "./calendar";
import type {FormRequest} from "./form-worker";
import {checkStatement,deductorSchema,detailsPlace,extractTds,readStatement,statementFile,tdsField,tdsFields,tdsForms,tdsMappingPlace,tdsMappingSchema,tdsName,type Deductor,type TdsForm,type TdsMapping} from "./tds";

type Db=ReturnType<typeof supabaseAdmin>;

export async function savedTdsMappings(firm:string,client:string) {
  const {data}=await supabaseAdmin().from("clients").select("tds_mapping_enc").eq("firm_id",firm).eq("id",client).single();
  return data?.tds_mapping_enc ? z.array(tdsMappingSchema).max(20).parse(JSON.parse(await serverCrypto().decrypt(firm,tdsMappingPlace(client),data.tds_mapping_enc))) : [];
}

// A register's figures for the quarter, a draft for the TAN, read under the columns a person
// confirmed; the columns are remembered for the client's next register (as src/lib/sales-draft.ts).
export async function readTdsRegister(document:{id:string;firm_id:string;client_id:string;name:string;sha256:string},work:{form:TdsForm;period:string;registration:string;mapping:TdsMapping},person:string,permission:string|null) {
  const admin=supabaseAdmin(),{firm_id:firm,client_id:client}=document;
  const {data:existing}=await admin.from("datasets").select("id").eq("firm_id",firm).eq("client_id",client).eq("id",document.id).maybeSingle();
  if(existing) throw new Error("This register is read already. Correct its figures under Figures, or add a corrected file.");
  if(![tdsForms[work.form].kind,"challans"].includes(work.mapping.kind)) throw new Error("Choose the register again.");
  const rows=await workerSheet(firm,document),mapping=tdsMappingSchema.parse({...work.mapping,headings:rows[work.mapping.header] ?? []});
  const lines=extractTds(rows,mapping).map(line=>({...line,id:randomUUID(),source:{document:document.id,sha256:document.sha256,page:Math.ceil(line.row/40),sheet:1,cell:`${String.fromCharCode(65+line.column)}${line.row}`}}));
  if(!await createDraft({id:document.id,firm_id:firm,client_id:client,form_code:work.form,period_key:work.period,lines,checks:[],registration:work.registration},person,permission)) throw new Error("The figures changed or permission expired. Open the page again.");
  for(let attempt=0;attempt<3;attempt++) {
    const {data:previous}=await admin.from("clients").select("tds_mapping_enc").eq("firm_id",firm).eq("id",client).single();
    if(!previous) throw new Error("Client not found");
    const current=previous.tds_mapping_enc ? z.array(tdsMappingSchema).parse(JSON.parse(await serverCrypto().decrypt(firm,tdsMappingPlace(client),previous.tds_mapping_enc))) : [];
    const enc=await serverCrypto().encrypt(firm,tdsMappingPlace(client),JSON.stringify([mapping,...current.filter(map=>map.kind!==mapping.kind || !sameHeadings(map.headings,mapping.headings))].slice(0,20)));
    const update=admin.from("clients").update({tds_mapping_enc:enc}).eq("firm_id",firm).eq("id",client);
    const {data:changed,error}=await (previous.tds_mapping_enc ? update.eq("tds_mapping_enc",previous.tds_mapping_enc) : update.is("tds_mapping_enc",null)).select("id").maybeSingle();
    if(error) throw new Error("The figures were saved, but the column choices could not be remembered.");
    if(changed) return document.id;
  }
  throw new Error("Column choices changed. Open the page again.");
}

// The deductor's details on the client's TAN, read as the signed in person may see them.
export async function deductorOf(db:Db,firm:string,client:string,registration:string) {
  const {data}=await db.from("client_registrations").select("details_enc").eq("firm_id",firm).eq("client_id",client).eq("id",registration).eq("kind","tan").maybeSingle();
  return data?.details_enc ? deductorSchema.parse(JSON.parse(await serverCrypto().decrypt(firm,detailsPlace(client,registration),data.details_enc))) : null;
}
export const sealDeductor=(firm:string,client:string,registration:string,details:Deductor)=>serverCrypto().encrypt(firm,detailsPlace(client,registration),JSON.stringify(deductorSchema.parse(details)));

// The TAN, and the deductor's PAN: the client's one PAN, else PANNOTREQD (row 58), which only a
// government deductor may use.
async function numbers(db:Db,firm:string,client:string,registration:string) {
  const {data}=await db.from("client_registrations").select("id,kind,number_enc").eq("firm_id",firm).eq("client_id",client).in("kind",["tan","pan"]);
  const tan=data?.find(row=>row.id===registration && row.kind==="tan"),pans=(data ?? []).filter(row=>row.kind==="pan");
  if(!tan) throw new Error("This TAN is not one of the client's numbers.");
  const open=(row:{kind:string;number_enc:string})=>serverCrypto().decrypt(firm,`clients/${client}/${row.kind}`,row.number_enc);
  return {tan:await open(tan),pan:pans.length===1 ? await open(pans[0]) : pans.length ? "" : "PANNOTREQD"};
}

// Everything the statement page shows for one form, TAN and quarter: the drafts and their figures,
// the statement read from them and its checks, as the signed in person may see them.
export async function tdsWork(db:Db,firm:string,client:string,registration:string,period:string,form:TdsForm) {
  const {data:rows,error}=await db.from("datasets").select("id,revision,data,client_id,form_code,period_key,firm_id").eq("firm_id",firm).eq("client_id",client).eq("form_code",form).eq("period_key",period).eq("data->>registration",registration).order("id").limit(25);
  if(error) throw new Error("The figures could not be read.");
  const drafts=[];
  for(const row of rows ?? []) {const data=draftSchema.parse(row.data);drafts.push({...row,data,figures:await openFigures(firm,row.id,data)});}
  const [{tan,pan},deductor]=await Promise.all([numbers(db,firm,client,registration),deductorOf(db,firm,client,registration)]);
  const read=readStatement(drafts.map(draft=>({id:draft.id,lines:draft.data.lines.filter(line=>line.state!=="rejected").map(line=>({id:line.id,field:line.field,value:draft.figures.get(line.id)!.value}))})));
  const today=todayInIndia(),check=checkStatement({form,tan,pan,deductor,period,today,...read});
  return {drafts,tan,pan,deductor,read,check,today};
}

// The statement file, made only from the checked figures of a prepare request and the TAN's
// details; any rule the figures or details break stops it, in the CA's words.
export async function statementBytes(request:FormRequest) {
  const admin=supabaseAdmin(),[{tan,pan},deductor]=await Promise.all([numbers(admin,request.firm,request.client,request.registration),deductorOf(admin,request.firm,request.client,request.registration)]);
  if(tan!==request.tan) throw new Error("This TAN changed. Open the page again.");
  const read=readStatement(request.drafts.map(draft=>({id:draft.id,lines:draft.figures.map(([field,figure])=>({id:`${draft.id}:${field}`,field,value:figure.value}))})));
  const form=request.template.form_code as TdsForm,today=todayInIndia(),check=checkStatement({form,tan,pan,deductor,period:request.period,today,...read});
  if(check.errors.length) throw new Error("This statement does not pass its checks yet. Correct the figures listed on the statement page first.");
  return new TextEncoder().encode(statementFile({form,tan,pan,deductor:deductor!,period:request.period,previous:read.previous,token:read.token,today,challans:check.challans}));
}

// Challans and the statement's answers typed by the team go in the quarter's own draft for the
// TAN, as an income tax return's entries do (src/lib/itr.ts): the form gives values only; labels,
// source and person come from the server, and each figure waits for its check.
const challanKinds:Record<string,Figure["kind"]>={bsr:"text",date:"date",number:"text",tax:"number",interest:"number",fee:"number",others:"number",minor:"text"};
export async function enterTds(db:Db,who:{firm:string;userId:string;permission:string|null},client:string,registration:string,period:string,form:TdsForm,input:FormData) {
  const {data:rows,error}=await db.from("datasets").select("*").eq("firm_id",who.firm).eq("client_id",client).eq("form_code",form).eq("period_key",period).eq("data->>registration",registration).limit(25);
  if(error) throw new Error("The figures could not be read.");
  const row=(rows ?? []).find(item=>draftSchema.parse(item.data).lines.some(line=>line.source.entered_by));
  if(row && row.revision!==Number(input.get("revision"))) throw new Error("These figures changed. Open the page again.");
  const id=row?.id ?? randomUUID(),data:Draft=row ? draftSchema.parse(row.data) : {lines:[],checks:[],registration};
  const fields=new Set(data.lines.map(line=>line.field)),added:{field:string;figure:Figure}[]=[];
  const answer=String(input.get("previous") ?? "");
  if(answer) {
    if(fields.has("tds.s.previous")) throw new Error("This answer is saved already. Correct it under Figures.");
    if(!["Y","N"].includes(answer)) throw new Error("Choose Yes or No.");
    added.push({field:"tds.s.previous",figure:{label:`Regular ${tdsName(form)} filed for an earlier quarter`,value:answer,kind:"text"}});
    const token=String(input.get("token") ?? "").trim();
    if(answer==="Y") {
      if(!/^\d{15}$/.test(token)) {const label=tdsName(form);throw new Error(`Give the 15 digit token number of the last regular ${label} filed.`);}
      added.push({field:"tds.s.token",figure:{label:`Token number of the last regular ${tdsName(form)}`,value:token,kind:"text"}});
    }
  }
  if(input.get("bsr")!==null) {
    const next=1+Math.max(0,...data.lines.flatMap(line=>/^tds\.c(\d+)\./.exec(line.field)?.[1] ?? []).map(Number));
    for(const [key,name] of tdsFields.challans) {
      const value=String(input.get(key) ?? "").trim().replaceAll(",","");
      if(value) added.push({field:tdsField("c",next,key),figure:{label:`${name}, challan ${next}`,value,kind:challanKinds[key]}});
    }
  }
  if(!added.length) throw new Error("Enter the challan or the answer first.");
  for(const {field,figure} of added) {
    checkValue(figure);
    const line=randomUUID();
    data.lines.push({id:line,field,value_enc:await serverCrypto().encrypt(who.firm,place(id,line),JSON.stringify(figure)),source:{entered_by:who.userId,entered_at:new Date().toISOString()},state:"pending"});
  }
  if(!await saveDraft({id,firm_id:who.firm,client_id:client,form_code:form,period_key:period,revision:row?.revision ?? 0},data,who.userId,row ? "dataset.changed" : "dataset.created",{entered:added.length},who.permission)) throw new Error("The figures changed. Try again.");
  return id;
}

// One Yes for the quarter's figures once they pass every rule of the format: every row not
// flagged for a person's own look is checked at once, with the totals seen kept (encrypted) in
// the firm's activity, as a GST register section is (approveSection in dataset-actions.ts).
export async function checkAllTds(db:Db,firm:string,userId:string,client:string,registration:string,period:string,form:TdsForm,revisions:Map<string,number>) {
  const work=await tdsWork(db,firm,client,registration,period,form);
  if(work.check.errors.length) throw new Error("Correct the figures the checks list first.");
  if(work.drafts.some(draft=>revisions.get(draft.id)!==draft.revision) || revisions.size!==work.drafts.length) throw new Error("Someone changed these figures. Look at them again.");
  for(const draft of work.drafts) await verifySources(firm,client,draft.data).catch(()=>{throw new Error("A paper these figures came from is not available. Ask the owner to restore it.");});
  // A flagged row is all of its lines; rows marked wrong are flagged too.
  const rowOf=new Map<string,string[]>();
  for(const draft of work.drafts) for(const line of draft.data.lines) {
    const hit=/^tds\.([pc]\d+)\./.exec(line.field),key=`${draft.id}|${hit?.[1] ?? line.field}`;
    rowOf.set(key,[...(rowOf.get(key) ?? []),line.id]);
  }
  const keyOf=new Map<string,string>();
  for(const [key,lines] of rowOf) for(const line of lines) keyOf.set(line,key);
  const flagged=new Set(work.check.warnings.flatMap(issue=>issue.line ? [keyOf.get(issue.line) ?? ""] : []));
  for(const draft of work.drafts) for(const line of draft.data.lines) if(line.state==="rejected") flagged.add(keyOf.get(line.id)!);
  const at=new Date().toISOString(),total=work.read.payments.reduce((sum,pay)=>sum+pay.tds,BigInt(0));
  let checked=0;
  for(const draft of work.drafts) {
    const data=structuredClone(draft.data);let changed=0;
    for(const line of data.lines) if(line.state==="pending" && !flagged.has(keyOf.get(line.id)!)) {line.state="confirmed";line.by=userId;line.at=at;changed++;}
    if(!changed) continue;
    const totals_enc=await serverCrypto().encrypt(firm,`${place(draft.id,"tds")}/totals/${draft.revision}`,JSON.stringify({payments:work.read.payments.length,challans:work.read.challans.length,tds:String(total)}));
    if(!await saveDraft(draft,data,userId,"dataset.checked",{section:"tds",rows:new Set(data.lines.map(line=>keyOf.get(line.id))).size,flagged:flagged.size,totals_enc})) throw new Error("Someone changed these figures. Look at them again.");
    checked+=changed;
  }
  return {checked,flagged:flagged.size};
}

// The day the daily forms check found the form's format with a changed layout, while Orelu's
// admin has not yet reviewed it (src/jobs/forms-watch.ts, sources protean_form140 and the
// others); else null.
export async function formatChanged(form:TdsForm) {
  const {data}=await supabaseAdmin().from("platform_settings").select("value").eq("key","watch").maybeSingle();
  const changes=((data?.value ?? {}) as {changes?:{source?:string;status?:string;at?:string;compared?:{differences?:string[]}[]}[]}).changes ?? [];
  return changes.filter(change=>change.source===`protean_form${tdsForms[form].number}` && change.status==="draft" && change.compared?.some(kept=>kept.differences?.length)).at(-1)?.at?.slice(0,10) ?? null;
}
