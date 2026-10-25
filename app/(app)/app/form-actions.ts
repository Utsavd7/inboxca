"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {fileForm,prepareDocument,recordFormDecision,uploadEditedForm,visibleForm} from "@/src/lib/prepared";
import {runJobsSoon} from "@/src/jobs/run-soon";
import {draftSchema,saveDraft} from "@/src/lib/datasets";
import {currentWriter} from "@/src/lib/member";
import {grantFor} from "@/src/lib/permission-grants";
import {itrReturns} from "@/src/lib/itr-fields";

export async function prepareForm(form:FormData) {
  const client=z.uuid().parse(form.get("client")),back=`/app/clients/${client}?tab=outputs`;
  let id:string;
  try {
    id=await prepareDocument({client,registration:String(form.get("registration")),form:z.enum(["GSTR1","GSTR3B",...itrReturns]).parse(form.get("form") ?? "GSTR1"),period:String(form.get("period")),drafts:form.getAll("draft").map(String),version:String(form.get("version") ?? "") || undefined,reason:String(form.get("reason") ?? "") || undefined});
  } catch {redirect(`${back}&form=check`);}
  revalidatePath("/app","layout");redirect(`/app/files/${id}/view`);
}

export async function decideForm(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const decision=z.enum(["approved","rejected"]).parse(form.get("decision"));
  try {await recordFormDecision(id,decision,String(form.get("reason") ?? ""),String(form.get("explanation") ?? ""));}
  catch {redirect(`${back}&form=approval`);}
  revalidatePath("/app","layout");redirect(back);
}

export async function markFormFiled(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const upload=form.get("ack_file");
  try {await fileForm(id,String(form.get("ack") ?? ""),String(form.get("paper") ?? "") || undefined,upload instanceof File ? upload : undefined);}
  catch {redirect(`${back}&form=ack`);}
  runJobsSoon();
  revalidatePath("/app","layout");redirect(back);
}

export async function addEditedForm(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const file=form.get("edited_file");let draft:string;
  try {if(!(file instanceof File)) throw new Error("Choose the file.");draft=(await uploadEditedForm(id,file)).draft;}
  catch {redirect(`${back}&form=edited`);}
  revalidatePath("/app","layout");redirect(`/app/clients/${document.client_id}?tab=extraction&draft=${draft}`);
}

// A register's GST number, for a client with more than one. A change is a new revision, so an
// approval built on the register is cleared.
export async function setDraftRegistration(form:FormData) {
  const client=z.uuid().parse(form.get("client")),draft=z.uuid().parse(form.get("draft")),registration=z.uuid().parse(form.get("registration")),back=`/app/clients/${client}?tab=outputs`;
  const {supabase,membership,userId}=await currentWriter();
  if(!membership) redirect("/app");
  const permission=membership.may("edit_figures",client) ? null : await grantFor(membership.firmId,userId,"edit_figures",client);
  if(!membership.may("edit_figures",client) && !permission) redirect(`${back}&form=check`);
  const [{data:row},{data:number}]=await Promise.all([
    supabase.from("datasets").select("id,firm_id,client_id,form_code,period_key,revision,data").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",draft).eq("form_code","GSTR1").maybeSingle(),
    supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",registration).eq("kind","gstin").maybeSingle(),
  ]);
  if(!row || !number) redirect(`${back}&form=check`);
  const data=draftSchema.parse(row.data);
  if(data.registration!==registration && !await saveDraft(row,{...data,registration},userId,"dataset.changed",{registration},permission)) redirect(`${back}&form=check`);
  revalidatePath("/app","layout");redirect(back);
}
