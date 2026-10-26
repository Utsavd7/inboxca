import {redirect} from "next/navigation";
import {csv} from "@/src/lib/firm-download";
import {currentMember} from "@/src/lib/member";
import {openMatch} from "@/src/lib/purchase-match";
import type {Amounts,Entry} from "@/src/lib/purchase-register";
import {supabaseAdmin} from "@/src/lib/supabase";

// Excel reads "(500.00)" as minus 500; a leading minus sign would be kept as text.
const money=(paise?:number)=>paise===undefined ? "" : paise<0 ? `(${(-paise/100).toFixed(2)})` : (paise/100).toFixed(2);
const amounts=(value?:Amounts)=>(["taxable","igst","cgst","sgst","cess"] as const).map((head)=>money(value?.[head]));

// The GSTR-2B match as a spreadsheet, every list with matched bills too, for whoever may
// download this client's files. Each download is logged.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {supabase,userId,membership}=await currentMember();
  const {id}=await params,register=new URL(request.url).searchParams.get("register") ?? "";
  const back=`/app/clients/${id}?tab=extraction&purchases=${encodeURIComponent(register)}`;
  if(!membership || !/^[0-9a-f-]{36}$/.test(register)) redirect(`/app/clients/${id}?tab=extraction`);
  if(!membership.may("download",id)) redirect(`${back}&match=download#gst-match`);
  const [{data:paper},{data:match}]=await Promise.all([
    supabase.from("documents").select("name").eq("firm_id",membership.firmId).eq("client_id",id).eq("id",register).maybeSingle(),
    supabase.from("gst_matches").select("result_enc").eq("firm_id",membership.firmId).eq("register_id",register).maybeSingle(),
  ]);
  if(!paper || !match) redirect(`${back}&match=source#gst-match`);
  const result=await openMatch(membership.firmId,register,match.result_enc);
  const lines=([["Not in GSTR-2B",result.missing],["Amount differs",result.differ],["In GSTR-2B, not in the books",result.extra],["Matched",result.matched]] as [string,Entry[]][])
    .flatMap(([list,entries])=>entries.map((entry)=>[list,entry.gstin,entry.name ?? "",entry.number,entry.date,entry.note==="C" ? "Credit note" : entry.note==="D" ? "Debit note" : "",...amounts(entry.books),...amounts(entry.portal),entry.rows?.join(" ") ?? ""]));
  const {error}=await supabaseAdmin().from("activity_log").insert({firm_id:membership.firmId,actor_id:userId,action:"gst_match.downloaded",entity_type:"client",entity_id:id,details:{register}});
  if(error) redirect(`${back}&match=read#gst-match`);
  const heads=["Taxable value","IGST","CGST","SGST","Cess"];
  const text=csv(["List","Supplier GSTIN","Supplier name","Invoice number","Invoice date","Note",...heads.map((head)=>`${head} in the books`),...heads.map((head)=>`${head} in GSTR-2B`),"Rows in the register"],lines);
  return new Response(text,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(`${paper.name.replace(/\.[^.]+$/,"")} - GSTR-2B match.csv`)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
