"use server";
import {supabaseAdmin} from "@/src/lib/supabase";
import {runJobsSoon} from "@/src/jobs/run-soon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientBack } from "../../return-back";
import { z } from "zod";
import { currentWriter } from "@/src/lib/member";
import { serverCrypto } from "@/src/lib/crypto";
import { grantFor } from "@/src/lib/permission-grants";
import { checkFigures, draftSchema, checkValue, openFigures, place, saveDraft, verifySources, type Draft } from "@/src/lib/datasets";
import {checkItr} from "@/src/lib/itr";
import {registerLine,sectionSummary} from "@/src/lib/section-check";

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
  // The view the person checks in, and the figure to show next (Check on the form moves on to it).
  const view=["form","list"].includes(String(form.get("view"))) ? `&view=${form.get("view")}` : "",next=z.uuid().safeParse(form.get("next")).data;
  const back=`${await clientBack(client)}?tab=extraction&draft=${id}${view}`;
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
    // A corrected register row resets only its own cells and its section's totals; any other figure resets the draft.
    const at=registerLine(line.field);
    for(const item of data.lines) {
      const other=at && registerLine(item.field);
      if(at && !(other && other.section===at.section && (other.total || other.row===at.row))) continue;
      item.state="pending";delete item.by;delete item.at;
    }
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
  await whenAllChecked(membership.firmId,client,id,revision,data);
  revalidatePath("/app","layout");
  redirect(`${back}${next ? `&line=${next}` : ""}&check=saved`);
}

// One Yes for a register section whose rows add up to its own totals: every row not flagged for a
// person's own look is checked at once, with the totals seen kept (encrypted) in the firm's activity.
export async function approveSection(form:FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if(!membership) redirect("/app");
  const input=z.object({client:z.uuid(),draft:z.uuid(),section:z.string().regex(/^[a-z0-9_]{1,20}$/),revision:z.coerce.number().int().min(1)}).safeParse(Object.fromEntries(form));
  if(!input.success) redirect("/app/clients");
  const {client,draft:id,section,revision}=input.data;
  const view=["form","list"].includes(String(form.get("view"))) ? `&view=${form.get("view")}` : "",back=`${await clientBack(client)}?tab=extraction&draft=${id}${view}`;
  if(!membership.may("check_figures",client)) redirect(`${back}&check=permission`);
  const {data:row}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).maybeSingle();
  if(!row) redirect("/app/clients");
  if(row.revision!==revision) redirect(`${back}&check=stale`);
  const data=draftSchema.parse(row.data);
  let sourceReady=true;
  try {await verifySources(membership.firmId,client,data);} catch {sourceReady=false;}
  if(!sourceReady) redirect(`${back}&check=source`);
  const figures=await openFigures(membership.firmId,id,data);
  const summary=sectionSummary(data,figures).find((one)=>one.section===section);
  if(!summary || !summary.agree || summary.checked) redirect(`${back}&check=totals`);
  const at=new Date().toISOString(),ids=new Set(summary.lines);
  for(const line of data.lines) if(ids.has(line.id) && line.state!=="confirmed") {line.state="confirmed";line.by=userId;line.at=at;}
  const totals_enc=await serverCrypto().encrypt(membership.firmId,`${place(id,section)}/totals/${revision}`,JSON.stringify({totals:summary.totals.map((total)=>[total.label,total.value]),rates:summary.byRate.map((entry)=>[entry.rate,String(entry.taxable),entry.tax===undefined ? "" : String(entry.tax)])}));
  const saved=await saveDraft(row,data,userId,"dataset.checked",{section,rows:summary.rows,flagged:summary.flagged.length,totals_enc});
  if(!saved) redirect(`${back}&check=stale`);
  await whenAllChecked(membership.firmId,client,id,revision,data);
  revalidatePath("/app","layout");
  redirect(`${back}&check=saved`);
}

// One group of figures on a return's Check step (an invoice's row of a register, or what one page
// of a paper gave), decided at once: the ones ticked are marked wrong, every other one is said yes
// to, under the same rules as one figure's Yes and No above.
export async function checkGroup(form:FormData) {
  const {supabase,userId,membership}=await currentWriter();
  if(!membership) redirect("/app");
  const input=z.object({client:z.uuid(),draft:z.uuid(),revision:z.coerce.number().int().min(1)}).safeParse(Object.fromEntries(form));
  const lines=z.array(z.uuid()).min(1).max(100).safeParse(form.getAll("line")),wrong=z.array(z.uuid()).max(100).safeParse(form.getAll("wrong"));
  if(!input.success || !lines.success || !wrong.success) redirect("/app/clients");
  const {client,draft:id,revision}=input.data,back=`${await clientBack(client)}?step=check`;
  if(!membership.may("check_figures",client)) redirect(`${back}&check=permission`);
  const {data:row}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).maybeSingle();
  if(!row) redirect("/app/clients");
  if(row.revision!==revision) redirect(`${back}&check=stale`);
  const data=draftSchema.parse(row.data),picked=data.lines.filter((line)=>lines.data.includes(line.id));
  if(picked.length!==new Set(lines.data).size || wrong.data.some((line)=>!lines.data.includes(line))) redirect(back);
  const papers=[...new Set(picked.flatMap((line)=>line.source.document ? [line.source.document] : []))];
  if(papers.length) {
    const {data:found}=await supabase.from("documents").select("id").eq("firm_id",membership.firmId).eq("client_id",client).in("id",papers).neq("status","deleted");
    if(found?.length!==papers.length) redirect(`${back}&check=source`);
  }
  const at=new Date().toISOString();
  for(const line of picked) {
    const state=wrong.data.includes(line.id) ? "rejected" : "confirmed";
    if(line.state!==state) {line.state=state;line.by=userId;line.at=at;}
  }
  if(picked.some((line)=>line.state==="confirmed")) {
    const figures=await openFigures(membership.firmId,id,data);
    if(checkFigures(data,figures).length) redirect(`${back}&check=totals`);
    if(data.target && (await checkItr(client,row.period_key,id,revision,data,figures).catch(()=>["The figures could not be checked."])).length) redirect(`${back}&check=itr`);
  }
  const saved=await saveDraft(row,data,userId,"dataset.checked",{lines:picked.filter((line)=>line.state==="confirmed").map((line)=>line.id),wrong:wrong.data});
  if(!saved) redirect(`${back}&check=stale`);
  await whenAllChecked(membership.firmId,client,id,revision,data);
  revalidatePath("/app","layout");
  redirect(`${back}&check=${wrong.data.length ? "marked" : "saved"}`);
}

async function whenAllChecked(firm:string,client:string,id:string,revision:number,data:Draft) {
  if(!data.lines.every(line=>line.state==="confirmed")) return;
  const admin=supabaseAdmin();
  const {data:forms}=await admin.from("documents").select("id,prepared").eq("firm_id",firm).eq("client_id",client).eq("prepared->>status","draft").contains("prepared",{sources:[{id}]});
  for(const form of forms ?? []) {
    const sources=(form.prepared as {sources:{id:string;revision:number}[]}).sources;
    if(sources.find(source=>source.id===id)?.revision===revision+1) continue;
    const {error}=await admin.from("jobs").upsert({firm_id:firm,kind:"regenerate_form",entity_type:"document",entity_id:form.id,idempotency_key:`regenerate:${form.id}:${id}:${revision+1}`},{onConflict:"idempotency_key",ignoreDuplicates:true});
    if(error) throw new Error("The corrected form could not be queued.");
  }
  // Also a GSTR-1 or GSTR-3B whose last figure this was: InboxCA fills it (fill_return).
  runJobsSoon();
}
