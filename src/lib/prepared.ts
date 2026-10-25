import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import type {Json} from "@/src/db/types";
import type {FormRequest} from "./form-worker";
import {checkedForm,workerForm} from "./prepare-form";
import {currentWriter} from "./member";
import {supabaseAdmin} from "./supabase";
import {openDrive} from "./drive-account";
import {financialYear,safeName} from "./drive";
import {periodName} from "./documents";
import {itrReturns,itrYear} from "./itr-fields";
import {serverCrypto} from "./crypto";
import {createDraft} from "./datasets";
import {workerRead} from "./worker-read";
import {grantFor} from "./permission-grants";
import {chooseTemplate,templateSchema} from "./templates";

export const preparedSchema=z.object({form:z.enum(["GSTR1","GSTR3B",...itrReturns]),registration:z.uuid(),version:z.number().int().positive(),template:z.string(),sources:z.array(z.object({id:z.uuid(),revision:z.number().int().positive()})).min(1).max(25),status:z.enum(["draft","approved","filed","rejected"]),acknowledgement:z.uuid().nullable().optional(),external:z.boolean().optional()});
export type Prepared=z.infer<typeof preparedSchema>;
export const formName=(form:string)=>/^ITR[1-6]$/.test(form) ? form.replace("ITR","ITR-") : form==="GSTR1" ? "GSTR-1" : "GSTR-3B";

const formPeriod=(period:string)=>period.length===4 ? itrYear(period) : periodName(period);
const workFolder=(period:string)=>period.length===4 ? "Income tax" : "GST";
const workYear=(period:string)=>financialYear(period.length===4 ? `${period}-03` : period);

export async function prepareDocument(input:Parameters<typeof checkedForm>[0]) {
  const {request,permission,userId}=await checkedForm(input);
  return savePrepared(request,userId,permission,input.reason);
}

// Also used by a checked correction job. All its sources still pass the same gate.
export async function savePrepared(request:FormRequest,userId:string,permission:string|null=null,reason?:string) {
  const admin=supabaseAdmin();
  const [{data:client},{data:account}]=await Promise.all([
    admin.from("clients").select("name").eq("firm_id",request.firm).eq("id",request.client).single(),
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",request.firm).eq("kind","drive").maybeSingle(),
  ]);
  if(!client || !account) throw new Error("Connect the firm's drive before preparing a form.");
  // Refuse unavailable ITR exports before reserving a name in the drive.
  const itrResponse=request.pan ? await workerForm(request) : null;
  const sources=request.drafts.map(({id,revision})=>({id,revision})).sort((a,b)=>a.id.localeCompare(b.id));
  const {data:reserved,error}=await admin.rpc("reserve_form",{firm:request.firm,client:request.client,registration:request.registration,form:request.template.form_code,period:request.period,template:request.template.version,sources,person:userId,prefix:`${safeName(client.name,100)} - ${formName(request.template.form_code)} - ${formPeriod(request.period)}`,extension:request.template.mappings.format,choice:reason ? {reason_code:["amendment","software","correction"].includes(reason) ? reason : "other"} : {}});
  if(error || !reserved) throw new Error("These figures changed. Check them before preparing the form again.");
  const saved=z.object({id:z.uuid(),name:z.string(),ready:z.boolean()}).parse(reserved);
  if(saved.ready) return saved.id;
  const drive=await openDrive(request.firm,account);
  const response=itrResponse ?? await workerForm(request),bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length || bytes.length>25_000_000) throw new Error("This form is too large. Split its registers first.");
  const folder=await drive.ensureFolder([workFolder(request.period),workYear(request.period),safeName(client.name),"Prepared"]);
  const file=await drive.save(folder,saved.name,bytes);
  if(file==="taken") throw new Error("This form is already being prepared. Open the page again in a moment.");
  try {
    const {data:finished,error}=await admin.rpc("finish_form",{target:saved.id,firm:request.firm,person:userId,file:file.id,checksum:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,...(permission && {permission})});
    if(error || !finished) throw new Error("The figures or permission changed. Open the latest work and try again.");
  } catch(error) {await drive.trash(file.id);throw error;}
  return saved.id;
}

// A person may only act on a form their own database client can see.
export async function visibleForm(id:string) {
  z.uuid().parse(id);
  const member=await currentWriter();
  if(!member.membership) throw new Error("Sign in to your firm first.");
  const {data}=await member.supabase.from("documents").select("id,firm_id,client_id,name,period_key,size,prepared").eq("firm_id",member.membership.firmId).eq("id",id).neq("status","deleted").maybeSingle();
  if(!data?.prepared) throw new Error("This form is not available.");
  return {...member,membership:member.membership,document:{...data,prepared:preparedSchema.parse(data.prepared)}};
}

