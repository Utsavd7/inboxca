import "./returns.css";
import Link from "next/link";
import {Fragment} from "react";
import {Check,ChevronDown,Ellipsis,FilePlus2,FileText,Info,LoaderCircle} from "lucide-react";
import {serverCrypto} from "@/src/lib/crypto";
import {currentMember,viewOnlyWords} from "@/src/lib/member";
import {preparedSchema,formName} from "@/src/lib/prepared";
import {draftSchema} from "@/src/lib/datasets";
import {periodName} from "@/src/lib/documents";
import {itrReady,itrYear} from "@/src/lib/itr-fields";
import {itrWork} from "@/src/lib/itr";
import {itrChecks} from "@/src/lib/itr-check";
import {grantFor} from "@/src/lib/permission-grants";
import {askPermission} from "@/app/(app)/actions";
import {Pending} from "./pending";
import {ItrDifferences} from "./itr-check";
import {keptReason} from "@/src/lib/reason";
import {Badge,IconTile,Toast,type Tone} from "./ui";
import {MenuClose,Refresh} from "./returns-client";
import {addEditedForm,decideForm,markFormFiled,prepareForm,setDraftRegistration} from "./form-actions";

// A return file's four steps, and where each state of a version stands on them.
const steps=["Figures checked","Prepared","Approved","Filed"];
const stages:Record<string,{done:number;word:string;tone:Tone}>={
  preparing:{done:1,word:"Preparing",tone:"blue"},stalled:{done:1,word:"Not finished",tone:""},
  check:{done:0,word:"Draft",tone:"warn"},making:{done:1,word:"Draft",tone:"warn"},outdated:{done:1,word:"Out of date",tone:""},waiting:{done:2,word:"Waiting for second approval",tone:"warn"},
  approved:{done:3,word:"Approved",tone:"blue"},filed:{done:4,word:"Filed",tone:"done"},rejected:{done:0,word:"Rejected",tone:""},
};
// The GSTR-3B parts InboxCA fills from checked GSTR-1 and GSTR-2B figures, and those left for
// the offline utility or the portal (worker/gstr3b.ts).
const filled3b=["3.1 (a)","3.1 (b)","3.1 (c)","3.1 (e)","3.1.1 (ii)","3.2 Supplies to unregistered persons","4(A)","4(D)(2)"];
const left3b=["3.1 (d) Reverse charge purchases","ITC on import of services","ITC reversals","Other ineligible ITC","Exempt inward supplies","Interest"];
// A file still being saved is shown as preparing for two minutes after it was started.
const recent=(at:string)=>Date.now()-Date.parse(at)<120_000;

function Steps({done,busy}:{done:number;busy:boolean}) {
  return <ol className={`rf-steps${done===steps.length ? " is-filed" : ""}`} aria-label={`${done} of ${steps.length} steps done`}>
    {steps.map((step,n)=><li key={step} className={n<done ? "is-done" : n===done ? `is-now${busy ? " is-busy" : ""}` : undefined} aria-current={n===done ? "step" : undefined}>
      <span className="rf-dot" aria-hidden>{n<done && <Check size={11} strokeWidth={3}/>}</span>{step}
    </li>)}
  </ol>;
}

