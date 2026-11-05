import Form from "next/form";
import Link from "next/link";
import {ChevronLeft,FileCheck2,FilePlus2,FileSpreadsheet,ListChecks,ReceiptIndianRupee,UserRoundCheck} from "lucide-react";
import {notFound,redirect} from "next/navigation";
import {currentMember,viewOnlyWords} from "@/src/lib/member";
import {serverCrypto} from "@/src/lib/crypto";
import {grantFor} from "@/src/lib/permission-grants";
import {periodLabel,dueLabel} from "@/src/lib/calendar";
import {keptReason} from "@/src/lib/reason";
import {workerSheet} from "@/src/lib/worker-read";
import {sameHeadings} from "@/src/lib/sales-register";
import {preparedSchema} from "@/src/lib/prepared";
import {formatChanged,savedTdsMappings,tdsWork} from "@/src/lib/tds-draft";
import {minorHeads,rupees,statementPeriod,suggestTds,tdsFields,type TdsKind} from "@/src/lib/tds";
import {askPermission} from "@/app/(app)/actions";
import {prepareForm} from "../../../form-actions";
import {Badge,Card,PageHead} from "../../../ui";
import {Pending} from "../../../pending";
import {checkTds,enterTdsFigures,readTds} from "../tds-actions";
import "../../clients.css";

const messages:Record<string,string>={read:"Figures read. Check them below.",entered:"Saved for checking.",checked:"Every figure is checked. Prepare the statement below.",flagged:"Checked, except the rows listed to look at one by one.",permission:"You need permission for this step. Ask your firm's owner or choose Ask to edit figures."};
const day=(value:string)=>value ? dueLabel(value) : "";

