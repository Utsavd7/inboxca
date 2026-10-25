"use server";
import {supabaseAdmin} from "@/src/lib/supabase";
import {runJobsSoon} from "@/src/jobs/run-soon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentWriter } from "@/src/lib/member";
import { serverCrypto } from "@/src/lib/crypto";
import { grantFor } from "@/src/lib/permission-grants";
import { checkFigures, draftSchema, checkValue, openFigures, place, saveDraft } from "@/src/lib/datasets";
import {checkItr} from "@/src/lib/itr";

export async function saveFigureEdit(form:FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if(!membership) return false;
  const input=z.object({client:z.uuid(),draft:z.uuid(),line:z.uuid(),revision:z.coerce.number().int().positive(),value:z.string().max(2000),reason:z.string().max(300)}).safeParse(Object.fromEntries(form));
  if(!input.success) return false;
  const {client,draft,line,revision,value,reason}=input.data;
  if(!membership.may("edit_figures",client) && !await grantFor(membership.firmId,userId,"edit_figures",client)) return false;
  const {data:row}=await supabase.from("datasets").select("data,revision").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",draft).maybeSingle();
  if(!row || row.revision!==revision) return false;
  const source=draftSchema.parse(row.data).lines.find(item=>item.id===line);
  if(!source) return false;
  if(source.source.document) {
    const {data:document}=await supabase.from("documents").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",source.source.document).eq("sha256",source.source.sha256!).neq("status","deleted").maybeSingle();
    if(!document) return false;
  }
  const value_enc=await serverCrypto().encrypt(membership.firmId,`${place(draft,line)}/edit/${userId}`,JSON.stringify({value,reason}));
  const {data,error}=await supabaseAdmin().rpc("save_figure_edit",{draft,firm:membership.firmId,client,person:userId,line,base:source.value_enc,value_enc});
  return !error && data===true;
}

export async function reviewFigure(form:FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if(!membership) redirect("/app");
  const input=z.object({client:z.uuid(),draft:z.uuid(),line:z.uuid(),revision:z.coerce.number().int().min(1),intent:z.enum(["confirmed","rejected","edit"])}).safeParse(Object.fromEntries(form));
  if(!input.success) redirect("/app/clients");
  const {client,draft:id,line:lineId,revision,intent}=input.data;
  const back=`/app/clients/${client}?tab=extraction&draft=${id}`;
  if(intent!=="edit" && !membership.may("check_figures",client)) redirect(`${back}&check=permission`);
  const {data:row}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).maybeSingle();
  if(!row) redirect("/app/clients");
  if(row.revision!==revision) redirect(`${back}&check=stale`);
  const data=draftSchema.parse(row.data),line=data.lines.find((item)=>item.id===lineId);
  if(!line) redirect(back);
  if(line.source.document) {
    const {data:document}=await supabase.from("documents").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",line.source.document).neq("status","deleted").maybeSingle();
    if(!document) redirect(`${back}&check=source`);
  }
  const crypto=serverCrypto();
  const figures=await openFigures(membership.firmId,id,data);
  let permission:string|null=null;
  const audit:{line:string;state:string;before?:string;after?:string;reason_enc?:string}={line:lineId,state:intent};
  if(intent==="edit") {
    permission=membership.may("edit_figures", client) ? null : await grantFor(membership.firmId,userId,"edit_figures",client);
    if(!membership.may("edit_figures", client) && !permission) redirect(`${back}&check=permission`);
    const value=String(form.get("value") ?? "").trim(),reason=String(form.get("reason") ?? "").trim();
    try {checkValue({...figures.get(line.id)!,value});} catch {redirect(`${back}&check=value`);}
    if(reason.length<3 || reason.length>300) redirect(`${back}&check=reason`);
    audit.before=line.value_enc;
    line.value_enc=await crypto.encrypt(membership.firmId,place(id,line.id),JSON.stringify({...figures.get(line.id),value}));
    audit.after=line.value_enc;
    audit.reason_enc=await crypto.encrypt(membership.firmId,`${place(id,line.id)}/reason/${revision}`,reason);
    for(const item of data.lines) {item.state="pending";delete item.by;delete item.at;}
  } else {
    if(line.state===intent) redirect(back);
    line.state=intent;line.by=userId;line.at=new Date().toISOString();
    if(intent==="confirmed" && checkFigures(data,figures).length) redirect(`${back}&check=totals`);
    if(intent==="confirmed" && data.target) {
      const issues=await checkItr(client,row.period_key,id,revision,data,figures).catch(()=>["The figures could not be checked."]);
      if(issues.length) redirect(`${back}&check=itr`);
    }
  }
  const saved=await saveDraft(row,data,userId,intent==="edit" ? "dataset.changed" : "dataset.checked",audit,permission);
  if(!saved) redirect(`${back}&check=stale`);
  if(data.lines.every(line=>line.state==="confirmed")) {
    const admin=supabaseAdmin();
    const {data:forms}=await admin.from("documents").select("id,prepared").eq("firm_id",membership.firmId).eq("client_id",client).eq("prepared->>status","draft").contains("prepared",{sources:[{id}]});
    for(const form of forms ?? []) {
      const sources=(form.prepared as {sources:{id:string;revision:number}[]}).sources;
      if(sources.find(source=>source.id===id)?.revision===revision+1) continue;
      const {error}=await admin.from("jobs").upsert({firm_id:membership.firmId,kind:"regenerate_form",entity_type:"document",entity_id:form.id,idempotency_key:`regenerate:${form.id}:${id}:${revision+1}`},{onConflict:"idempotency_key",ignoreDuplicates:true});
      if(error) throw new Error("The corrected form could not be queued.");
    }
    if(forms?.length) runJobsSoon();
  }
  revalidatePath("/app","layout");
  redirect(`${back}&check=saved`);
}
