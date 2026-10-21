import {readSales} from "@/src/lib/sales-draft";
import {supabaseAdmin} from "@/src/lib/supabase";
import type {Handler} from "./runner";

export const readSalesRegister:Handler=async(job)=>{
  if(!job.firm_id) return {done:true};
  const {data:document}=await supabaseAdmin().from("documents").select("id,firm_id,client_id,name,sha256,period_key,status,work_type").eq("firm_id",job.firm_id).eq("id",job.entity_id ?? "").maybeSingle();
  if(!document || document.status!=="filed" || document.work_type!=="gst" || !/\.(xlsx?|csv)$/i.test(document.name)) return {done:true};
  try {await readSales(document,null);return {done:true};}
  catch {return {retry:"sales_not_read",patient:true};}
};
export const queueSales=(firm:string,id:string)=>supabaseAdmin().from("jobs").upsert({firm_id:firm,kind:"read_sales",entity_type:"document",entity_id:id,idempotency_key:`read_sales:${id}`},{onConflict:"idempotency_key",ignoreDuplicates:true});
