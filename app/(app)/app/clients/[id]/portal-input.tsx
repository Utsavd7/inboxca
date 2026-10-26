import {redirect} from "next/navigation";
import {z} from "zod";
import {currentMember,currentWriter} from "@/src/lib/member";
import {readPortalDraft} from "@/src/lib/portal-draft";
import {Pending} from "../../pending";

async function readStatement(form:FormData) {
  "use server";
  const {supabase,membership}=await currentWriter();
  if(!membership) redirect("/app");
  const client=z.uuid().parse(form.get("client")),id=z.uuid().parse(form.get("source"));
  const back=`/app/clients/${client}?tab=extraction`;
  const {data:document}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key,document_type").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).eq("status","filed").eq("work_type","gst").in("document_type",["GSTR-2B","GSTR-2A"]).single();
  if(!document) redirect("/app/clients");
  let draft:string|null=null;
  try {draft=await readPortalDraft(document);} catch {redirect(`${back}&portal=check`);}
  redirect(draft ? `${back}&draft=${draft}` : `${back}&portal=layout`);
}

export async function PortalInput({clientId,message}:{clientId:string;message?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const {data:files}=await supabase.from("documents").select("id,name,period_key").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("status","filed").in("document_type",["GSTR-2B","GSTR-2A"]).order("received_at",{ascending:false}).limit(100);
  if(!files?.length) return null;
  return <section className="section"><h2>Read a GSTR 2B or 2A statement</h2><p className="hint">Figures from a supported GSTR 2B join the month&apos;s draft for GSTR 3B. A GSTR 2A is for information only: its B2B invoices get a draft of their own and never feed GSTR 3B. Every figure still needs your check. A Form 26AS text file and a Form 16 are read by themselves into the year&apos;s income tax figures.</p>
    {message && <p className="alert" role="alert">{message==="layout" ? "This layout could not be read, or the month already has this statement. No figures were replaced." : "Check the file's month, the client's GSTIN and the drive connection."}</p>}
    {!membership.viewOnlyUntil && files.filter((file)=>/\.json$/i.test(file.name)).map((file)=><form action={readStatement} className="form-row" key={file.id}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="source" value={file.id}/><span>{file.name}</span><Pending className="b b-secondary b-small">Read statement</Pending></form>)}
  </section>;
}
