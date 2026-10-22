import Link from "next/link";
import {currentMember} from "@/src/lib/member";
import {preparedSchema,formName} from "@/src/lib/prepared";
import {draftSchema} from "@/src/lib/datasets";
import {periodName} from "@/src/lib/documents";
import {grantFor} from "@/src/lib/permission-grants";
import {askPermission} from "@/app/(app)/actions";
import {addEditedForm,decideForm,markFormFiled,prepareForm} from "./form-actions";

export async function PreparedForms({client,message}:{client?:string;message?:string}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) return null;
  let query=supabase.from("documents").select("id,client_id,name,period_key,size,status,prepared,clients(name)").eq("firm_id",membership.firmId).not("prepared","is",null).order("received_at",{ascending:false}).limit(100);
  if(client) query=query.eq("client_id",client);
  const {data:forms,error}=await query;
  if(error) throw new Error("The forms could not be read.");
  const groups=new Set<string>(),latest=new Set((forms ?? []).filter(file=>{
    const meta=preparedSchema.parse(file.prepared),group=[file.client_id,file.period_key,meta.form,meta.registration].join(":");
    if(groups.has(group)) return false;groups.add(group);return true;
  }).map(file=>file.id));
  if(!client) {
    const {data:waiting}=await supabase.from("requests").select("entity_id").eq("firm_id",membership.firmId).eq("kind","form_confirmation").eq("status","pending");
    const review=forms?.filter(file=>latest.has(file.id) && file.status!=="deleted" && (preparedSchema.parse(file.prepared).status==="draft" || waiting?.some(item=>item.entity_id===file.id)));
    return review?.length ? <section className="panel"><h2>Forms to review</h2><ul className="rows">{review.map(file=><li key={file.id}><Link href={`/app/clients/${file.client_id}?tab=outputs`}>{file.clients?.name}: {file.name}</Link>{waiting?.some(item=>item.entity_id===file.id) && <span className="hint">An acknowledgement arrived. Confirm filing.</span>}</li>)}</ul></section> : null;
  }
  const [{data:rows},{data:registrations},{data:acknowledgements},{data:confirmations}]=await Promise.all([
    supabase.from("datasets").select("id,form_code,period_key,data").eq("firm_id",membership.firmId).eq("client_id",client).eq("form_code","GSTR1").order("period_key",{ascending:false}).limit(100),
    supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","gstin"),
    supabase.from("documents").select("id,name,period_key").eq("firm_id",membership.firmId).eq("client_id",client).eq("document_type","Acknowledgement").eq("status","filed").limit(100),
    supabase.from("requests").select("entity_id,details").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","form_confirmation").eq("status","pending"),
  ]);
  const sourceIds=[...new Set(rows?.map(row=>draftSchema.parse(row.data).lines[0].source.document))];
  const {data:sourceNames}=sourceIds.length ? await supabase.from("documents").select("id,name").eq("firm_id",membership.firmId).eq("client_id",client).in("id",sourceIds) : {data:null};
  const canPrepare=!membership.viewOnlyUntil && (membership.may("edit_figures", client) || !!await grantFor(membership.firmId,userId,"edit_figures",client));
  const periods=[...new Set(rows?.map(row=>row.period_key))];
  return <section className="panel" aria-labelledby="prepared-title"><h2 id="prepared-title">Prepared forms</h2>
    <p className="hint">Check every figure first. Your firm files the approved file on the portal with its own code or signature.</p>
    {message && <p className="alert" role="status">{message==="edited" ? "Choose the filled official workbook. Its headings, supported cells and figures must pass the checks, and you need permission to edit figures." : message==="ack" ? "Add the acknowledgement or its number for the latest approved form. Check that the drive is connected." : message==="approval" ? "Another person must approve the latest checked figures. A rejection needs a reason." : "Check the figures, permission, drive and official form for this month, then try again."}</p>}
    {!!forms?.length && <ul className="rows">{forms.filter(file=>file.status!=="deleted").map(file=>{
      const meta=preparedSchema.parse(file.prepared),active=latest.has(file.id) && !membership.viewOnlyUntil && file.size>0;
      return <li key={file.id}><div className="grow">
        <Link href={`/app/files/${file.id}/view`}>{file.name}</Link>
        <p className="hint">{meta.status[0].toUpperCase()+meta.status.slice(1)}. Official form {meta.template}.{!latest.has(file.id) && " Earlier version."}{meta.external && " Edited outside InboxCA."}</p>
        <div className="form-row">{meta.sources.map((source,n)=><Link key={source.id} href={`?tab=extraction&draft=${source.id}`}>Check source figures{meta.sources.length>1 ? ` ${n+1}` : ""}</Link>)}
          {active && ["approved","filed"].includes(meta.status) && <form action={`/app/files/${file.id}/filing`} method="post"><button className="b b-secondary b-small">Download for filing</button></form>}
          {active && meta.status==="draft" && ["owner","partner","manager"].includes(membership.role) && <form action={decideForm}><input type="hidden" name="document" value={file.id}/><button className="b b-secondary b-small" name="decision" value="approved">Give second approval</button></form>}
        </div>
        {active && meta.status==="draft" && ["owner","partner","manager"].includes(membership.role) && <details><summary>Reject this version</summary><form action={decideForm} className="fields">
          <input type="hidden" name="document" value={file.id}/>
          <div><label htmlFor={`reason-${file.id}`}>Reason</label><select id={`reason-${file.id}`} name="reason"><option value="figures">Figures need checking</option><option value="source">Source needs checking</option><option value="other">Other reason</option></select></div>
          <div><label htmlFor={`why-${file.id}`}>What needs to change</label><input id={`why-${file.id}`} name="explanation" minLength={3} maxLength={300} required/></div>
          <button className="b b-ghost b-small" name="decision" value="rejected">Reject with reason</button>
        </form></details>}
        {active && meta.status==="approved" && membership.may("mark_filed",client) && <details><summary>Record filing</summary><form action={markFormFiled} className="fields">
          <input type="hidden" name="document" value={file.id}/>
          {confirmations?.some(item=>item.entity_id===file.id) && <p className="hint">An acknowledgement arrived. Check it before confirming this filing.</p>}
          <div><label htmlFor={`paper-${file.id}`}>Acknowledgement already in Files</label><select id={`paper-${file.id}`} name="paper"><option value="">Choose, or add one below</option>{acknowledgements?.filter(paper=>paper.period_key===file.period_key).map(paper=><option key={paper.id} value={paper.id}>{paper.name}</option>)}</select></div>
          <div><label htmlFor={`ack-${file.id}`}>Acknowledgement number, if known</label><input id={`ack-${file.id}`} name="ack" maxLength={80}/></div>
          <div><label htmlFor={`upload-${file.id}`}>Or upload the portal acknowledgement</label><input id={`upload-${file.id}`} name="ack_file" type="file" accept=".pdf,.png,.jpg,.jpeg"/></div>
          <p className="hint">With only a number, your client gets a filing record from your firm. This does not replace the portal acknowledgement. Private papers wait for approval in the Inbox.</p>
          <button className="b b-secondary b-small">Mark filed</button>
        </form></details>}
        {active && canPrepare && <details><summary>File corrected outside InboxCA</summary><form action={addEditedForm} className="fields">
          <input type="hidden" name="document" value={file.id}/><div><label htmlFor={`edited-${file.id}`}>Filled official workbook</label><input id={`edited-${file.id}`} name="edited_file" type="file" accept=".xlsx" required/></div>
          <p className="hint">Prefer correcting the source figures. An uploaded correction is a new version, checked against the official form. Its figures must be checked again.</p><button className="b b-secondary b-small">Add corrected version</button>
        </form></details>}
      </div></li>;
    })}</ul>}
    {!!rows?.length && <><h3>Prepare from checked figures</h3>{registrations?.length!==1 ? <p className="hint">A single GST number is needed before these registers can be used together.</p> : canPrepare ? periods.map(period=>{const previous=forms?.find(file=>file.period_key===period && latest.has(file.id)),preferred=previous ? new Set(preparedSchema.parse(previous.prepared).sources.map(source=>source.id)) : null;return <form action={prepareForm} className="fields" key={period}><input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={registrations[0].id}/><input type="hidden" name="period" value={period}/><fieldset><legend>{formName("GSTR1")} {periodName(period)}</legend>{rows.filter(row=>row.period_key===period).map(row=>{const data=draftSchema.parse(row.data),ready=data.lines.every(line=>line.state==="confirmed");return <label className="check" key={row.id}><input type="checkbox" name="draft" value={row.id} defaultChecked={ready && (!preferred || preferred.has(row.id))} disabled={!ready}/><Link href={`?tab=extraction&draft=${row.id}`}>{sourceNames?.find(source=>source.id===data.lines[0].source.document)?.name ?? "Source file"}</Link>, {data.lines.length} figures{ready ? ", checked" : ", check these first"}</label>;})}</fieldset><details><summary>Choose a different official version</summary><label htmlFor={`version-${period}`}>Version, if your team needs another one</label><input id={`version-${period}`} name="version" maxLength={20}/><label htmlFor={`choice-${period}`}>Reason</label><select id={`choice-${period}`} name="reason"><option value="">Choose</option><option value="amendment">Earlier work being corrected</option><option value="software">Filing software needs the earlier version</option></select></details><button className="b b-primary">Prepare {periodName(period)}</button></form>;}) : !membership.viewOnlyUntil && <form action={askPermission}><input type="hidden" name="client" value={client}/><input type="hidden" name="right" value="edit_figures"/><button className="b b-secondary">Ask to prepare forms</button></form>}</>}
  </section>;
}