export async function recordFormDecision(id:string,decision:"approved"|"rejected",code:string,text:string) {
  const {document,userId,membership}=await visibleForm(id);
  const reason:Record<string,Json>={};
  if(decision==="rejected") {
    if(!["figures","source","other"].includes(code) || text.trim().length<3 || text.length>300) throw new Error("Choose a reason and say what needs to change.");
    reason.code=code;reason.text_enc=await serverCrypto().encrypt(membership.firmId,`documents/${id}/rejection`,text.trim());
  }
  const {data,error}=await supabaseAdmin().rpc("decide_form",{target:document.id,person:userId,decision,reason});
  if(error || !data) throw new Error("Another person must approve the latest checked figures. Your firm's owner, partner or the client's manager can do this.");
}

export async function fileForm(id:string,number:string,paper?:string,file?:File) {
  const {document,membership,userId,supabase}=await visibleForm(id),admin=supabaseAdmin();
  if(!membership.may("mark_filed",document.client_id)) throw new Error("Ask your firm's owner to let you record filing.");
  number=number.trim();
  if(number.length>80 || /[\r\n\x00-\x1f]/.test(number) || !number && !paper && !file?.size) throw new Error("Add the acknowledgement or its number.");
  const {data:ready}=await admin.rpc("form_ready",{target:id});
  if(!ready || document.prepared.status!=="approved") throw new Error("Check and approve this form first.");
  if(paper) {
    z.uuid().parse(paper);
    const {data:visible}=await supabase.from("documents").select("id").eq("firm_id",membership.firmId).eq("client_id",document.client_id).eq("id",paper).in("document_type",document.period_key.length===4 ? ["Acknowledgement","ITR-V"] : ["Acknowledgement"]).eq("period_key",document.period_key).eq("status","filed").maybeSingle();
    if(!visible) throw new Error("Choose this client's acknowledgement for the same period.");
  } else {
    const [{data:client},{data:account}]=await Promise.all([
      supabase.from("clients").select("name").eq("firm_id",membership.firmId).eq("id",document.client_id).single(),
      admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle(),
    ]);
    if(!client || !account) throw new Error("Connect the firm's drive first.");
    const uploaded=!!file?.size,extension=uploaded ? file!.name.split(".").pop()?.toLowerCase() : "txt";
    if(!extension || !["pdf","png","jpg","jpeg","txt"].includes(extension) || file && file.size>25_000_000) throw new Error("Choose a PDF or picture up to 25 MB.");
    const type=uploaded ? "Acknowledgement" : "Filing record";
    // This is the firm's record of a number, never a made-up portal acknowledgement.
    const bytes=uploaded ? new Uint8Array(await file!.arrayBuffer()) : new TextEncoder().encode(`Filing details recorded by ${membership.firmName}\nClient: ${client.name}\nForm: ${formName(document.prepared.form)}\nPeriod: ${formPeriod(document.period_key)}\nAcknowledgement number entered by your firm: ${number}\nThis is your firm's record. It is not the portal acknowledgement.\n`);
    const checksum=createHash("sha256").update(bytes).digest("hex");
    const {data:prior}=await admin.from("documents").select("id").eq("firm_id",membership.firmId).eq("client_id",document.client_id).eq("sha256",checksum).eq("document_type",type).eq("period_key",document.period_key).eq("status","filed").maybeSingle();
    paper=prior?.id;
    if(!paper) {
      const drive=await openDrive(membership.firmId,account),folder=await drive.ensureFolder([workFolder(document.period_key),workYear(document.period_key),safeName(client.name),"Prepared"]);
      const name=`${safeName(client.name,100)} - ${formName(document.prepared.form)} - ${formPeriod(document.period_key)} - ${type} - v${document.prepared.version}.${extension}`;
      const saved=await drive.save(folder,name,bytes);
      if(saved==="taken") throw new Error("An acknowledgement with this name is already in the drive. Choose it from Documents.");
      const {data:row,error}=await admin.from("documents").insert({firm_id:membership.firmId,client_id:document.client_id,name,document_type:type,work_type:document.period_key.length===4 ? "income_tax" : "gst",period_key:document.period_key,size:bytes.length,sha256:checksum,drive_file_id:saved.id,share_policy:null}).select("id").single();
      if(error || !row) {await drive.trash(saved.id);throw new Error("The acknowledgement could not be saved.");}
      paper=row.id;
      const {error:logError}=await admin.from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"document.added",entity_type:"document",entity_id:paper,details:{form:id,kind:uploaded ? "acknowledgement" : "filing_record"}});
      if(logError) throw new Error("The acknowledgement's history could not be saved.");
    }
  }
  const {data:saved,error}=await admin.rpc("file_prepared_form",{target:id,person:userId,acknowledgement:number,paper});
  if(error || !saved) throw new Error("The work changed. Open the latest form before marking it filed.");
}

