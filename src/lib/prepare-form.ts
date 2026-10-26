import {z} from "zod";
import {currentMember,currentWriter} from "./member";
import {confirmedFigures,draftSchema} from "./datasets";
import {serverCrypto} from "./crypto";
import {grantFor} from "./permission-grants";
import {chooseTemplate,templateSchema} from "./templates";
import {formLimit,formRequest,type FormRequest} from "./form-worker";
import {signView} from "./file-worker";
import {officialLink} from "./official-files";

type Work={client:string;registration?:string;form:string;period:string;version?:string;reason?:string};
export async function formContext(input:Work,edit=true) {
  z.uuid().parse(input.client);if(input.registration) z.uuid().parse(input.registration);
  const {supabase,membership,userId}=edit ? await currentWriter() : await currentMember();
  if(!membership) throw new Error("Sign in to your firm first.");
  const permission=edit && !membership.may("edit_figures",input.client) ? await grantFor(membership.firmId,userId,"edit_figures",input.client) : null;
  if(edit && !membership.may("edit_figures",input.client) && !permission) throw new Error("Ask for permission to prepare a return.");
  const itr=/^ITR[1-6]$/.test(input.form),kind=itr ? "pan" : "gstin";
  const [{data:client},{data:registrations},{data:templates}]=await Promise.all([
    supabase.from("clients").select("id,name").eq("firm_id",membership.firmId).eq("id",input.client).maybeSingle(),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",input.client).eq("kind",kind),
    supabase.from("templates").select("*").eq("form_code",input.form),
  ]);
  const registration=input.registration ? registrations?.find(row=>row.id===input.registration) : registrations?.length===1 ? registrations[0] : null;
  if(!client || !registration) throw new Error("This return could not be found. Open the page again.");
  if(itr && registrations?.length!==1) throw new Error("Keep only one PAN for this client before preparing this return.");
  const template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),input.form,input.period,input.version,input.reason);
  const number=await serverCrypto().decrypt(membership.firmId,`clients/${input.client}/${kind}`,registration.number_enc);
  return {supabase,membership,userId,permission,client,registration,registrations:registrations?.length ?? 0,template,period:input.period,number,itr};
}
export function requestFor(context:Awaited<ReturnType<typeof formContext>>,drafts:FormRequest["drafts"],purpose:FormRequest["purpose"]="prepare") {
  return formRequest.parse({purpose,firm:context.membership.firmId,client:context.client.id,registration:context.registration.id,...(context.itr ? {pan:context.number} : {gstin:context.number}),period:context.period,template:context.template,drafts,expires:Math.floor(Date.now()/1000)+60});
}

// The caller spends a one-use permission atomically when saving the prepared form.
export async function checkedForm(input:Work & {registration:string;drafts:string[]}) {
  z.array(z.uuid()).min(1).max(25).parse(input.drafts);
  if(new Set(input.drafts).size!==input.drafts.length) throw new Error("Choose each set of figures once.");
  const context=await formContext(input),{supabase,membership,userId,permission}=context;
  // GSTR-3B is built from the month's GSTR-1 figures and its GSTR-2B credit.
  const {data:rows}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",input.client).in("form_code",context.itr ? ["ITR"] : input.form==="GSTR3B" ? ["GSTR1","GSTR3B"] : [input.form]).eq("period_key",input.period).in("id",input.drafts);
  if(rows?.length!==input.drafts.length) throw new Error("This return could not be found. Open the page again.");
  // Existing registers have no registration choice. Never guess in a multi-number client.
  // Each register must name this GST number, or the client must have only one.
  const named=(row:{data:unknown})=>(row.data as {registration?:string} | null)?.registration;
  if(!context.itr && (input.form==="GSTR1" ? rows : rows.filter(row=>row.form_code==="GSTR1")).some(row=>named(row) ? named(row)!==context.registration.id : context.registrations!==1))
    throw new Error("Choose the GSTIN for each register of this client before preparing the return.");
  const drafts=[];
  for(const row of rows) {
    if(context.itr && draftSchema.parse(row.data).target?.form && draftSchema.parse(row.data).target!.form!==input.form) throw new Error("Choose the figures for this return.");
    drafts.push({id:row.id,revision:row.revision,figures:[...await confirmedFigures(membership.firmId,row.id,row.data)]});
  }
  return {request:requestFor(context,drafts),permission,userId};
}

export async function workerForm(request:FormRequest) {
  if(!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) throw new Error("InboxCA cannot prepare returns yet. Try again later.");
  const body=JSON.stringify(formRequest.parse({...request,official:await officialLink(request.template.source)}));
  if(body.length>formLimit) throw new Error("This return is too large. Split its registers into smaller files.");
  const response=await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/,"")}/prepare/${request.template.form_code}`,{method:"POST",headers:{Authorization:await signView(body,process.env.FILE_WORKER_SECRET),"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(120_000)});
  // The form maker says why the figures failed (worker/handler.ts); that sentence is shown.
  if(!response.ok || !response.body) throw new Error(response.status===422 && (await response.text()).trim().slice(0,300) || "The figures do not pass the official form's checks.");
  return response;
}
