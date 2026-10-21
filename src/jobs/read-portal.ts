import {readPortalDraft} from "@/src/lib/portal-draft";
import {supabaseAdmin} from "@/src/lib/supabase";
import type {Handler} from "./runner";

export const readPortalFile:Handler=async(job)=>{
  if(!job.firm_id) return {done:true};
  const {data:document}=await supabaseAdmin().from("documents").select("id,firm_id,client_id,name,sha256,period_key").eq("firm_id",job.firm_id).eq("id",job.entity_id ?? "").eq("status","filed").eq("work_type","gst").eq("document_type","GSTR-2B").maybeSingle();
  if(!document || !/\.json$/i.test(document.name)) return {done:true};
  try {await readPortalDraft(document);return {done:true};}
  catch {return {retry:"portal_not_read",patient:true};}
};
export const queuePortal=(firm:string,id:string)=>supabaseAdmin().from("jobs").upsert({firm_id:firm,kind:"read_portal",entity_type:"document",entity_id:id,idempotency_key:`read_portal:${id}`},{onConflict:"idempotency_key",ignoreDuplicates:true});