export async function uploadEditedForm(id:string,file:File) {
  const {document,membership,userId,supabase}=await visibleForm(id),admin=supabaseAdmin();
  const permission=membership.may("edit_figures", document.client_id) ? null : await grantFor(membership.firmId,userId,"edit_figures",document.client_id);
  if(!membership.may("edit_figures", document.client_id) && !permission) throw new Error("Ask to edit figures first.");
  const meta=document.prepared,itr=meta.form.startsWith("ITR"),kind=itr ? "pan" : "gstin",extension=itr ? "json" : "xlsx";
  if(!(itr ? /\.json$/i : /\.xlsx$/i).test(file.name) || !file.size || file.size>25_000_000) throw new Error("Choose the filled official return, up to 25 MB.");
  const [{data:client},{data:account},{data:registration},{data:templates}]=await Promise.all([
    supabase.from("clients").select("name").eq("firm_id",membership.firmId).eq("id",document.client_id).single(),
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle(),
    supabase.from("client_registrations").select("number_enc").eq("firm_id",membership.firmId).eq("client_id",document.client_id).eq("id",meta.registration).eq("kind",kind).maybeSingle(),
    supabase.from("templates").select("*").eq("form_code",meta.form),
  ]);
  if(!client || !account || !registration) throw new Error("The form or the firm's drive is not available.");
  const template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),meta.form,document.period_key,meta.template,"edited outside");
  const number=await serverCrypto().decrypt(membership.firmId,`clients/${document.client_id}/${kind}`,registration.number_enc);
  const bytes=new Uint8Array(await file.arrayBuffer()),sha256=createHash("sha256").update(bytes).digest("hex"),target=randomUUID(),draft=randomUUID();
  const drive=await openDrive(membership.firmId,account),folder=await drive.ensureFolder([workFolder(document.period_key),workYear(document.period_key),safeName(client.name),"Prepared"]);
  const name=`Edited form ${target}.${extension}`,saved=await drive.save(folder,name,bytes);
  if(saved==="taken") throw new Error("Try adding the file again.");
  let attached=false;
  try {
    const {error}=await admin.from("documents").insert({id:target,firm_id:membership.firmId,client_id:document.client_id,name,document_type:formName(meta.form),work_type:document.period_key.length===4 ? "income_tax" : "gst",period_key:document.period_key,size:bytes.length,sha256,drive_file_id:saved.id,share_policy:"internal"});
    if(error) throw error;
    const result=z.object({lines:z.array(z.object({field:z.string(),label:z.string(),value:z.string(),kind:z.enum(["number","text","date"]),page:z.number(),sheet:z.number().optional(),cell:z.string().optional(),path:z.string().optional()})).min(1).max(10000)}).parse(await workerRead(membership.firmId,{id:target,name,sha256},"edited",{template:itr ? {...template,mappings:{format:"json"}} : template,period:document.period_key,...(itr ? {pan:number} : {gstin:number})}));
    const lines=result.lines.map(line=>({...line,id:randomUUID(),source:{document:target,sha256,page:line.page,...(itr ? {path:line.path} : {sheet:line.sheet,cell:line.cell})}}));
    if(!await createDraft({id:draft,firm_id:membership.firmId,client_id:document.client_id,form_code:itr ? "ITR" : meta.form,period_key:document.period_key,lines,checks:[],...(itr && {target:{form:z.enum(itrReturns).parse(meta.form),version:meta.template}})},userId,permission)) throw new Error("The figures could not be saved.");
    const {data:created,error:failed}=await admin.rpc("add_edited_form",{target,draft,registration:meta.registration,template:meta.template,person:userId,prefix:`${safeName(client.name,100)} - ${formName(meta.form)} - ${formPeriod(document.period_key)}`});
    if(failed || !created) throw new Error("The edited form could not be saved.");
    attached=true;
    const next=z.object({name:z.string()}).parse(created),moved=await drive.move(saved.id,folder,next.name);
    if(moved!=="taken") {
      const {error}=await admin.from("documents").update({drive_file_id:moved.id}).eq("firm_id",membership.firmId).eq("id",target);
      if(error) throw error;
    }
    return {id:target,draft};
  } catch(error) {
    if(!attached) {await admin.from("datasets").delete().eq("firm_id",membership.firmId).eq("id",draft);await admin.from("documents").delete().eq("firm_id",membership.firmId).eq("id",target);await drive.trash(saved.id);}
    throw error;
  }
}
