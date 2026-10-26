import Link from "next/link";
import {Fragment} from "react";
import {serverCrypto} from "@/src/lib/crypto";
import {currentMember} from "@/src/lib/member";
import {preparedSchema,formName} from "@/src/lib/prepared";
import {draftSchema} from "@/src/lib/datasets";
import {periodName} from "@/src/lib/documents";
import {itrReady,itrYear} from "@/src/lib/itr-fields";
import {itrWork} from "@/src/lib/itr";
import {grantFor} from "@/src/lib/permission-grants";
import {askPermission} from "@/app/(app)/actions";
import {Pending} from "./pending";
import {addEditedForm,decideForm,markFormFiled,prepareForm,setDraftRegistration} from "./form-actions";

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
  const [{data:rows},{data:registrations},{data:acknowledgements},{data:confirmations},{data:pans},{data:itrRows}]=await Promise.all([
    supabase.from("datasets").select("id,form_code,period_key,data").eq("firm_id",membership.firmId).eq("client_id",client).in("form_code",["GSTR1","GSTR3B"]).order("period_key",{ascending:false}).limit(100),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","gstin"),
    supabase.from("documents").select("id,name,period_key").eq("firm_id",membership.firmId).eq("client_id",client).in("document_type",["Acknowledgement","ITR-V"]).eq("status","filed").limit(100),
    supabase.from("requests").select("entity_id,details").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","form_confirmation").eq("status","pending"),
    supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","pan"),
    supabase.from("datasets").select("id,period_key,data").eq("firm_id",membership.firmId).eq("client_id",client).eq("form_code","ITR").order("period_key",{ascending:false}).limit(100),
  ]);
  // Income tax: one return per form and year that has figures entered for it, built with the
  // figures read from the client's papers for that year. Each lists what it still needs.
  const itrDrafts=(itrRows ?? []).map(row=>({...row,data:draftSchema.parse(row.data)}));
  const returns=[...new Set(itrDrafts.flatMap(row=>row.data.target && row.data.lines.some(line=>line.source.entered_by) ? [`${row.data.target.form}:${row.period_key}`] : []))].map(key=>key.split(":") as [string,string]);
  const itr=pans?.length===1 ? await Promise.all(returns.map(async([form,period])=>({form,period,missing:await itrWork(client,form,period).then(work=>work.review.missing.length,()=>null)}))) : [];
  const sourceIds=[...new Set([...(rows ?? []).map(row=>draftSchema.parse(row.data).lines[0].source.document),...itrDrafts.map(row=>row.data.lines[0].source.document)].filter((id):id is string=>!!id))];
  const {data:sourceNames}=sourceIds.length ? await supabase.from("documents").select("id,name").eq("firm_id",membership.firmId).eq("client_id",client).in("id",sourceIds) : {data:null};
  const canPrepare=!membership.viewOnlyUntil && (membership.may("edit_figures", client) || !!await grantFor(membership.firmId,userId,"edit_figures",client));
  // The client's GST numbers, shown to choose which one a register belongs to.
  const gstins=await Promise.all((registrations ?? []).map(async reg=>({id:reg.id,number:await serverCrypto().decrypt(membership.firmId,`clients/${client}/gstin`,reg.number_enc)})));
  const registrationOf=(row:{data:unknown})=>(row.data as {registration?:string}).registration ?? (gstins.length===1 ? gstins[0].id : undefined);
  const unassigned=(rows ?? []).filter(row=>row.form_code==="GSTR1" && !registrationOf(row));
  // A fill's figures still to check: approving and downloading wait for every one.
  const unchecked=(meta:{sources:{id:string}[]})=>meta.sources.reduce((sum,source)=>sum+((([...(rows ?? []),...itrDrafts].find(row=>row.id===source.id)?.data ?? {}) as {lines?:{state:string}[]}).lines ?? []).filter(line=>line.state!=="confirmed").length,0);
  const label=(row:{form_code:string;data:unknown})=>{const data=draftSchema.parse(row.data);return `${row.form_code==="GSTR3B" ? "GSTR-2B credit" : sourceNames?.find(source=>source.id===data.lines[0].source.document)?.name ?? "Source file"}, ${data.lines.length} figures${data.lines.every(line=>line.state==="confirmed") ? ", checked" : ", check these first"}`;};
  return <section className="panel" aria-labelledby="prepared-title"><h2 id="prepared-title">Prepared forms</h2>
    <p className="hint">Check every figure first. Your firm files the approved file on the portal with its own code or signature.</p>
    {message && <p className="alert" role="status">{message==="edited" ? "Choose the filled official workbook. Its headings, supported cells and figures must pass the checks, and you need permission to edit figures." : message==="ack" ? "Add the acknowledgement or its number for the latest approved form. Check that the drive is connected." : message==="approval" ? "Another person must approve the latest checked figures. A rejection needs a reason." : "Check the figures, permission, drive and official form for this period, then try again."}</p>}
    {!!forms?.length && <ul className="rows">{forms.filter(file=>file.status!=="deleted").map(file=>{
      const meta=preparedSchema.parse(file.prepared),active=latest.has(file.id) && !membership.viewOnlyUntil && file.size>0;
      return <li key={file.id}><div className="grow">
        <Link href={`/app/files/${file.id}/view`}>{file.name}</Link>
        <p className="hint">{meta.status[0].toUpperCase()+meta.status.slice(1)}. Official form {meta.template}.{!latest.has(file.id) && " Earlier version."}{meta.external && " Edited outside InboxCA."}</p>
        {meta.form==="GSTR3B" && <p className="hint">Built from your checked GSTR-1 figures and GSTR-2B credit: tables 3.1 (a), (b), (c) and (e), 3.1.1 (ii), 3.2 to unregistered buyers, 4(A) and 4(D)(2). Add reverse charge purchases (3.1 d), credit on imported services, reversals, other ineligible credit, inward exempt supplies and interest in the offline utility or on the portal before filing.</p>}
        {meta.form==="GSTR1" && meta.template==="2.0" && <p className="hint">This older official workbook comes with sample rows in its e-commerce sheets, so this file does not include supplies through e-commerce operators (tables 14 and 15). Add them in the offline tool or on the portal before filing.</p>}
        <div className="form-row">{meta.sources.map((source,n)=><Link key={source.id} href={`?tab=extraction&draft=${source.id}`}>Check source figures{meta.sources.length>1 ? ` ${n+1}` : ""}</Link>)}
          {active && ["approved","filed"].includes(meta.status) && <form action={`/app/files/${file.id}/filing`} method="post"><button className="b b-secondary b-small">Download for filing</button></form>}
          {active && meta.status==="draft" && !meta.filled && ["owner","partner","manager"].includes(membership.role) && <form action={decideForm}><input type="hidden" name="document" value={file.id}/><Pending className="b b-secondary b-small" name="decision" value="approved">Give second approval</Pending></form>}
          {active && meta.filled && meta.status==="draft" && <><button className="b b-secondary b-small" disabled>Download for filing</button>{membership.settings.second_form_approval===true && ["owner","partner","manager"].includes(membership.role) && <button className="b b-secondary b-small" disabled>Give second approval</button>}
            <span className="hint">{unchecked(meta) ? `${unchecked(meta)} ${unchecked(meta)===1 ? "figure" : "figures"} not checked yet. ` : "Every figure is checked. InboxCA is making the checked draft now. "}<Link href={`/app/files/${file.id}/view`}>Check figures</Link></span></>}
        </div>
        {active && meta.status==="draft" && !meta.filled && ["owner","partner","manager"].includes(membership.role) && <details><summary>Reject this version</summary><form action={decideForm} className="fields">
          <input type="hidden" name="document" value={file.id}/>
          <div><label htmlFor={`reason-${file.id}`}>Reason</label><select id={`reason-${file.id}`} name="reason"><option value="figures">Figures need checking</option><option value="source">Source needs checking</option><option value="other">Other reason</option></select></div>
          <div><label htmlFor={`why-${file.id}`}>What needs to change</label><input id={`why-${file.id}`} name="explanation" minLength={3} maxLength={300} required/></div>
          <Pending className="b b-ghost b-small" name="decision" value="rejected">Reject with reason</Pending>
        </form></details>}
        {active && meta.status==="approved" && membership.may("mark_filed",client) && <details><summary>Record filing</summary><form action={markFormFiled} className="fields">
          <input type="hidden" name="document" value={file.id}/>
          {confirmations?.some(item=>item.entity_id===file.id) && <p className="hint">An acknowledgement arrived. Check it before confirming this filing.</p>}
          <div><label htmlFor={`paper-${file.id}`}>Acknowledgement already in Documents</label><select id={`paper-${file.id}`} name="paper"><option value="">Choose, or add one below</option>{acknowledgements?.filter(paper=>paper.period_key===file.period_key).map(paper=><option key={paper.id} value={paper.id}>{paper.name}</option>)}</select></div>
          <div><label htmlFor={`ack-${file.id}`}>Acknowledgement number, if known</label><input id={`ack-${file.id}`} name="ack" maxLength={80}/></div>
          <div><label htmlFor={`upload-${file.id}`}>Or upload the portal acknowledgement</label><input id={`upload-${file.id}`} name="ack_file" type="file" accept=".pdf,.png,.jpg,.jpeg"/></div>
          <p className="hint">With only a number, your client gets a filing record from your firm. This does not replace the portal acknowledgement. Private papers wait for approval in the Inbox.</p>
          <Pending className="b b-secondary b-small">Mark filed</Pending>
        </form></details>}
        {active && canPrepare && <details><summary>File corrected outside InboxCA</summary><form action={addEditedForm} className="fields">
          <input type="hidden" name="document" value={file.id}/><div><label htmlFor={`edited-${file.id}`}>{meta.form.startsWith("ITR") ? "Official return file" : "Filled official workbook"}</label><input id={`edited-${file.id}`} name="edited_file" type="file" accept={meta.form.startsWith("ITR") ? ".json" : ".xlsx"} required/></div>
          <p className="hint">Prefer correcting the source figures. An uploaded correction is a new version, checked against the official form. Its figures must be checked again.</p><Pending className="b b-secondary b-small">Add corrected version</Pending>
        </form></details>}
      </div></li>;
    })}</ul>}
    {!!rows?.length && (canPrepare ? <>
      {!!unassigned.length && <><h3>Which GST number is each register for?</h3><p className="hint">This client has more than one GST number. Each register belongs to one of them.</p>{unassigned.map(row=><form action={setDraftRegistration} className="form-row" key={`reg-${row.id}`}>
        <input type="hidden" name="client" value={client}/><input type="hidden" name="draft" value={row.id}/>
        <span className="grow"><Link href={`?tab=extraction&draft=${row.id}`}>{label(row)}</Link>, {periodName(row.period_key)}</span>
        <select name="registration" aria-label={`GST number for ${label(row)}`} required defaultValue=""><option value="" disabled>Choose</option>{gstins.map(reg=><option key={reg.id} value={reg.id}>{reg.number}</option>)}</select>
        <Pending className="b b-secondary b-small">Save</Pending></form>)}</>}
      {gstins.map(reg=>{
        // A register named for this number, or any register when the client has only one;
        // GSTR-2B credit drafts hold every number's figures apart, so they serve each one.
        const own=(rows ?? []).filter(row=>row.form_code==="GSTR3B" || registrationOf(row)===reg.id),of=gstins.length>1 ? ` for ${reg.number}` : "";
        const months1=[...new Set(own.filter(row=>row.form_code==="GSTR1").map(row=>row.period_key))],months3=[...new Set(own.filter(row=>row.period_key>="2025-04").map(row=>row.period_key))];
        return <Fragment key={reg.id}>
          {!!months1.length && <><h3>Prepare GSTR-1{of}</h3>{months1.map(period=>{
            const previous=forms?.find(file=>file.period_key===period && latest.has(file.id) && preparedSchema.parse(file.prepared).form==="GSTR1" && preparedSchema.parse(file.prepared).registration===reg.id),preferred=previous ? new Set(preparedSchema.parse(previous.prepared).sources.map(source=>source.id)) : null;
            return <form action={prepareForm} className="fields" key={`1-${reg.id}-${period}`}><input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={reg.id}/><input type="hidden" name="period" value={period}/>
              <fieldset><legend>{formName("GSTR1")} {periodName(period)}</legend>{own.filter(row=>row.period_key===period && row.form_code==="GSTR1").map(row=>{const ready=draftSchema.parse(row.data).lines.every(line=>line.state==="confirmed");return <label className="check" key={row.id}><input type="checkbox" name="draft" value={row.id} defaultChecked={ready && (!preferred || preferred.has(row.id))} disabled={!ready}/><Link href={`?tab=extraction&draft=${row.id}`}>{label(row)}</Link></label>;})}</fieldset>
              <details><summary>Choose a different official version</summary><label htmlFor={`version-${reg.id}-${period}`}>Version, if your team needs another one</label><input id={`version-${reg.id}-${period}`} name="version" maxLength={20}/><label htmlFor={`choice-${reg.id}-${period}`}>Reason</label><select id={`choice-${reg.id}-${period}`} name="reason"><option value="">Choose</option><option value="amendment">Earlier work being corrected</option><option value="software">Filing software needs the earlier version</option></select></details>
              <Pending className="b b-primary">Prepare {periodName(period)}</Pending></form>;})}</>}
          {!!months3.length && <><h3>Prepare GSTR-3B{of}</h3>{months3.map(period=><form action={prepareForm} className="fields" key={`3-${reg.id}-${period}`}>
            <input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={reg.id}/><input type="hidden" name="period" value={period}/><input type="hidden" name="form" value="GSTR3B"/>
            <fieldset><legend>{formName("GSTR3B")} {periodName(period)}</legend>{own.filter(row=>row.period_key===period).map(row=>{const ready=draftSchema.parse(row.data).lines.every(line=>line.state==="confirmed");return <label className="check" key={row.id}><input type="checkbox" name="draft" value={row.id} defaultChecked={ready} disabled={!ready}/><Link href={`?tab=extraction&draft=${row.id}`}>{label(row)}</Link></label>;})}</fieldset>
            <Pending className="b b-primary">Prepare GSTR-3B {periodName(period)}</Pending></form>)}</>}
        </Fragment>;})}
    </> : !membership.viewOnlyUntil && <form action={askPermission}><input type="hidden" name="client" value={client}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-secondary">Ask to prepare forms</Pending></form>)}
    {!!pans?.length && <><h3>Income tax returns</h3>
      {pans.length!==1 ? <p className="hint">A single PAN is needed before preparing a return.</p> : !itr.length && <p className="hint">No return started yet. <Link href={`/app/clients/${client}/itr`}>Fill an income tax return</Link></p>}
      {canPrepare ? itr.map(({form,period,missing})=>{
        const sources=itrDrafts.filter(row=>row.period_key===period && (!row.data.target || row.data.target.form===form && row.data.lines.some(line=>line.source.entered_by)));
        return <form action={prepareForm} className="fields" key={`${form}-${period}`}><input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={pans[0].id}/><input type="hidden" name="period" value={period}/><input type="hidden" name="form" value={form}/>
          <fieldset><legend>{formName(form)} {itrYear(period)}</legend>{sources.map(row=>{const ready=row.data.lines.every(line=>line.state==="confirmed");return <label className="check" key={row.id}><input type="checkbox" name="draft" value={row.id} defaultChecked={ready} disabled={!ready}/><Link href={`?tab=extraction&draft=${row.id}`}>{row.data.target ? "Entered by your team" : sourceNames?.find(source=>source.id===row.data.lines[0].source.document)?.name ?? "Figures from a paper"}</Link>, {row.data.lines.length} figures{ready ? ", checked" : ", check these first"}</label>;})}</fieldset>
          {missing!==0 && <p className="hint">{missing===null ? "This return cannot be checked yet." : `${missing} details still to fill.`} <Link href={`/app/clients/${client}/itr?form=${form}&year=${period}`}>Open the return</Link></p>}
          {!itrReady() && <p className="hint">Not set up yet: InboxCA needs its software ID from the Income Tax Department before it can make the return file.</p>}
          <Pending className="b b-primary" disabled={!itrReady() || missing!==0}>Prepare {formName(form)} {itrYear(period)}</Pending>
        </form>;
      }) : !rows?.length && !membership.viewOnlyUntil && <form action={askPermission}><input type="hidden" name="client" value={client}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-secondary">Ask to prepare forms</Pending></form>}
    </>}
  </section>;
}