// One TDS statement, Form No. 140, for one TAN and quarter (PLAN.md "TDS returns"): the client's
// payment and challan registers read with the columns a person confirms, challans typed by hand,
// every rule of Protean's file format checked, the figures checked by a person, then the file.
// The CA validates it with Protean's File Validation Utility and files it.
export default async function TdsPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {id}=await params,q=await searchParams;
  const {supabase,membership,userId}=await currentMember();
  if(!membership) redirect("/app");
  const firm=membership.firmId;
  const [{data:client},{data:numbers}]=await Promise.all([
    supabase.from("clients").select("id,name").eq("firm_id",firm).eq("id",id).maybeSingle(),
    supabase.from("client_registrations").select("id,number_enc").eq("firm_id",firm).eq("client_id",id).eq("kind","tan"),
  ]);
  if(!client) notFound();
  const crumb=<Link className="crumb" href={`/app/clients/${id}?tab=returns`}><ChevronLeft size={14} aria-hidden/>{client.name}</Link>;
  if(!numbers?.length) return <><PageHead crumb={crumb} title="TDS statement"/><div className="pane client-pane"><p className="hint">Add the client&apos;s TAN under Tax numbers on its <Link href={`/app/clients/${id}?tab=numbers`}>Overview</Link> first.</p></div></>;
  const tans=await Promise.all(numbers.map(async row=>({id:row.id,number:await serverCrypto().decrypt(firm,`clients/${id}/tan`,row.number_enc)})));
  const tan=tans.find(row=>row.id===q.tan) ?? tans[0];
  // The quarters of Form No. 140, from the June 2026 quarter to the one running now.
  const now=new Date().toISOString().slice(0,7),quarters:string[]=[];
  for(let y=2026,m=6;`${y}-${String(m).padStart(2,"0")}`<=`${now.slice(0,4)}-${String(Math.ceil(Number(now.slice(5,7))/3)*3).padStart(2,"0")}`;m===12 ? (y++,m=3) : (m+=3)) quarters.push(`${y}-${String(m).padStart(2,"0")}`);
  const period=statementPeriod(q.period ?? "") ? q.period! : quarters.at(-2) ?? quarters[0];
  const base=`/app/clients/${id}/tds?tan=${tan.id}&period=${period}`;
  const [work,changed]=await Promise.all([tdsWork(supabase,firm,id,tan.id,period),formatChanged()]);
  const viewOnly=!!membership.viewOnlyUntil,canEdit=!viewOnly && (membership.may("edit_figures",id) || !!await grantFor(firm,userId,"edit_figures",id)),canCheck=!viewOnly && membership.may("check_figures",id);
  const lines=work.drafts.flatMap(draft=>draft.data.lines.map(line=>({draft:draft.id,line}))),draftOf=new Map(lines.map(item=>[item.line.id,item.draft]));
  const open=lines.filter(item=>item.line.state!=="confirmed").length,wrong=lines.filter(item=>item.line.state==="rejected").length;
  const figureLink=(line?:string)=>line && draftOf.has(line) ? `/app/clients/${id}?tab=extraction&draft=${draftOf.get(line)}&line=${line}&view=list` : undefined;
  const entered=work.drafts.find(draft=>draft.data.lines.some(line=>line.source.entered_by));
  const answered=work.read.previous;
  // The token of the last Form No. 140 this TAN filed in InboxCA, offered for the next quarter.
  const {data:before}=answered ? {data:null} : await supabase.from("tasks").select("details").eq("firm_id",firm).eq("client_id",id).eq("registration_id",tan.id).eq("code","TDS_RET").eq("status","filed").gte("period_key","2026-06").lt("period_key",period).order("period_key",{ascending:false}).limit(1);
  const token=String((before?.[0]?.details as {ack?:string} | undefined)?.ack ?? "").replace(/\D/g,""),known=/^\d{15}$/.test(token);
  // The client's spreadsheets not read yet, to read as payments or challans.
  const read=new Set(work.drafts.map(draft=>draft.id));
  const {data:files}=await supabase.from("documents").select("id,name,sha256,received_at").eq("firm_id",firm).eq("client_id",id).eq("status","filed").is("prepared",null).order("received_at",{ascending:false}).limit(100);
  const sheets=(files ?? []).filter(file=>/\.(xlsx?|ods|csv)$/i.test(file.name));
  const registers=sheets.filter(file=>!read.has(file.id)),chosen=registers.find(file=>file.id===q.source),kind:TdsKind=q.kind==="challans" ? "challans" : "payments";
  let rows:string[][]=[],problem="";
  if(chosen) {try {rows=await workerSheet(firm,chosen);} catch {problem="InboxCA could not read this register. Check that your firm's drive is connected, and that the first sheet has at most 1,000 rows and 26 columns.";}}
  const remembered=rows.length ? (await savedTdsMappings(firm,id)).filter(map=>map.kind===kind && sameHeadings(rows[map.header] ?? [],map.headings)) : [];
  const header=Number(q.header || (remembered[0]?.header ?? 0)+1),headings=Number.isInteger(header) && header>=1 && header<=40 ? rows[header-1] ?? [] : [];
  const suggested=remembered[0]?.header===header-1 ? remembered[0].columns : suggestTds(kind,headings);
  // The latest prepared statement for this TAN and quarter.
  const {data:made}=await supabase.from("documents").select("id,name,prepared").eq("firm_id",firm).eq("client_id",id).eq("period_key",period).eq("prepared->>form","TDS140").eq("prepared->>registration",tan.id).neq("status","deleted").order("received_at",{ascending:false}).limit(1);
  const latest=made?.[0] ? {...made[0],meta:preparedSchema.parse(made[0].prepared)} : null;
  const message=q.message ? q.message==="check" ? (await keptReason()) ?? "InboxCA could not save this. Check the columns, dates and amounts, then try again." : messages[q.message] : "";
  const hidden=<><input type="hidden" name="client" value={id}/><input type="hidden" name="tan" value={tan.id}/><input type="hidden" name="period" value={period}/></>;
  const ask=!viewOnly && !canEdit && <form action={askPermission}><input type="hidden" name="client" value={id}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-secondary">Ask to edit figures</Pending></form>;
  const ready=!work.check.errors.length && !open && work.drafts.length>0;
  const rowErrors=work.check.errors.filter(issue=>issue.line),plain=work.check.errors.filter(issue=>!issue.line);
  return <>
    <PageHead crumb={crumb} title={`Form No. 140, ${periodLabel("quarterly",period)}`}
      sub={<span className="head-meta"><span>TDS statement for payments other than salary, TAN <span className="num">{tan.number}</span>. InboxCA prepares the file; you validate it with Protean&apos;s FVU and file it.</span></span>}/>
    <div className="pane client-pane">
    <Form action={`/app/clients/${id}/tds`} className="form-row">
      {tans.length>1 && <div><label htmlFor="tan">TAN</label><select id="tan" name="tan" defaultValue={tan.id}>{tans.map(row=><option key={row.id} value={row.id}>{row.number}</option>)}</select></div>}
      {tans.length===1 && <input type="hidden" name="tan" value={tan.id}/>}
      <div><label htmlFor="period">Quarter</label><select id="period" name="period" defaultValue={period}>{quarters.map(key=><option key={key} value={key}>{periodLabel("quarterly",key)}</option>)}</select></div>
      <button className="b b-secondary">Open</button>
    </Form>
    {message && <p className={q.message==="check" || q.message==="permission" ? "alert" : "hint"} role="status">{message}</p>}
    {viewOnly && <p className="hint">{viewOnlyWords(membership.viewOnlyUntil)}</p>}
    {changed && <p className="hint" role="alert"><Badge tone="warn">Format changed</Badge> The official Form No. 140 format changed on {day(changed)}. Check before filing.</p>}

    <Card id="tds-deductor" title="Deductor details" Icon={UserRoundCheck} kind={work.deductor ? "done" : "papers"} end={<Link className="b b-ghost" href={`/app/clients/${id}?tab=tds&tan=${tan.id}`}>{work.deductor ? "Change details" : "Fill details"}</Link>}>
      <p className="app-card-none">{work.deductor ? <>{work.deductor.name}, person responsible {work.deductor.person.name || "not given yet"}. Deductor PAN: <span className="num">{work.pan || "not given"}</span></> : "The statement needs the deductor's address, type and the person responsible for deduction. Fill them once for this TAN."}</p>
    </Card>

    <Card id="tds-read" title="Payments and challans from the client's registers" Icon={FileSpreadsheet} kind="docs">
      <div className="itr-body">
      <p className="hint">Choose a register the client sent, then its columns. A payment register has one row a payment; a challan register one row a challan. InboxCA remembers the columns for this client&apos;s next register.</p>
      {work.drafts.filter(draft=>draft.id!==entered?.id).map(draft=><p key={draft.id} className="sub">{sheets.find(file=>file.id===draft.id)?.name ?? "Register"}: {draft.data.lines.length} figures, {draft.data.lines.filter(line=>line.state==="confirmed").length} checked. <Link href={`/app/clients/${id}?tab=extraction&draft=${draft.id}&view=list`}>Look at the figures</Link></p>)}
      {registers.length ? <ul className="app-rows" aria-label="Registers">{registers.slice(0,10).map(file=><li className={`app-row${chosen?.id===file.id ? " is-on" : ""}`} key={file.id}><span className="grow"><strong>{file.name}</strong><span className="sub">Received {day(file.received_at.slice(0,10))}</span></span>
        <Link className="b b-secondary b-small" href={`${base}&source=${file.id}&kind=payments`} aria-label={`Read ${file.name} as payments`}>Read payments</Link><Link className="b b-ghost b-small" href={`${base}&source=${file.id}&kind=challans`} aria-label={`Read ${file.name} as challans`}>Read challans</Link></li>)}</ul>
        : <p className="hint">{sheets.length ? "Every register here is read. To read another," : "No register to read yet. To read one,"} add it under <Link href={`/app/clients/${id}?tab=documents`}>Documents</Link>, or ask the client for it.</p>}
      {problem && <p className="alert" role="alert">{problem}</p>}
      {chosen && rows.length>0 && <>
        <Form action={`/app/clients/${id}/tds`} className="form-row"><input type="hidden" name="tan" value={tan.id}/><input type="hidden" name="period" value={period}/><input type="hidden" name="source" value={chosen.id}/><input type="hidden" name="kind" value={kind}/>
          <div><label htmlFor="header">Column names are on row</label><input id="header" type="number" name="header" min={1} max={40} defaultValue={header}/></div><button className="b b-secondary">Show columns</button></Form>
        {canEdit ? <form action={readTds} className="fields">{hidden}<input type="hidden" name="source" value={chosen.id}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="header" value={header}/>
          {tdsFields[kind].map(([key,name],index)=><div key={key}><label htmlFor={`column${index}`}>{name}{index<(kind==="payments" ? 6 : 4) && " (needed)"}</label><select id={`column${index}`} name={`column${index}`} defaultValue={suggested[index] ?? -1}><option value={-1}>Not in this file</option>{headings.map((heading,n)=><option key={n} value={n}>{String.fromCharCode(65+n)}: {heading.slice(0,200)}</option>)}</select></div>)}
          <Pending className="b b-primary">Confirm columns and read {kind}</Pending></form> : ask}
        {kind==="payments" && <p className="hint">Section codes are the four digit codes of Form No. 140, such as 1024 for contractors and 1027 for professional fees. With no deduction date, InboxCA uses the date of payment or credit; with no tax deposited column, the tax deducted.</p>}
      </>}
      </div>
    </Card>

    <Card id="tds-enter" title="Challans and the statement's answer" Icon={ReceiptIndianRupee} kind="docs">
      <div className="itr-body">
      {entered && <p className="sub">Entered by your team: {entered.data.lines.length} figures, {entered.data.lines.filter(line=>line.state==="confirmed").length} checked. <Link href={`/app/clients/${id}?tab=extraction&draft=${entered.id}&view=list`}>Look at the figures</Link></p>}
      {canEdit ? <>
        {answered ? <p className="hint">Regular Form No. 140 filed for an earlier quarter: {answered==="Y" ? `Yes, token ${work.read.token}` : "No"}. To change it, correct it under Figures.</p>
          : <form action={enterTdsFigures} className="form-row">{hidden}<input type="hidden" name="revision" value={entered?.revision ?? 0}/>
            <div><label htmlFor="previous">Was a regular Form No. 140 filed for an earlier quarter?</label><select id="previous" name="previous" required defaultValue={known ? "Y" : ""}><option value="" disabled>Choose</option><option value="N">No, this is the first</option><option value="Y">Yes</option></select></div>
            <div><label htmlFor="token">If yes, its 15 digit token number</label><input id="token" name="token" inputMode="numeric" maxLength={15} className="num" defaultValue={known ? token : ""}/>{known && <p className="hint">From the last statement marked filed. Check it.</p>}</div>
            <Pending className="b b-secondary">Save answer</Pending></form>}
        <h3>Add a challan by hand</h3>
        <form action={enterTdsFigures} className="fields">{hidden}<input type="hidden" name="revision" value={entered?.revision ?? 0}/>
          <div><label htmlFor="bsr">BSR code</label><input id="bsr" name="bsr" required inputMode="numeric" maxLength={7} className="num"/></div>
          <div><label htmlFor="date">Date of deposit</label><input id="date" name="date" type="date" required/></div>
          <div><label htmlFor="number">Challan serial number</label><input id="number" name="number" required inputMode="numeric" maxLength={5} className="num"/></div>
          <div><label htmlFor="tax">Tax</label><input id="tax" name="tax" required inputMode="decimal" className="num"/></div>
          <div><label htmlFor="interest">Interest</label><input id="interest" name="interest" inputMode="decimal" className="num"/></div>
          <div><label htmlFor="fee">Fee</label><input id="fee" name="fee" inputMode="decimal" className="num"/></div>
          <div><label htmlFor="others">Penalty or others</label><input id="others" name="others" inputMode="decimal" className="num"/></div>
          <div><label htmlFor="minor">Minor head</label><select id="minor" name="minor" defaultValue="200">{Object.entries(minorHeads).map(([code,name])=><option key={code} value={code}>{code}: {name}</option>)}</select></div>
          <Pending className="b b-secondary">Add challan</Pending></form>
        <p className="hint">Copy these from the challan receipt. The amounts are whole rupees.</p>
      </> : ask}
      </div>
    </Card>

    <Card id="tds-check" title="Check the statement" Icon={ListChecks} kind={ready ? "done" : "papers"} count={work.check.errors.length || undefined} countLabel={`${work.check.errors.length} to correct`}>
      <div className="itr-body">
      {!!plain.length && <ul className="alert" role="alert">{plain.map(issue=><li key={issue.text}>{issue.text}</li>)}</ul>}
      {!!rowErrors.length && <><h3>To correct</h3><ul className="app-rows">{rowErrors.slice(0,50).map((issue,n)=><li className="app-row" key={n}><span className="grow">{issue.text}</span>{figureLink(issue.line) && <Link className="b b-secondary b-small" href={figureLink(issue.line)!}>Correct</Link>}</li>)}</ul>{rowErrors.length>50 && <p className="hint">{rowErrors.length-50} more.</p>}<p className="hint">Correct a figure under Figures, or fix the register and add it again.</p></>}
      {!!work.check.warnings.length && <><h3>Look at these one by one</h3><ul className="app-rows">{work.check.warnings.slice(0,50).map((issue,n)=><li className="app-row" key={n}><span className="grow"><Badge tone="warn">Look</Badge> {issue.text}</span>{figureLink(issue.line) && <Link className="b b-ghost b-small" href={figureLink(issue.line)!}>Check</Link>}</li>)}</ul></>}
      {!!work.check.challans.length && <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Challan</th><th scope="col">Deposited on</th><th scope="col" className="is-num">Tax</th><th scope="col" className="is-num">Payments</th><th scope="col" className="is-num">Tax deducted</th></tr></thead>
        <tbody>{work.check.challans.map((challan,n)=><tr key={n}><td>{challan.nil ? "Nil challan, no tax" : <><span className="num">{challan.number}</span><span className="sub">BSR {challan.bsr}</span></>}</td><td>{challan.nil ? "" : day(challan.date)}</td><td className="num is-num">{rupees(challan.tax)}</td><td className="num is-num">{challan.payments.length}</td><td className="num is-num">{rupees(challan.payments.reduce((sum,pay)=>sum+pay.tds,BigInt(0)))}</td></tr>)}</tbody></table></div>}
      <p className="hint">{lines.length} figures, {lines.length-open} checked{wrong ? `, ${wrong} marked wrong` : ""}. {work.read.payments.length} payments, {work.read.challans.length} challans.</p>
      {canCheck && open>0 && <form action={checkTds} className="form-row">{hidden}{work.drafts.map(draft=><input key={draft.id} type="hidden" name="draft" value={`${draft.id}:${draft.revision}`}/>)}
        <Pending className="b b-primary" disabled={!!work.check.errors.length}>Yes, these figures are right</Pending>
        <span className="hint">{work.check.errors.length ? "Correct the figures listed first." : `Checks every row against the registers at once${work.check.warnings.length ? ", except those to look at one by one" : ""}.`}</span></form>}
      {!canCheck && !viewOnly && open>0 && <p className="hint">Ask your firm&apos;s owner to let you check figures for this client.</p>}
      </div>
    </Card>

    <Card id="tds-prepare" title="Prepare the statement file" Icon={latest ? FileCheck2 : FilePlus2} kind={latest?.meta.status==="filed" ? "done" : "docs"}>
      <div className="itr-body">
      {latest && <p className="sub">Version {latest.meta.version}: {latest.meta.status==="draft" ? "waiting for approval" : latest.meta.status}. <Link href={`/app/clients/${id}?tab=outputs`}>Open it under Return files</Link> to approve, download and mark it filed.</p>}
      {canEdit ? <form action={prepareForm} className="form-row">{hidden}<input type="hidden" name="registration" value={tan.id}/><input type="hidden" name="form" value="TDS140"/>{work.drafts.map(draft=><input key={draft.id} type="hidden" name="draft" value={draft.id}/>)}
        <Pending className="b b-primary" disabled={!ready}>Prepare Form No. 140</Pending>
        <span className="hint">{ready ? "Makes the statement file from the checked figures." : "Every check must pass and every figure be checked first."}</span></form> : ask}
      <p className="hint">Before filing, validate the file with Protean&apos;s free File Validation Utility (FVU) and the challan file (.csi) from the TIN website. InboxCA does not file statements, and the deductees’ certificates come from TRACES.</p>
      </div>
    </Card>
    </div>
  </>;
}
