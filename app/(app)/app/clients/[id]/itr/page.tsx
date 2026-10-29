import Form from "next/form";
import Link from "next/link";
import {ChevronLeft,FileCheck2,ListTodo,PencilLine} from "lucide-react";
import {redirect,unstable_rethrow} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {enterItr,itrField,itrWork} from "@/src/lib/itr";
import {itrChecks} from "@/src/lib/itr-check";
import {itrReady,itrReturns,itrYear} from "@/src/lib/itr-fields";
import {formName} from "@/src/lib/prepared";
import {serverCrypto} from "@/src/lib/crypto";
import {askPermission} from "@/app/(app)/actions";
import {grantFor} from "@/src/lib/permission-grants";
import {Badge,Card,PageHead} from "../../../ui";
import {Pending} from "../../../pending";
import {ItrDifferences} from "../../../itr-check";
import {keepReason,keptReason} from "@/src/lib/reason";
import "../../clients.css";

// One income tax return for one assessment year: what InboxCA already holds, what is still
// to fill (read from the official schema, never guessed), and the details to enter.
export default async function ItrPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {id}=await params,q=await searchParams,form=z.enum(itrReturns).catch("ITR1").parse(q.form),period=/^20\d{2}$/.test(q.year ?? "") ? q.year! : "2026";
  let work:Awaited<ReturnType<typeof itrWork>>;
  try {work=await itrWork(id,form,period);} catch(error) {
    unstable_rethrow(error);
    return <><PageHead crumbs={[[`/app/clients/${id}?tab=extraction`,"Client"]]} title="Income tax return"/><p className="hint">InboxCA cannot open this return yet. Check that the client has a PAN. If it has one, InboxCA does not yet have the official form for {itrYear(period)}. Try again later.</p></>;
  }
  const {context,entries,drafts,review}=work,{membership,supabase,client}=context;
  const canEdit=!membership.viewOnlyUntil && (membership.may("edit_figures",id) || !!await grantFor(membership.firmId,context.userId,"edit_figures",id));
  // The return's own entered figures, and figures read from the client's papers for the year.
  const own=drafts.find(row=>row.data.target && row.data.lines.some(line=>line.source.entered_by)),papers=drafts.filter(row=>!row.data.target);
  const held=new Map<string,{value:string;from:string}>(),sourceIds=[...new Set(papers.flatMap(row=>row.data.lines.flatMap(line=>line.source.document ? [line.source.document] : [])))];
  const [{data:names},{data:details}]=await Promise.all([
    sourceIds.length ? supabase.from("documents").select("id,name").eq("firm_id",membership.firmId).eq("client_id",id).in("id",sourceIds) : Promise.resolve({data:[] as {id:string;name:string}[]}),
    supabase.from("clients").select("email_enc").eq("firm_id",membership.firmId).eq("id",id).single(),
  ]);
  const paperName=(row:typeof papers[number])=>names?.find(file=>file.id===row.data.lines[0].source.document)?.name ?? "Figures from a paper";
  for(const row of papers) for(const line of row.data.lines) if(line.state!=="rejected") held.set(line.field,{value:row.figures.get(line.id)!.value,from:paperName(row)});
  // The return against the client's Form 26AS and Form 16 for the year, before anyone approves it.
  const check=await itrChecks(supabase,membership.firmId,[{client:id,period,form}]).then(([one])=>one,()=>null);
  const email=details?.email_enc ? await serverCrypto().decrypt(membership.firmId,`clients/${id}/email`,details.email_enc) : "";
  const saved=new Set(own?.data.lines.map(line=>line.field)),missing=new Set(review.missing.flatMap(item=>item.field ? [item.field] : []));
  const groups=[...new Set(entries.map(entry=>entry.group))],group=groups.includes(q.group ?? "") ? q.group! : review.missing[0]?.group ?? groups[0];
  const counts=new Map<string,number>();for(const item of review.missing) counts.set(item.group,(counts.get(item.group) ?? 0)+1);
  const shown=entries.filter(entry=>entry.group===group),depth=Math.max(0,...shown.map(entry=>entry.rows));
  const rows=[q.row,q.row2].map(value=>z.coerce.number().int().min(1).max(1000).catch(1).parse(value ?? 1)-1);
  const base=`/app/clients/${id}/itr?form=${form}&year=${period}`;
  async function save(input:FormData) {
    "use server";
    // Only the amounts listed as still to fill on this page get a 0, and only when asked.
    let zeroed=0;
    if(input.get("zero")==="1") for(const field of String(input.get("empty") ?? "").split(",")) if(/^itr\.[a-z0-9_.]{1,95}$/.test(field) && !String(input.get(field) ?? "").trim()) {input.set(field,"0");zeroed++;}
    let draft:string;
    try {draft=await enterItr(id,form,period,input,zeroed);} catch(error) {unstable_rethrow(error);await keepReason(error);redirect(`${base}&group=${encodeURIComponent(String(input.get("group") ?? ""))}&message=check`);}
    revalidatePath("/app","layout");redirect(`${base}&group=${encodeURIComponent(String(input.get("group") ?? ""))}&saved=${draft}`);
  }
  const empty=shown.filter(entry=>entry.kind==="number" && !entry.choices && missing.has(itrField(entry,rows))).map(entry=>itrField(entry,rows));
  return <>
    <PageHead crumb={<Link className="crumb" href={`/app/clients/${id}?tab=extraction`}><ChevronLeft size={14} aria-hidden/>{client.name}</Link>} title={`${formName(form)} ${itrYear(period)}`}
      sub={<span className="head-meta"><span>InboxCA fills what it already holds and lists the rest for you. Nothing is guessed.</span></span>}/>
    <div className="pane client-pane">
    <Form action={`/app/clients/${id}/itr`} className="form-row">
      <div><label htmlFor="return">Return</label><select id="return" name="form" defaultValue={form}>{itrReturns.map(code=><option key={code} value={code}>{formName(code)}</option>)}</select></div>
      <div><label htmlFor="year">Year (type 2026 for AY 2026-27, 2027 for tax year 2026-27)</label><input id="year" name="year" defaultValue={period} inputMode="numeric" pattern="20[0-9]{2}" required/></div>
      <button className="b b-secondary">Open</button>
    </Form>
    {q.message && <p className="alert" role="status">{(await keptReason()) ?? "InboxCA could not save these entries. Amounts need digits only, and dates must be real days. To change a figure already saved, use Check the figures."}</p>}
    {q.saved && <p className="alert" role="status">Saved for checking. <Link href={`/app/clients/${id}?tab=extraction&draft=${q.saved}`}>Check the figures</Link></p>}
    {!itrReady() && <p className="hint">InboxCA cannot make the return file for the income tax portal yet. It is waiting for its software ID from the Income Tax Department. You can fill in and check everything now.</p>}
    {form==="ITR3" && <p className="hint">The balance sheet, profit and loss account and business schedules come from the client&apos;s accounts, which InboxCA does not read yet. Fill them here, or prepare the return in the official utility and add it under Return files.</p>}
    {check ? <><ItrDifferences differences={check.differences}/>{!check.statement ? <p className="hint">Add the client&apos;s Form 26AS for {itrYear(period)} to check the TDS in this return against it.</p> : !check.differences.length && <p className="hint">The TDS in this return matches Form 26AS.</p>}</> : <p className="hint">This return could not be checked against Form 26AS yet.</p>}
    <Card id="itr-held" title="Already filled" Icon={FileCheck2} kind="done">
      <ul className="app-rows">
        <li className="app-row"><span className="grow"><strong>PAN {context.number}</strong><span className="sub">From the client&apos;s details. Used in every return.</span></span></li>
        {papers.map(row=><li className="app-row" key={row.id}><span className="grow"><strong>{paperName(row)}</strong><span className="sub">{row.data.lines.length} figures, {row.data.lines.filter(line=>line.state==="confirmed").length} checked</span></span><Link className="b b-secondary b-small" href={`/app/clients/${id}?tab=extraction&draft=${row.id}`}>Check</Link></li>)}
        {own && <li className="app-row"><span className="grow"><strong>Entered by your team</strong><span className="sub">{own.data.lines.length} figures, {own.data.lines.filter(line=>line.state==="confirmed").length} checked</span></span><Link className="b b-secondary b-small" href={`/app/clients/${id}?tab=extraction&draft=${own.id}`}>Check</Link></li>}
      </ul>
    </Card>
    <Card id="itr-missing" title="Still to fill" Icon={ListTodo} kind={review.missing.length ? "papers" : "done"} count={review.missing.length || undefined} countLabel={`${review.missing.length} details still to fill`}>
      <div className="itr-body">
      {!!review.issues.length && <ul className="alert" role="alert">{review.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
      {review.missing.length ? <nav className="pills" aria-label="Parts still to fill">{groups.filter(name=>counts.has(name)).map(name=><Link key={name} href={`${base}&group=${encodeURIComponent(name)}`} aria-current={name===group ? "page" : undefined}>{name}: {counts.get(name)}</Link>)}</nav>
        : <p className="hint">Nothing left to fill. Check every figure, then prepare the return under <Link href={`/app/clients/${id}?tab=outputs`}>Return files</Link>.</p>}
      </div>
    </Card>
    <Card id="itr-enter" title={group} Icon={PencilLine}>
      <div className="itr-body">
      <Form action={`/app/clients/${id}/itr`} className="form-row"><input type="hidden" name="form" value={form}/><input type="hidden" name="year" value={period}/>
        <div><label htmlFor="group">Part of the return</label><select id="group" name="group" defaultValue={group}>{groups.map(name=><option key={name}>{name}</option>)}</select></div>
        {Array.from({length:depth},(_,index)=><div key={index}><label htmlFor={`row-${index}`}>{index ? "Row number inside it" : "Row number, for details that repeat"}</label><input id={`row-${index}`} name={index ? "row2" : "row"} type="number" min={1} max={1000} defaultValue={rows[index]+1}/></div>)}
        <button className="b b-secondary">Open</button>
      </Form>
      <p className="hint">Leave anything that does not apply empty. Details marked To fill are needed by the official form.</p>
      {!canEdit ? <form action={askPermission}><input type="hidden" name="client" value={id}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-secondary" disabled={!!membership.viewOnlyUntil}>Ask to enter figures</Pending></form> : <form action={save} className="fields">
        <input type="hidden" name="draft" value={own?.id ?? ""}/><input type="hidden" name="revision" value={own?.revision ?? 0}/><input type="hidden" name="group" value={group}/><input type="hidden" name="empty" value={empty.join(",")}/>
        {shown.map(entry=>{
          const field=itrField(entry,rows),from=held.get(field),label=<>{entry.label}{entry.rows>0 && `, row ${rows[0]+1}`} {missing.has(field) && <Badge tone="warn">To fill</Badge>}</>;
          if(field==="itr.personal.pan") return <div key={field}><span className="sub">{label}</span><p><span className="num">{context.number}</span>, from the client&apos;s details</p></div>;
          if(saved.has(field) || from) return <div key={field}><span className="sub">{label}</span><p className="hint">{from ? `${from.value}, from ${from.from}.` : "Already saved."} To change it, use Check the figures.</p></div>;
          const suggested=field==="itr.personal.email" ? email : "";
          return <div key={field}><label htmlFor={field}>{label}</label>
            {entry.choices || entry.primitive==="boolean" ? <select id={field} name={field} defaultValue=""><option value="">Leave empty</option>{(entry.choices ?? ["true","false"]).map(choice=><option key={choice} value={choice}>{entry.choices ? choice : choice==="true" ? "Yes" : "No"}</option>)}</select>
              : <input id={field} name={field} maxLength={2000} type={entry.kind==="date" ? "date" : "text"} inputMode={entry.kind==="number" ? "decimal" : undefined} defaultValue={suggested}/>}
            {suggested && <p className="hint">From the client&apos;s details in InboxCA. Check it before saving.</p>}
            {entry.defaultValue!==undefined && entry.defaultValue!=="0" && <p className="hint">The official form&apos;s usual value is {entry.defaultValue}.</p>}
          </div>;
        })}
        <div className="form-row"><Pending className="b b-primary">Save for checking</Pending>{!!empty.length && <Pending className="b b-secondary" name="zero" value="1">Save, putting 0 in the {empty.length} empty amounts</Pending>}</div>
        {!!empty.length && <p className="hint">Amounts you type are kept. Only the amounts marked To fill that you leave empty get 0.</p>}
      </form>}
      </div>
    </Card>
    </div>
  </>;
}
