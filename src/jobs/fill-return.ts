import {supabaseAdmin} from "@/src/lib/supabase";
import {keepForDifferences,savePrepared} from "@/src/lib/prepared";
import {fillWork} from "@/src/lib/fill";
import {fillable} from "@/src/lib/return-work";
import {serverCrypto} from "@/src/lib/crypto";
import {chooseTemplate,templateSchema} from "@/src/lib/templates";
import {formRequest,itrReviewSchema} from "@/src/lib/form-worker";
import {workerForm} from "@/src/lib/prepare-form";
import type {Handler} from "./runner";

// InboxCA fills a GSTR-1, GSTR-3B or ITR by itself (the triggers and the morning run in
// 20261031900000_return_work.sql and 20261102500000_itr_fill.sql): once every figure is checked,
// from the firm's days before the due date, and after a figure changes. The stage is read again
// here, and fill_form keeps one current draft, so a run racing a person's Fill makes nothing twice.
// Whatever stops a fill (src/lib/fill.ts) is left for the person, who sees why when they press Fill,
// and the job keeps why as a short code for Fill all's list (src/lib/return-work.ts fillReasons).
export const fillReturn:Handler=async(job)=>{
  const admin=supabaseAdmin(),firm=job.firm_id!;
  const {data:stages,error}=await admin.rpc("return_stages",{target_firm:firm,task_ids:[job.entity_id!]});
  if(error) return {retry:"return_not_read"};
  if(!fillable(stages?.[0])) return {done:true};
  const work=await fillWork(admin,firm,job.entity_id!);
  if("refusal" in work) return {done:true,reason:"why" in work ? work.why : "refused"};
  const itr=work.form.startsWith("ITR"),kind=itr ? "pan" : "gstin";
  const [{data:registrations},{data:templates}]=await Promise.all([
    admin.from("client_registrations").select("id,number_enc").eq("firm_id",firm).eq("client_id",work.client).eq("kind",kind),
    admin.from("templates").select("*").eq("form_code",work.form),
  ]);
  // As on its own page, an ITR is made only for a client with one PAN (src/lib/prepare-form.ts).
  const registration=registrations?.find(row=>row.id===work.registration);
  if(!registration || itr && registrations!.length!==1) return {done:true,reason:"pan"};
  let template;
  try {template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),work.form,work.period);} catch {return {done:true,reason:"form"};}
  try {
    const number=await serverCrypto().decrypt(firm,`clients/${work.client}/${kind}`,registration.number_enc);
    const request=formRequest.parse({purpose:"prepare",firm,client:work.client,registration:work.registration,...(itr ? {pan:number} : {gstin:number}),period:work.period,template,drafts:work.drafts,expires:Math.floor(Date.now()/1000)+60});
    // Details the official ITR form still needs, or figures it does not take, are for the person
    // to fill on its page: nothing is guessed, and no hourly retry.
    if(itr) {const review=itrReviewSchema.parse(await (await workerForm({...request,purpose:"check"})).json());if(review.missing.length || review.issues.length) return {done:true,reason:review.missing.length ? "details" : "issues"};}
    const keep=itr ? await keepForDifferences(firm,{client:work.client,period:work.period,form:work.form,sources:work.drafts.map(draft=>draft.id)}) : null;
    // Saved first: an optional call skips its arguments, so a GST return (no keep) must not be saved inside one.
    const saved=await savePrepared(request,null,null,undefined,true);
    await keep?.(saved);
    return {done:true};
  } catch {return {retry:"form_not_filled",patient:true};}
};
