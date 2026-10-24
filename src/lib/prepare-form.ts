import {z} from "zod";
import {currentWriter} from "./member";
import {confirmedFigures} from "./datasets";
import {serverCrypto} from "./crypto";
import {grantFor} from "./permission-grants";
import {chooseTemplate,templateSchema} from "./templates";
import {formLimit,formRequest,type FormRequest} from "./form-worker";
import {signView} from "./file-worker";

// The caller spends a one-use permission atomically when saving the prepared form.
export async function checkedForm(input:{client:string;registration:string;form:string;period:string;drafts:string[];version?:string;reason?:string}) {
  z.uuid().parse(input.client);z.uuid().parse(input.registration);z.array(z.uuid()).min(1).max(25).parse(input.drafts);
  if(new Set(input.drafts).size!==input.drafts.length) throw new Error("Choose each source once.");
  const {supabase,membership,userId}=await currentWriter();
  if(!membership) throw new Error("Sign in to your firm first.");
  const permission=membership.may("edit_figures", input.client) ? null : await grantFor(membership.firmId,userId,"edit_figures",input.client);
  if(!membership.may("edit_figures", input.client) && !permission) throw new Error("Ask for permission to prepare a form.");
  const [{data:client},{data:registrations},{data:rows},{data:templates}]=await Promise.all([
    supabase.from("clients").select("id").eq("firm_id",membership.firmId).eq("id",input.client).maybeSingle(),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",input.client).eq("kind","gstin"),
    // GSTR-3B is built from the month's GSTR-1 figures and its GSTR-2B credit.
    supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",input.client).in("form_code",input.form==="GSTR3B" ? ["GSTR1","GSTR3B"] : [input.form]).eq("period_key",input.period).in("id",input.drafts),
    supabase.from("templates").select("*").eq("form_code",input.form),
  ]);
  const registration=registrations?.find(row=>row.id===input.registration);
  if(!client || !registration || rows?.length!==input.drafts.length) throw new Error("The work could not be found.");
  // Existing registers have no registration choice. Never guess in a multi-number client.
  if((input.form==="GSTR1" || rows?.some(row=>row.form_code==="GSTR1")) && registrations?.length!==1) throw new Error("This client's registers need a GST number choice before a form can be prepared.");
  const template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),input.form,input.period,input.version,input.reason);
  const gstin=await serverCrypto().decrypt(membership.firmId,`clients/${input.client}/gstin`,registration.number_enc);
  const drafts=[];
  for(const row of rows) drafts.push({id:row.id,revision:row.revision,figures:[...await confirmedFigures(membership.firmId,row.id,row.data)]});
  const request=formRequest.parse({purpose:"prepare",firm:membership.firmId,client:input.client,registration:registration.id,gstin,period:input.period,template,drafts,expires:Math.floor(Date.now()/1000)+60});
  return {request,permission,userId};
}

export async function workerForm(request:FormRequest) {
  if(!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) throw new Error("The form maker is not ready yet.");
  const body=JSON.stringify(formRequest.parse(request));
  if(body.length>formLimit) throw new Error("Split this work into smaller registers.");
  const response=await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/,"")}/prepare/${request.template.form_code}`,{method:"POST",headers:{Authorization:await signView(body,process.env.FILE_WORKER_SECRET),"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(120_000)});
  if(!response.ok || !response.body) throw new Error("The figures do not pass the official form's checks.");
  return response;
}
