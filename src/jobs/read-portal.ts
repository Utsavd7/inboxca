import {readPortalDraft} from "@/src/lib/portal-draft";
import {readsFigures} from "@/src/lib/portal-files";
import {matchStatement} from "@/src/lib/purchase-match";
import {supabaseAdmin} from "@/src/lib/supabase";
import type {Handler} from "./runner";

export const readPortalFile:Handler=async(job)=>{
  if(!job.firm_id) return {done:true};
  const {data:document}=await supabaseAdmin().from("documents").select("id,firm_id,client_id,name,sha256,period_key,document_type,work_type,registration_id").eq("firm_id",job.firm_id).eq("id",job.entity_id ?? "").eq("status","filed").in("document_type",["GSTR-2B","GSTR-2A","Form 26AS","Form 16","Form 130"]).maybeSingle();
  if(!document || !readsFigures(document)) return {done:true};
  // A GSTR-2B is also matched with the month's purchase registers.
  try {await readPortalDraft(document);if(document.document_type==="GSTR-2B") await matchStatement(document);return {done:true};}
  catch {return {retry:"portal_not_read",patient:true};}
};
export const queuePortal=(firm:string,id:string)=>supabaseAdmin().from("jobs").upsert({firm_id:firm,kind:"read_portal",entity_type:"document",entity_id:id,idempotency_key:`read_portal:${id}`},{onConflict:"idempotency_key",ignoreDuplicates:true});
