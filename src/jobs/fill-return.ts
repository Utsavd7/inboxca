import {supabaseAdmin} from "@/src/lib/supabase";
import {savePrepared} from "@/src/lib/prepared";
import {fillWork} from "@/src/lib/fill";
import {fillable} from "@/src/lib/return-work";
import {serverCrypto} from "@/src/lib/crypto";
import {chooseTemplate,templateSchema} from "@/src/lib/templates";
import {formRequest} from "@/src/lib/form-worker";
import type {Handler} from "./runner";

// InboxCA fills a GSTR-1 or GSTR-3B by itself (the trigger and the morning run in
// 20261031900000_return_work.sql): once every figure is checked, from the firm's days before the
// due date, and after a figure changes. The stage is read again here, and fill_form keeps one
// current draft, so a run racing a person's Fill makes nothing twice.
export const fillReturn:Handler=async(job)=>{
  const admin=supabaseAdmin(),firm=job.firm_id!;
  const {data:stages,error}=await admin.rpc("return_stages",{target_firm:firm,task_ids:[job.entity_id!]});
  if(error) return {retry:"return_not_read"};
  if(!fillable(stages?.[0])) return {done:true};
  const work=await fillWork(admin,firm,job.entity_id!);
  if("refusal" in work) return {done:true};
  const [{data:registration},{data:templates}]=await Promise.all([
    admin.from("client_registrations").select("number_enc").eq("firm_id",firm).eq("client_id",work.client).eq("id",work.registration).eq("kind","gstin").maybeSingle(),
    admin.from("templates").select("*").eq("form_code",work.form),
  ]);
  if(!registration) return {done:true};
  let template;
  try {template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),work.form,work.period);} catch {return {done:true};}
  try {
    const gstin=await serverCrypto().decrypt(firm,`clients/${work.client}/gstin`,registration.number_enc);
    await savePrepared(formRequest.parse({purpose:"prepare",firm,client:work.client,registration:work.registration,gstin,period:work.period,template,drafts:work.drafts,expires:Math.floor(Date.now()/1000)+60}),null,null,undefined,true);
    return {done:true};
  } catch {return {retry:"form_not_filled",patient:true};}
};
