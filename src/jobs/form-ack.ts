import {supabaseAdmin} from "@/src/lib/supabase";
import {serverCrypto} from "@/src/lib/crypto";
import {paperPolicy,type RecordsSettings} from "@/src/lib/records";
import {sendShare} from "@/src/lib/shares";
import {preparedSchema} from "@/src/lib/prepared";
import type {Handler} from "./runner";

// The acknowledgement follows the usual secure link and private-paper approval rules.
export const formAck:Handler=async(job)=>{
  const admin=supabaseAdmin();
  const {data:form,error}=await admin.from("documents").select("id,client_id,prepared,clients(name,email_enc),firms(name,settings)").eq("firm_id",job.firm_id!).eq("id",job.entity_id!).maybeSingle();
  if(error) return {retry:"form_not_read"};
  const meta=preparedSchema.safeParse(form?.prepared);
  if(!form || !meta.success || meta.data.status!=="filed" || !meta.data.acknowledgement || !form.clients?.email_enc || !form.firms) return {done:true};
  const [{data:paper,error:paperError},{data:prior,error:priorError}]=await Promise.all([
    admin.from("documents").select("id,name,document_type,share_policy,status").eq("firm_id",job.firm_id!).eq("client_id",form.client_id).eq("id",meta.data.acknowledgement).maybeSingle(),
    admin.from("shares").select("id,status,delivery").eq("firm_id",job.firm_id!).eq("id",form.id).maybeSingle(),
  ]);
  if(paperError || priorError) return {retry:"ack_not_read"};
  const policy=paper && paperPolicy(paper,(form.firms.settings as {records?:RecordsSettings}).records);
  if(!paper || paper.status!=="filed" || policy==="internal" || prior?.status==="refused") return {done:true};
  // Another version of the return filed with the same acknowledgement shares its paper: the
  // client gets that paper once, and it waits for approval once.
  if(!prior) {
    const {data:same,error:sameError}=await admin.from("shares").select("id").eq("firm_id",job.firm_id!).eq("document_id",paper.id).is("contact_id",null).is("email_event_id",null).limit(1);
    if(sameError) return {retry:"ack_not_read"};
    if(same?.length) return {done:true};
  }
  if(policy==="approval" && !prior) {
    const {error}=await admin.from("shares").insert({id:form.id,firm_id:job.firm_id!,document_id:paper.id,status:"waiting",needs_code:true});
    return error ? {retry:"approval_not_saved"} : {done:true};
  }
  if(prior?.status==="waiting" && !prior.delivery) return {done:true};
  const to=await serverCrypto().decrypt(job.firm_id!,`clients/${form.client_id}/email`,form.clients.email_enc);
  if(await sendShare({firmId:job.firm_id!,firmName:form.firms.name,documentId:paper.id,documentName:paper.name,clientName:form.clients.name,contactId:null,to,waitingId:form.id,needsCode:policy==="approval"})) return {done:true};
  const {data}=await admin.from("shares").select("delivery").eq("id",form.id).maybeSingle();
  const at=(data?.delivery as {at?:string} | null)?.at;
  return at ? {retry:"mail_wait",at:new Date(at)} : {retry:"mail_not_sent",patient:true};
};
