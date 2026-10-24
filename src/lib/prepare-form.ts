import {z} from "zod";
import {currentWriter} from "./member";
import {confirmedFigures,draftSchema} from "./datasets";
import {serverCrypto} from "./crypto";
import {grantFor} from "./permission-grants";
import {chooseTemplate,templateSchema} from "./templates";
import {formLimit,formRequest,type FormRequest} from "./form-worker";
import {signView} from "./file-worker";

type Work={client:string;registration?:string;form:string;period:string;version?:string;reason?:string};
export async function formContext(input:Work,edit=true) {
  z.uuid().parse(input.client);if(input.registration) z.uuid().parse(input.registration);
  const {supabase,membership,userId}=await currentWriter();
  if(!membership) throw new Error("Sign in to your firm first.");
  const permission=edit && !membership.may("edit_figures",input.client) ? await grantFor(membership.firmId,userId,"edit_figures",input.client) : null;
  if(edit && !membership.may("edit_figures",input.client) && !permission) throw new Error("Ask for permission to prepare a form.");
  const itr=/^ITR[1-6]$/.test(input.form),kind=itr ? "pan" : "gstin";
  const [{data:client},{data:registrations},{data:templates}]=await Promise.all([
    supabase.from("clients").select("id,name").eq("firm_id",membership.firmId).eq("id",input.client).maybeSingle(),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",input.client).eq("kind",kind),
    supabase.from("templates").select("*").eq("form_code",input.form),
  ]);
  const registration=input.registration ? registrations?.find(row=>row.id===input.registration) : registrations?.length===1 ? registrations[0] : null;
  if(!client || !registration) throw new Error("The work could not be found.");
  if(input.form==="GSTR1" && registrations?.length!==1) throw new Error("This client's registers need a GST number choice before a form can be prepared.");
  if(itr && registrations?.length!==1) throw new Error("Choose a single PAN before preparing this form.");
  const template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),input.form,input.period,input.version,input.reason);
  const number=await serverCrypto().decrypt(membership.firmId,`clients/${input.client}/${kind}`,registration.number_enc);
  return {supabase,membership,userId,permission,client,registration,template,period:input.period,number,itr};
}
export function requestFor(context:Awaited<ReturnType<typeof formContext>>,drafts:FormRequest["drafts"],purpose:FormRequest["purpose"]="prepare") {
  return formRequest.parse({purpose,firm:context.membership.firmId,client:context.client.id,registration:context.registration.id,...(context.itr ? {pan:context.number} : {gstin:context.number}),period:context.period,template:context.template,drafts,expires:Math.floor(Date.now()/1000)+60});
}

// The caller spends a one-use permission atomically when saving the prepared form.
export async function checkedForm(input:Work & {registration:string;drafts:string[]}) {
  z.array(z.uuid()).min(1).max(25).parse(input.drafts);
  if(new Set(input.drafts).size!==input.drafts.length) throw new Error("Choose each source once.");
  const context=await formContext(input),{supabase,membership,userId,permission}=context;
  const {data:rows}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",input.client).eq("form_code",context.itr ? "ITR" : input.form).eq("period_key",input.period).in("id",input.drafts);
  if(rows?.length!==input.drafts.length) throw new Error("The work could not be found.");
  const drafts=[];
  for(const row of rows) {
    if(context.itr && draftSchema.parse(row.data).target?.form && draftSchema.parse(row.data).target!.form!==input.form) throw new Error("Choose the figures for this return.");
    drafts.push({id:row.id,revision:row.revision,figures:[...await confirmedFigures(membership.firmId,row.id,row.data)]});
  }
  return {request:requestFor(context,drafts),permission,userId};
}

export async function workerForm(request:FormRequest) {
  if(!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) throw new Error("The form maker is not ready yet.");
  const body=JSON.stringify(formRequest.parse(request));
  if(body.length>formLimit) throw new Error("Split this work into smaller registers.");
  const response=await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/,"")}/prepare/${request.template.form_code}`,{method:"POST",headers:{Authorization:await signView(body,process.env.FILE_WORKER_SECRET),"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(120_000)});
  if(!response.ok || !response.body) throw new Error("The figures do not pass the official form's checks.");
  return response;
}
