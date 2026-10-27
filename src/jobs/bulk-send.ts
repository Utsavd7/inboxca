import { createHash } from "node:crypto";
import type { Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { paperPolicy, pickPaper, type BulkSend, type RecordsSettings } from "@/src/lib/records";
import { sendShare } from "@/src/lib/shares";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Two lists asking for the same paper today use one send; its link is still random.
export function bulkShareId(firm:string,document:string,client:string,day:string) {
  const hash=createHash("sha256").update(`bulk:${firm}:${document}:${client}:${day}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

// One saved list, at most 25 clients a run. Completed clients stay completed after a crash.
export const bulkSend: Handler = async (job) => {
  const admin = supabaseAdmin();
  const {data: request,error} = await admin.from("requests").select("id,firm_id,status,details,firms(name,settings)").eq("id",job.entity_id!).eq("kind","bulk_send").maybeSingle();
  if (error) return {retry:"send_not_read"};
  if (!request || request.status !== "pending" || !request.firms) return {done:true};
  const details = request.details as unknown as BulkSend;
  const firm = request.firm_id;
  let handled=0;
  const started=Date.now();
  for (const entry of details.clients.filter((client) => !client.state)) {
    if (handled++ >= 25 || Date.now()-started>=30_000) return {retry:"more_clients",at:new Date(Date.now()+10*60_000)};
    const [{data: client,error: clientError},{data: papers,error: paperError},previous] = await Promise.all([
      admin.from("clients").select("name,email_enc,archived_at").eq("firm_id",firm).eq("id",entry.id).maybeSingle(),
      admin.from("documents").select("id,name,document_type,period_key,status,share_policy,prepared").eq("firm_id",firm).eq("client_id",entry.id).eq("document_type",details.type).eq("status","filed"),
      admin.from("shares").select("id,document_id,status,delivery").eq("firm_id",firm).eq("id",entry.share).maybeSingle(),
    ]);
    let prior=previous.data;
    if (clientError || paperError || previous.error) return {retry:"papers_not_read"};
    const picked = pickPaper(prior ? (papers ?? []).filter((paper) => paper.id === prior?.document_id) : papers ?? [], {types:[details.type],period:details.period});
    const paper = "document" in picked ? picked.document : null;
    if (paper && !prior) {
      entry.share=bulkShareId(firm,paper.id,entry.id,details.day);
      const {error: saved}=await admin.from("requests").update({details:details as unknown as NonNullable<Json>}).eq("id",request.id);
      if (saved) return {retry:"send_not_saved"};
      const {data,error}=await admin.from("shares").select("id,document_id,status,delivery").eq("firm_id",firm).eq("id",entry.share).maybeSingle();
      if (error) return {retry:"papers_not_read"};
      prior=data;
    }
    const policy = paper && paperPolicy(paper,(request.firms.settings as {records?: RecordsSettings}).records);
    const reason = !client || client.archived_at ? "archived" : !client.email_enc ? "no_email" : !paper ? picked.reason : policy === "internal" ? "record_internal" : null;
    if (reason) { entry.state="skipped"; entry.reason=reason; }
    else if (paper && client?.email_enc) {
      if (prior?.status === "refused") { entry.state="skipped"; entry.reason="record_internal"; }
      else if (policy === "approval" && !prior) {
        const {error} = await admin.from("shares").insert({id:entry.share,firm_id:firm,document_id:paper.id,contact_id:null,status:"waiting",needs_code:true});
        if (error) return {retry:"approval_not_saved"};
        entry.state="waiting";
      } else if (prior?.status === "waiting" && !prior.delivery) entry.state="waiting";
      else {
        const to=await serverCrypto().decrypt(firm,`clients/${entry.id}/email`,client.email_enc);
        if (!await sendShare({firmId:firm,firmName:request.firms.name,documentId:paper.id,documentName:paper.name,clientName:client.name,contactId:null,to,waitingId:entry.share,needsCode:policy === "approval"}))
        {
          const {data}=await admin.from("shares").select("delivery").eq("id",entry.share).maybeSingle();
          const at=(data?.delivery as {at?:string} | null)?.at;
          return at ? {retry:"mail_wait",at:new Date(at)} : {retry:"mail_not_sent",patient:true};
        }
        entry.state="sent";

      }
    }
    const {error: saveError} = await admin.from("requests").update({details:details as unknown as NonNullable<Json>}).eq("id",request.id);
    if (saveError) return {retry:"send_not_saved"};
  }
  const {error: finishError} = await admin.from("requests").update({status:"done"}).eq("id",request.id);
  return finishError ? {retry:"send_not_saved"} : {done:true};
};
