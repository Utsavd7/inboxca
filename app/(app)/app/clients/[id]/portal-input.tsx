import {redirect} from "next/navigation";
import {z} from "zod";
import {currentMember,currentWriter,viewOnlyWords} from "@/src/lib/member";
import {readPortalDraft} from "@/src/lib/portal-draft";
import {keepReason,keptReason} from "@/src/lib/reason";
import {FileJson} from "lucide-react";
import {periodName} from "@/src/lib/documents";
import {Pending} from "../../pending";
import {IconTile} from "../../ui";

async function readStatement(form:FormData) {
  "use server";
  const {supabase,membership}=await currentWriter();
  if(!membership) redirect("/app");
  const client=z.uuid().parse(form.get("client")),id=z.uuid().parse(form.get("source"));
  const back=`/app/clients/${client}?tab=extraction`;
  const {data:document}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key,document_type").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).eq("status","filed").eq("work_type","gst").in("document_type",["GSTR-2B","GSTR-2A"]).single();
  if(!document) redirect("/app/clients");
  let draft:string|null=null;
  try {draft=await readPortalDraft(document);} catch(error) {await keepReason(error);redirect(`${back}&portal=check`);}
  redirect(draft ? `${back}&draft=${draft}` : `${back}&portal=layout`);
}

export async function PortalInput({clientId,message}:{clientId:string;message?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const {data:files}=await supabase.from("documents").select("id,name,period_key").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("status","filed").in("document_type",["GSTR-2B","GSTR-2A"]).order("received_at",{ascending:false}).limit(100);
  if(!files?.length) return null;
  const reason=message==="check" ? await keptReason() : undefined;
  const statements=files.filter((file)=>/\.json$/i.test(file.name));
  return <section className="app-card tool" aria-labelledby="read-2b"><header className="app-card-head"><IconTile Icon={FileJson} kind="docs"/><h2 id="read-2b">Read a GSTR-2B or GSTR-2A statement</h2></header>
    <p className="tool-hint">A GSTR-2B adds to that month&apos;s GSTR-3B figures. A GSTR-2A is for information only, kept separate and never used for GSTR-3B.</p>
    {message && <div className="tool-body"><p className="alert" role="alert">{message==="layout" ? "InboxCA could not read this statement, or this month already has its figures. No figures were changed." : reason ?? "InboxCA could not read this statement. Check that the paper's month and the client's GSTIN are right, and that your firm's drive is connected."}</p></div>}
    {!!membership.viewOnlyUntil && statements.length>0 && <p className="tool-hint">{viewOnlyWords(membership.viewOnlyUntil)}</p>}
    {statements.length ? <ul className="app-rows">{statements.map((file)=><li className="app-row" key={file.id}><span className="grow"><strong>{file.name}</strong>{file.period_key && <span className="sub">{periodName(file.period_key)}</span>}</span><form action={readStatement}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="source" value={file.id}/><Pending className="b b-secondary" busy="Reading" disabled={!!membership.viewOnlyUntil}>Read statement</Pending></form></li>)}</ul> : <p className="app-card-none">Add the JSON file from the GST portal to read it here.</p>}
  </section>;
}