export async function PreparedForms({client,message}:{client?:string;message?:string}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) return null;
  let query=supabase.from("documents").select("id,client_id,name,period_key,size,status,prepared,received_at,clients(name)").eq("firm_id",membership.firmId).not("prepared","is",null).order("prepared->version",{ascending:false}).order("received_at",{ascending:false}).limit(100);
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
    return review?.length ? <section className="panel"><h2>Forms to review</h2><ul className="rows">{review.map(file=><li key={file.id}><Link href={`/app/clients/${file.client_id}?tab=outputs`}>{file.clients?.name}: {file.name}</Link>{waiting?.some(item=>item.entity_id===file.id) && <span className="hint">An acknowledgement arrived. Mark it filed.</span>}</li>)}</ul></section> : null;
  }
  const [{data:rows},{data:registrations},{data:acknowledgements},{data:confirmations},{data:pans},{data:itrRows}]=await Promise.all([
    supabase.from("datasets").select("id,form_code,period_key,revision,data").eq("firm_id",membership.firmId).eq("client_id",client).in("form_code",["GSTR1","GSTR3B"]).order("period_key",{ascending:false}).limit(100),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","gstin"),
    supabase.from("documents").select("id,name,period_key").eq("firm_id",membership.firmId).eq("client_id",client).in("document_type",["Acknowledgement","ITR-V"]).eq("status","filed").limit(100),
    supabase.from("requests").select("entity_id,details").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","form_confirmation").eq("status","pending"),
    supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("kind","pan"),
    supabase.from("datasets").select("id,period_key,revision,data").eq("firm_id",membership.firmId).eq("client_id",client).eq("form_code","ITR").order("period_key",{ascending:false}).limit(100),
  ]);
  // Income tax: one return per form and year that has figures entered for it, built with the
  // figures read from the client's papers for that year. Each lists what it still needs.
  const itrDrafts=(itrRows ?? []).map(row=>({...row,data:draftSchema.parse(row.data)}));
  const returns=[...new Set(itrDrafts.flatMap(row=>row.data.target && row.data.lines.some(line=>line.source.entered_by) ? [`${row.data.target.form}:${row.period_key}`] : []))].map(key=>key.split(":") as [string,string]);
  const itr=pans?.length===1 ? await Promise.all(returns.map(async([form,period])=>({form,period,missing:await itrWork(client,form,period).then(work=>work.review.missing.length,()=>null)}))) : [];
  // Each return against the client's Form 26AS and Form 16: the returns to prepare, and the
  // latest prepared returns waiting for a second approval, made from their own sources.
  const works=[...itr.map(({form,period})=>({key:`${form}:${period}`,client,period,form})),...(forms ?? []).flatMap(file=>{
    const meta=preparedSchema.parse(file.prepared);
    return latest.has(file.id) && meta.status==="draft" && /^ITR/.test(meta.form) ? [{key:file.id,client,period:file.period_key,form:meta.form,sources:meta.sources.map(source=>source.id)}] : [];
  })];
  const checks=new Map((await itrChecks(supabase,membership.firmId,works).catch(()=>[])).map((check,at)=>[works[at].key,check.differences]));
  const sourceIds=[...new Set([...(rows ?? []).map(row=>draftSchema.parse(row.data).lines[0].source.document),...itrDrafts.map(row=>row.data.lines[0].source.document)].filter((id):id is string=>!!id))];
  const {data:sourceNames}=sourceIds.length ? await supabase.from("documents").select("id,name").eq("firm_id",membership.firmId).eq("client_id",client).in("id",sourceIds) : {data:null};
  const canPrepare=!membership.viewOnlyUntil && (membership.may("edit_figures", client) || !!await grantFor(membership.firmId,userId,"edit_figures",client));
  // The client's GST numbers, shown to choose which one a register belongs to.
  const gstins=await Promise.all((registrations ?? []).map(async reg=>({id:reg.id,number:await serverCrypto().decrypt(membership.firmId,`clients/${client}/gstin`,reg.number_enc)})));
  const registrationOf=(row:{data:unknown})=>(row.data as {registration?:string}).registration ?? (gstins.length===1 ? gstins[0].id : undefined);
  const unassigned=(rows ?? []).filter(row=>row.form_code==="GSTR1" && !registrationOf(row));
  // A draft made from figures that changed since (a correction): it can no longer be approved
  // (private.form_current), even where the firm needs no second approval, and a newer version
  // follows once every figure is checked.
  const outdated=(meta:{sources:{id:string;revision:number}[]})=>meta.sources.some(source=>{const row=[...(rows ?? []),...itrDrafts].find(row=>row.id===source.id);return !!row && row.revision!==source.revision;});
  // A fill's figures still to check: approving and downloading wait for every one.
  const unchecked=(meta:{sources:{id:string}[]})=>meta.sources.reduce((sum,source)=>sum+((([...(rows ?? []),...itrDrafts].find(row=>row.id===source.id)?.data ?? {}) as {lines?:{state:string}[]}).lines ?? []).filter(line=>line.state!=="confirmed").length,0);
  const label=(row:{form_code:string;data:unknown})=>{const data=draftSchema.parse(row.data);return `${row.form_code==="GSTR3B" ? "GSTR-2B credit" : sourceNames?.find(source=>source.id===data.lines[0].source.document)?.name ?? "Source file"}, ${data.lines.length} figures${data.lines.every(line=>line.state==="confirmed") ? ", checked" : ", check these first"}`;};
  const reason=message ? await keptReason() : undefined;
  // Why this person cannot take a step, by the same rules the server keeps.
  const approver=["owner","partner","manager"].includes(membership.role);
  const viewOnly=viewOnlyWords(membership.viewOnlyUntil);
  // Each return's versions, newest first: the newest as a card, the earlier ones listed in it.
  const keyOf=(file:{client_id:string;period_key:string;prepared:unknown})=>{const meta=preparedSchema.parse(file.prepared);return [file.client_id,file.period_key,meta.form,meta.registration].join(":");};
  const versions=new Map<string,NonNullable<typeof forms>>();
  for(const file of (forms ?? []).filter(file=>file.status!=="deleted")) versions.set(keyOf(file),[...(versions.get(keyOf(file)) ?? []),file]);
  const preparing=new Set([...versions].filter(([,[file]])=>latest.has(file.id) && !file.size && recent(file.received_at)).map(([key])=>key));
  const made=new Set([...versions].filter(([,[file]])=>preparedSchema.parse(file.prepared).status!=="rejected").map(([key])=>key));
  // A Prepare button: quiet once the return has a file, and waiting while one is being saved.
  const prepareButton=(key:string,words:string)=><Pending className={`b ${made.has(key) ? "b-secondary" : "b-primary"}`} disabled={preparing.has(key)}>{preparing.has(key) ? <><LoaderCircle className="rf-spin" size={14} aria-hidden/>Preparing…</> : words}</Pending>;
  const source=(row:{id:string;data:unknown},name:string,picked:(ready:boolean)=>boolean)=>{
    const data=draftSchema.parse(row.data),ready=data.lines.every(line=>line.state==="confirmed");
    return <label className={`rf-src${ready ? "" : " is-todo"}`} key={row.id}><input type="checkbox" name="draft" value={row.id} defaultChecked={picked(ready)} disabled={!ready}/>
      <span><Link href={`?tab=extraction&draft=${row.id}`}>{name}</Link><small>{data.lines.length} figures, {ready ? "checked" : "check these first"}</small></span></label>;
  };
  const ask=<form action={askPermission} className="rf-row"><input type="hidden" name="client" value={client}/><input type="hidden" name="right" value="edit_figures"/><span className="grow hint">Preparing a return needs the right to edit figures.</span><Pending className="b b-secondary">Ask to prepare returns</Pending></form>;
  const toast=message==="gstin" ? "GSTIN saved for this register." : "";

  // Where a version stands: being saved, its figures to check, waiting for approval, and so on.
  const stageOf=(file:NonNullable<typeof forms>[number])=>{
    const meta=preparedSchema.parse(file.prepared),old=meta.status==="draft" && !meta.filled && outdated(meta),open=meta.status==="draft" && (meta.filled || old) ? unchecked(meta) : 0;
    return {open,stage:!file.size ? (latest.has(file.id) && recent(file.received_at) ? "preparing" : "stalled") : meta.status!=="draft" ? meta.status : meta.filled ? (open ? "check" : "making") : old ? "outdated" : "waiting"};
  };
  const card=(file:NonNullable<typeof forms>[number],older:NonNullable<typeof forms>)=>{
    const meta=preparedSchema.parse(file.prepared),head=latest.has(file.id),active=head && !membership.viewOnlyUntil && file.size>0,{open,stage}=stageOf(file);
    const {done,word,tone}=stages[stage],decides=head && stage==="waiting";
    const period=meta.form.startsWith("ITR") ? itrYear(file.period_key) : periodName(file.period_key),number=gstins.length>1 ? gstins.find(reg=>reg.id===meta.registration)?.number : undefined;
    const download=(primary:boolean)=><form action={`/app/files/${file.id}/filing`} method="post"><button className={`b ${primary ? "b-primary" : "b-secondary"}`} disabled={!active}>Download for filing</button></form>;
    const arrived=confirmations?.some(item=>item.entity_id===file.id);
    let primary:React.ReactNode=null,second:React.ReactNode=null,note:React.ReactNode=null;
    if(stage==="preparing") note=<span aria-live="polite">InboxCA is preparing this file. It shows here when it is ready.</span>;
    else if(stage==="stalled") note="This file was not finished. Prepare it again below.";
    else if(stage==="check") {primary=<Link className="b b-primary" href={`/app/files/${file.id}/view`}>Check figures</Link>;second=<button className="b b-secondary" disabled>Download for filing</button>;note=`${open} ${open===1 ? "figure" : "figures"} not checked yet. Approving and downloading wait until every figure is checked.`;}
    else if(stage==="making") {second=<button className="b b-secondary" disabled>Download for filing</button>;note=<span aria-live="polite">Every figure is checked. InboxCA is making the checked draft now.</span>;}
    else if(stage==="outdated" && open) {primary=<Link className="b b-primary" href={`?tab=extraction&draft=${(meta.sources.find(source=>unchecked({sources:[source]})) ?? meta.sources[0]).id}`}>Check figures</Link>;note=`The figures changed after this file was made. Check ${open===1 ? "the figure" : `the ${open} figures`} not checked yet, and InboxCA makes a newer version.`;}
    else if(stage==="outdated") note=<span aria-live="polite">Out of date. The figures changed after this file was made, and InboxCA is making a newer version.</span>;
    else if(stage==="waiting") {
      primary=active && approver ? <form action={decideForm} id={`approve-${file.id}`}><input type="hidden" name="document" value={file.id}/><Pending className="b b-primary" name="decision" value="approved">Give second approval</Pending></form> : <button className="b b-primary" disabled>Give second approval</button>;
      note=viewOnly || (!approver ? "Only the firm's owner, a partner or a manager can give the second approval." : "Check the file, then give the second approval.");
    }
    else if(stage==="approved") {
      primary=download(true);
      second=active && membership.may("mark_filed",client) ? <details className="rf-menu"><summary className="b b-secondary">Mark filed<ChevronDown size={14} aria-hidden/></summary><div className="rf-pop is-end"><form action={markFormFiled} className="rf-pop-form">
        <input type="hidden" name="document" value={file.id}/>
        <div><label htmlFor={`paper-${file.id}`}>Acknowledgement already in Documents</label><select id={`paper-${file.id}`} name="paper"><option value="">Choose, or add one below</option>{acknowledgements?.filter(paper=>paper.period_key===file.period_key).map(paper=><option key={paper.id} value={paper.id}>{paper.name}</option>)}</select></div>
        <div><label htmlFor={`ack-${file.id}`}>Acknowledgement number, if known</label><input id={`ack-${file.id}`} name="ack" maxLength={80}/></div>
        <div><label htmlFor={`upload-${file.id}`}>Or upload the portal acknowledgement</label><input id={`upload-${file.id}`} name="ack_file" type="file" accept=".pdf,.png,.jpg,.jpeg"/></div>
        <p className="hint">If you type only the number, InboxCA makes a short filing note from your firm for the client. It is not the portal acknowledgement. A private paper is sent only after someone approves it in the Inbox.</p>
        <Pending className="b b-primary">Mark filed</Pending>
      </form></div></details> : <button className="b b-secondary" disabled>Mark filed</button>;
      note=viewOnly || (arrived ? "An acknowledgement arrived. Check it, then mark the return filed." : !membership.may("mark_filed",client) ? "Ask your firm's owner for permission to mark returns filed." : "Download it, file it on the portal, then mark it filed here.");
    }
    else if(stage==="filed") second=active && download(false);
    else if(stage==="rejected") {primary=head && <Link className="b b-primary" href={`?tab=extraction&draft=${meta.sources[0].id}`}>Correct the figures</Link>;note="Draft sent back. Correct the figures, then prepare it again.";}
    if(!head) {primary=second=null;note="An earlier version.";}
    const reject=active && decides && approver,upload=active && canPrepare;
    return <li key={file.id} className={`rf-card is-${stage}`}>
      <div className="rf-top">
        <IconTile Icon={FileText} kind={stage==="filed" ? "done" : "docs"}/>
        <div className="rf-name">
          <div className="rf-title"><h3>{formName(meta.form)} {period}{number && <span className="sub-inline">{number}</span>}</h3><Badge tone={tone}>{stage==="preparing" && <LoaderCircle className="rf-spin" size={12} aria-hidden/>}{word}</Badge></div>
          <p className="sub"><Link href={`/app/files/${file.id}/view`}>{file.name}</Link><span>Official version {meta.template}.{meta.external && " Corrected outside InboxCA."}</span></p>
        </div>
        <div className="rf-acts">
          {(meta.sources.length || reject || upload) && <details className="rf-menu"><summary className="b b-ghost" aria-label="More for this file">More<Ellipsis size={15} aria-hidden/></summary><div className="rf-pop is-end">
            {meta.sources.map((source,n)=><Link key={source.id} className="rf-pop-item" href={`?tab=extraction&draft=${source.id}`}>Check source figures{meta.sources.length>1 ? ` ${n+1}` : ""}</Link>)}
            {reject && <details className="rf-sub"><summary className="rf-pop-item">Reject this version</summary><form action={decideForm} className="rf-pop-form">
              <input type="hidden" name="document" value={file.id}/>
              <div><label htmlFor={`reason-${file.id}`}>Reason</label><select id={`reason-${file.id}`} name="reason"><option value="figures">Figures need checking</option><option value="source">Source needs checking</option><option value="other">Other reason</option></select></div>
              <div><label htmlFor={`why-${file.id}`}>What needs to change</label><input id={`why-${file.id}`} name="explanation" minLength={3} maxLength={300} required/></div>
              <Pending className="b b-secondary" name="decision" value="rejected">Reject with reason</Pending>
            </form></details>}
            {upload && <details className="rf-sub"><summary className="rf-pop-item">Upload a file you corrected outside InboxCA</summary><form action={addEditedForm} className="rf-pop-form">
              <input type="hidden" name="document" value={file.id}/><div><label htmlFor={`edited-${file.id}`}>{meta.form.startsWith("ITR") ? "Official return file" : "Filled official workbook"}</label><input id={`edited-${file.id}`} name="edited_file" type="file" accept={meta.form.startsWith("ITR") ? ".json" : ".xlsx"} required/></div>
              <p className="hint">Better to correct the figures in InboxCA. An upload becomes a new version, and its figures are checked again.</p><Pending className="b b-secondary">Add corrected version</Pending>
            </form></details>}
          </div></details>}
          {second}{primary}
        </div>
      </div>
      <Steps done={done} busy={stage==="preparing" || stage==="making"}/>
      {note && <p className={`rf-note${stage==="preparing" || stage==="making" ? " is-busy" : ""}`}>{note}</p>}
      {meta.form==="GSTR1" && meta.template==="2.0" && <p className="rf-notice"><Info size={15} aria-hidden/>This older official workbook leaves out supplies through e-commerce operators (tables 14 and 15). Add them in the offline tool or on the portal before filing.</p>}
      {meta.form==="GSTR3B" && <details className="rf-tables"><summary><Check size={15} aria-hidden/>InboxCA filled {filled3b.length} parts from your checked GSTR-1 and GSTR-2B figures. Add {left3b.length} more on the portal before filing.<ChevronDown size={15} aria-hidden/></summary>
        <div className="rf-tables-body">
          <div><h4>Filled by InboxCA</h4><ul className="rf-chips">{filled3b.map(part=><li key={part}>{part}</li>)}</ul></div>
          <div><h4>Add on the portal</h4><ul className="rf-chips is-left">{left3b.map(part=><li key={part}>{part}</li>)}</ul><p className="hint">Add these in the offline utility or on the portal before filing.</p></div>
        </div>
      </details>}
      {active && decides && approver && <ItrDifferences differences={checks.get(file.id) ?? []} tick={`approve-${file.id}`}/>}
      {!!older.length && <details className="rf-older"><summary>Earlier versions<span className="count-pill">{older.length}</span><ChevronDown size={14} aria-hidden/></summary><ul>{older.map(file=>{
        const meta=preparedSchema.parse(file.prepared);
        return <li key={file.id}><Link href={`/app/files/${file.id}/view`}>{file.name}</Link><Badge tone={meta.status==="filed" ? "done" : ""}>{file.size ? meta.status[0].toUpperCase()+meta.status.slice(1) : "Not finished"}</Badge><span className="hint">Official version {meta.template}.{meta.external && " Corrected outside InboxCA."}</span>{meta.sources.map((source,n)=><Link key={source.id} href={`?tab=extraction&draft=${source.id}`}>Check source figures{meta.sources.length>1 ? ` ${n+1}` : ""}</Link>)}</li>;
      })}</ul></details>}
    </li>;
  };

  return <section className="rf" aria-labelledby="prepared-title">
    <MenuClose/>
    <header className="rf-head"><h2 id="prepared-title">Return files</h2><p className="hint">Check every figure first. After approval, download the file and file it on the portal with your own code or signature.</p></header>
    {toast ? <Toast>{toast}</Toast> : message && <p className="alert" role="status">{reason ?? (message==="edited" ? "InboxCA could not use this file. Choose the official workbook or return file you filled, with its headings unchanged. You also need permission to edit figures." : message==="ack" ? "The return was not marked filed. Choose or upload the acknowledgement, or type its number, then try again." : message==="approval" ? "The approval was not saved. Someone other than the person who checked the figures must approve. To reject, choose a reason and say what must change." : message==="differences" ? "This return differs from Form 26AS or Form 16. Look at the differences and tick the box, then approve again." : "InboxCA could not prepare this return. Check that every figure is checked and that your firm's drive is connected, then try again.")}</p>}
    {!!versions.size && <ul className="rf-list">{[...versions.values()].map(([file,...older])=>card(file,older))}</ul>}
    {[...versions.values()].some(([file])=>{const {stage,open}=stageOf(file);return stage==="preparing" || stage==="making" || stage==="outdated" && !open;}) && <Refresh/>}
    {(!!rows?.length || !!pans?.length) && <div className="app-card rf-prepare">
      <header className="app-card-head"><IconTile Icon={FilePlus2} kind="docs"/><h2>Prepare a return</h2><span className="hint">InboxCA fills the official file from checked figures only.</span></header>
      {!!rows?.length && (canPrepare ? <>
        {!!unassigned.length && <div className="rf-group"><h3>Which GSTIN is each register for?</h3><p className="hint">This client has more than one GSTIN. Each register belongs to one of them.</p>{unassigned.map(row=><form action={setDraftRegistration} className="rf-row" key={`reg-${row.id}`}>
          <input type="hidden" name="client" value={client}/><input type="hidden" name="draft" value={row.id}/>
          <span className="grow"><Link href={`?tab=extraction&draft=${row.id}`}>{label(row)}</Link>, {periodName(row.period_key)}</span>
          <select name="registration" aria-label={`GSTIN for ${label(row)}`} required defaultValue=""><option value="" disabled>Choose</option>{gstins.map(reg=><option key={reg.id} value={reg.id}>{reg.number}</option>)}</select>
          <Pending className="b b-secondary">Save</Pending></form>)}</div>}
        {gstins.map(reg=>{
          // A register named for this number, or any register when the client has only one;
          // GSTR-2B credit drafts hold every number's figures apart, so they serve each one.
          const own=(rows ?? []).filter(row=>row.form_code==="GSTR3B" || registrationOf(row)===reg.id),of=gstins.length>1 ? ` for ${reg.number}` : "";
          const months1=[...new Set(own.filter(row=>row.form_code==="GSTR1").map(row=>row.period_key))],months3=[...new Set(own.filter(row=>row.period_key>="2025-04").map(row=>row.period_key))];
          return <Fragment key={reg.id}>
            {!!months1.length && <div className="rf-group"><h3>Prepare GSTR-1{of}</h3>{months1.map(period=>{
              const previous=forms?.find(file=>file.period_key===period && latest.has(file.id) && preparedSchema.parse(file.prepared).form==="GSTR1" && preparedSchema.parse(file.prepared).registration===reg.id),preferred=previous ? new Set(preparedSchema.parse(previous.prepared).sources.map(source=>source.id)) : null;
              return <form action={prepareForm} className="rf-prep" key={`1-${reg.id}-${period}`}><input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={reg.id}/><input type="hidden" name="period" value={period}/>
                <fieldset><legend>{formName("GSTR1")} {periodName(period)}</legend><div className="rf-srcs">{own.filter(row=>row.period_key===period && row.form_code==="GSTR1").map(row=>source(row,sourceNames?.find(item=>item.id===draftSchema.parse(row.data).lines[0].source.document)?.name ?? "Source file",ready=>ready && (!preferred || preferred.has(row.id))))}</div></fieldset>
                <details className="rf-older-tool"><summary>Use an older offline tool version</summary><div className="rf-fields"><div><label htmlFor={`version-${reg.id}-${period}`}>Version number</label><input id={`version-${reg.id}-${period}`} name="version" maxLength={20}/></div><div><label htmlFor={`choice-${reg.id}-${period}`}>Reason</label><select id={`choice-${reg.id}-${period}`} name="reason"><option value="">Choose</option><option value="amendment">Correcting an earlier return (amendment)</option><option value="software">Our filing software needs the older version</option></select></div></div></details>
                {prepareButton([client,period,"GSTR1",reg.id].join(":"),`Prepare ${periodName(period)}`)}</form>;})}</div>}
            {!!months3.length && <div className="rf-group"><h3>Prepare GSTR-3B{of}</h3>{months3.map(period=><form action={prepareForm} className="rf-prep" key={`3-${reg.id}-${period}`}>
              <input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={reg.id}/><input type="hidden" name="period" value={period}/><input type="hidden" name="form" value="GSTR3B"/>
              <fieldset><legend>{formName("GSTR3B")} {periodName(period)}</legend><div className="rf-srcs">{own.filter(row=>row.period_key===period).map(row=>source(row,row.form_code==="GSTR3B" ? "GSTR-2B credit" : sourceNames?.find(item=>item.id===draftSchema.parse(row.data).lines[0].source.document)?.name ?? "Source file",ready=>ready))}</div></fieldset>
              {prepareButton([client,period,"GSTR3B",reg.id].join(":"),`Prepare GSTR-3B ${periodName(period)}`)}</form>)}</div>}
          </Fragment>;})}
      </> : !membership.viewOnlyUntil ? <div className="rf-group">{ask}</div> : <p className="rf-row hint">{viewOnly}</p>)}
      {!!pans?.length && <div className="rf-group"><h3>Income tax returns</h3>
        {pans.length!==1 ? <p className="rf-notice"><Info size={15} aria-hidden/>This client has more than one PAN. Keep only one PAN to prepare an income tax return.</p> : !itr.length && <div className="rf-row"><span className="grow">No return started yet.</span><Link className="b b-secondary" href={`/app/clients/${client}/itr`}>Fill an income tax return</Link></div>}
        {canPrepare ? itr.map(({form,period,missing})=>{
          const sources=itrDrafts.filter(row=>row.period_key===period && (!row.data.target || row.data.target.form===form && row.data.lines.some(line=>line.source.entered_by)));
          return <form action={prepareForm} className="rf-prep" key={`${form}-${period}`}><input type="hidden" name="client" value={client}/><input type="hidden" name="registration" value={pans[0].id}/><input type="hidden" name="period" value={period}/><input type="hidden" name="form" value={form}/>
            <fieldset><legend>{formName(form)} {itrYear(period)}</legend><div className="rf-srcs">{sources.map(row=>source(row,row.data.target ? "Entered by your team" : sourceNames?.find(item=>item.id===row.data.lines[0].source.document)?.name ?? "Figures from a paper",ready=>ready))}</div></fieldset>
            <div className="rf-prep-notes">
              {missing!==0 && <p className="hint">{missing===null ? "This return cannot be checked yet." : `${missing} details still to fill.`} <Link href={`/app/clients/${client}/itr?form=${form}&year=${period}`}>Open the return</Link></p>}
              {!itrReady() && <p className="rf-notice"><Info size={15} aria-hidden/>InboxCA cannot make the return file for the income tax portal yet. It is waiting for its software ID from the Income Tax Department.</p>}
              <ItrDifferences differences={checks.get(`${form}:${period}`) ?? []} tick/>
            </div>
            <Pending className="b b-primary" disabled={!itrReady() || missing!==0}>Prepare {formName(form)} {itrYear(period)}</Pending>
          </form>;
        }) : !rows?.length && (!membership.viewOnlyUntil ? ask : <p className="rf-row hint">{viewOnly}</p>)}
      </div>}
    </div>}
  </section>;
}
