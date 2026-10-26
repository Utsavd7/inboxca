import {supabaseAdmin} from "@/src/lib/supabase";
import {preparedSchema,savePrepared} from "@/src/lib/prepared";
import {confirmedFigures,draftSchema} from "@/src/lib/datasets";
import {serverCrypto} from "@/src/lib/crypto";
import {chooseTemplate,templateSchema} from "@/src/lib/templates";
import {formRequest} from "@/src/lib/form-worker";
import {itrChecks} from "@/src/lib/itr-check";
import type {Handler} from "./runner";

// A correction waits for all source checks, then keeps the earlier file and saves the next.
export const regenerateForm:Handler=async(job)=>{
  const admin=supabaseAdmin(),firm=job.firm_id!;
  const {data:old,error}=await admin.from("documents").select("client_id,period_key,prepared").eq("firm_id",firm).eq("id",job.entity_id!).neq("status","deleted").maybeSingle();
  if(error) return {retry:"form_not_read"};
  if(!old?.prepared) return {done:true};
  const meta=preparedSchema.parse(old.prepared),itr=meta.form.startsWith("ITR"),kind=itr ? "pan" : "gstin";
  if(meta.status==="filed" || meta.status==="rejected") return {done:true};
  const [{data:rows},{data:registration},{data:templates}]=await Promise.all([
    admin.from("datasets").select("id,revision,data").eq("firm_id",firm).eq("client_id",old.client_id).eq("form_code",itr ? "ITR" : meta.form).eq("period_key",old.period_key).in("id",meta.sources.map(source=>source.id)),
    admin.from("client_registrations").select("number_enc").eq("firm_id",firm).eq("client_id",old.client_id).eq("id",meta.registration).eq("kind",kind).maybeSingle(),
    admin.from("templates").select("*").eq("form_code",meta.form),
  ]);
  if(rows?.length!==meta.sources.length || !registration || rows.some(row=>draftSchema.parse(row.data).lines.some(line=>line.state!=="confirmed"))) return {done:true};
  try {
    const template=chooseTemplate((templates ?? []).map(row=>templateSchema.parse(row)),meta.form,old.period_key,meta.template,"correction");
    const drafts=[];
    for(const row of rows) drafts.push({id:row.id,revision:row.revision,figures:[...await confirmedFigures(firm,row.id,row.data)]});
    const by=draftSchema.parse(rows[0].data).lines[0].by!;
    const number=await serverCrypto().decrypt(firm,`clients/${old.client_id}/${kind}`,registration.number_enc);
    const id=await savePrepared(formRequest.parse({purpose:"prepare",firm,client:old.client_id,registration:meta.registration,...(itr ? {pan:number} : {gstin:number}),period:old.period_key,template,drafts,expires:Math.floor(Date.now()/1000)+60}),by,null,"correction");
    // An ITR that differs from Form 26AS or Form 16 is approved only by a person who ticks that they
    // looked at the differences (form-actions.ts), so its correction waits for one.
    const [check]=itr ? await itrChecks(admin,firm,[{client:old.client_id,period:old.period_key,form:meta.form,sources:rows.map(row=>row.id)}]) : [];
    if(check?.differences.length) {
      const {data:made}=await admin.from("documents").select("prepared").eq("firm_id",firm).eq("id",id).single();
      if(made && preparedSchema.parse(made.prepared).status==="approved")
        await admin.from("documents").update({prepared:{...(made.prepared as object),status:"draft"}}).eq("firm_id",firm).eq("id",id).throwOnError();
    }
    return {done:true};
  } catch {return {retry:"form_not_prepared",patient:true};}
};
