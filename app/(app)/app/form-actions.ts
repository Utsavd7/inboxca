"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {fileForm,prepareDocument,recordFormDecision,savePrepared,uploadEditedForm,visibleForm} from "@/src/lib/prepared";
import {formContext,requestFor} from "@/src/lib/prepare-form";
import {fillWork} from "@/src/lib/fill";
import {runJobsSoon} from "@/src/jobs/run-soon";
import {draftSchema,saveDraft} from "@/src/lib/datasets";
import {currentMember,currentWriter} from "@/src/lib/member";
import {grantFor} from "@/src/lib/permission-grants";
import {itrReturns} from "@/src/lib/itr-fields";
import {itrChecks,type ItrWork} from "@/src/lib/itr-check";
import {supabaseAdmin} from "@/src/lib/supabase";

// An ITR whose figures differ from the client's Form 26AS or Form 16 (src/lib/itr-check.ts) is
// approved only once the person ticks that they looked at the differences, and the tick is
// logged. Filing never waits on it. Gives the log to write, or null when the tick is missing.
async function differencesSeen(input:FormData,work:ItrWork) {
  if(!/^ITR[1-6]$/.test(work.form)) return async()=>{};
  const {supabase,membership,userId}=await currentMember();
  if(!membership) throw new Error("Sign in to your firm first.");
  const [{differences}]=await itrChecks(supabase,membership.firmId,[work]);
  if(!differences.length) return async()=>{};
  if(input.get("differences_seen")!=="1") return null;
  return async(document:string)=>{
    const {error}=await supabaseAdmin().from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"form.differences_seen",entity_type:"document",entity_id:document,details:{differences:differences.length}});
    if(error) throw new Error("The check could not be saved.");
  };
}

export async function prepareForm(form:FormData) {
  const client=z.uuid().parse(form.get("client")),back=`/app/clients/${client}?tab=outputs`;
  const code=z.enum(["GSTR1","GSTR3B",...itrReturns]).parse(form.get("form") ?? "GSTR1"),period=String(form.get("period")),drafts=form.getAll("draft").map(String);
  let id:string,seen:Awaited<ReturnType<typeof differencesSeen>>;
  try {seen=await differencesSeen(form,{client,period,form:code,sources:drafts});} catch {redirect(`${back}&form=check`);}
  if(!seen) redirect(`${back}&form=differences`);
  try {
    id=await prepareDocument({client,registration:String(form.get("registration")),form:code,period,drafts,version:String(form.get("version") ?? "") || undefined,reason:String(form.get("reason") ?? "") || undefined});
    await seen(id);
  } catch {redirect(`${back}&form=check`);}
  revalidatePath("/app","layout");redirect(`/app/files/${id}/view`);
}

// Fill, for one return from its row or its pin: InboxCA fills it from every figure it has read,
// checked or not, through the same database path as the automatic fill, so pressing twice or
// racing it makes one draft. The draft opens with the figures still to check.
export type FillState={error?:string};
export async function fillNow(_:FillState,form:FormData):Promise<FillState> {
  const task=z.uuid().safeParse(form.get("task"));
  const {supabase,membership,userId}=await currentMember();
  if(!task.success || !membership) return {error:"Open the page again."};
  const work=await fillWork(supabase,membership.firmId,task.data);
  if("refusal" in work) return {error:work.refusal};
  if(!membership.may("edit_figures",work.client) && !await grantFor(membership.firmId,userId,"edit_figures",work.client)) return {error:"Ask your owner for permission to fill returns."};
  let id:string;
  try {
    const context=await formContext({client:work.client,registration:work.registration,form:work.form,period:work.period});
    id=await savePrepared(requestFor(context,work.drafts),context.userId,context.permission,undefined,true);
  } catch(error) {return {error:error instanceof Error && error.name==="Error" ? error.message : "The return could not be filled. Try again in a moment."};}
  revalidatePath("/app","layout");redirect(`/app/files/${id}/view`);
}

export async function decideForm(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const decision=z.enum(["approved","rejected"]).parse(form.get("decision"));
  let seen:Awaited<ReturnType<typeof differencesSeen>>=async()=>{};
  if(decision==="approved") try {seen=await differencesSeen(form,{client:document.client_id,period:document.period_key,form:document.prepared.form,sources:document.prepared.sources.map(source=>source.id)});} catch {redirect(`${back}&form=approval`);}
  if(!seen) redirect(`${back}&form=differences`);
  try {await seen(id);await recordFormDecision(id,decision,String(form.get("reason") ?? ""),String(form.get("explanation") ?? ""));}
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
