import Link from "next/link";
import {z} from "zod";
import {serverCrypto} from "@/src/lib/crypto";
import {FigureEdit} from "./figure-edit";
import { grantFor } from "@/src/lib/permission-grants";
import { currentMember } from "@/src/lib/member";
import { checkFigures, draftSchema, openFigures, verifySources, place } from "@/src/lib/datasets";
import { periodName } from "@/src/lib/documents";
import { askPermission } from "@/app/(app)/actions";
import { FileViewer } from "../../files/[id]/view/file-viewer";
import { reviewFigure } from "./dataset-actions";
const messages:Record<string,string>={stale:"Someone changed these figures. Read the latest values and try again.",source:"The source file is not available. Ask your team to restore it.",permission:"Ask for permission before changing a figure.",value:"Check the value. Figures need no more than two decimal places; dates need a valid day.",reason:"Say why the figure needs to change.",totals:"The totals must agree before a figure can be confirmed.",saved:"Your check was saved."};

export async function DatasetReview({clientId,draftId,lineId,check}:{clientId:string;draftId?:string;lineId?:string;check?:string}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) return null;
  const {data:rows}=await supabase.from("datasets").select("id,form_code,period_key").eq("firm_id",membership.firmId).eq("client_id",clientId).order("period_key",{ascending:false}).limit(100);
  const selected=rows?.find((row)=>row.id===draftId) ?? rows?.[0];
  if(!selected) return <p className="hint">No figures to check yet.</p>;
  const {data:row,error}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("id",selected.id).single();
  if(error || !row) throw new Error("The figures could not be read.");
  const draft=draftSchema.parse(row.data),figures=await openFigures(membership.firmId,row.id,draft);
  let sourceReady=true;
  try {await verifySources(membership.firmId,clientId,draft);} catch {sourceReady=false;}
  const issues=checkFigures(draft,figures),active=draft.lines.find((line)=>line.id===lineId) ?? draft.lines.find((line)=>line.state==="pending") ?? draft.lines[0];
  const {data:source}=await supabase.from("documents").select("id,name").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("id",active.source.document).neq("status","deleted").maybeSingle();
  const {data:people}=await supabase.rpc("firm_people",{target_firm:membership.firmId});
  const href=(line:string)=>`?tab=extraction&draft=${row.id}&line=${line}`;
  const at=draft.lines.indexOf(active),shown=draft.lines.slice(Math.floor(at/50)*50,Math.floor(at/50)*50+50);
  const canEdit=membership.may("edit_figures", clientId) || !!await grantFor(membership.firmId,userId,"edit_figures",clientId),viewOnly=!!membership.viewOnlyUntil;
  const kept=draft.edits?.[userId]?.[active.id];
  const candidate=canEdit && kept?.base===active.value_enc ? z.object({value:z.string().max(2000),reason:z.string().max(300)}).parse(JSON.parse(await serverCrypto().decrypt(membership.firmId,`${place(row.id,active.id)}/edit/${userId}`,kept.value_enc))) : null;
  return <section aria-labelledby="figures">
    <h2 id="figures">Check the figures</h2>
    <p className="hint">Check each figure against its source. Nothing is used in a form until every figure is confirmed.</p>
    <nav className="pills" aria-label="Drafts">{rows?.map((item)=><Link key={item.id} href={`?tab=extraction&draft=${item.id}`} aria-current={row.id===item.id ? "page" : undefined}>{item.form_code} {periodName(item.period_key)}</Link>)}</nav>
    {check && messages[check] && <p className="alert" role="status">{messages[check]}</p>}
    {!sourceReady && <p className="alert" role="alert">A source changed or is not available. Ask your team to restore or read it again before checking these figures.</p>}
    {!!issues.length && <p className="alert" role="alert">{issues.join(" ")} Correct the figures before confirming them.</p>}
    <div className="figure-review">
      <div className="panel">
        <p className="hint">{draft.lines.filter((line)=>line.state==="confirmed").length} of {draft.lines.length} confirmed</p>
        <ul className="rows">{shown.map((line)=><li key={line.id}><Link href={href(line.id)} aria-current={active.id===line.id ? "true" : undefined}>{figures.get(line.id)!.label}: <span className="num">{figures.get(line.id)!.value}</span></Link><span className="hint">{line.state}</span></li>)}</ul>
        <nav className="pager" aria-label="Figure pages"><span>{at>=50 && <Link href={href(draft.lines[Math.floor(at/50)*50-50].id)}>Previous</Link>}{Math.floor(at/50)*50+50<draft.lines.length && <Link href={href(draft.lines[Math.floor(at/50)*50+50].id)}>Next</Link>}</span></nav>
        <h3>{figures.get(active.id)!.label}</h3>
        <p className="num">{figures.get(active.id)!.value}</p>
        {active.by && <p className="hint">Checked by {people?.find((person)=>person.user_id===active.by)?.email ?? "your team"}, {new Date(active.at!).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</p>}
        <form action={reviewFigure} className="fields">
          <input type="hidden" name="client" value={clientId}/><input type="hidden" name="draft" value={row.id}/><input type="hidden" name="line" value={active.id}/><input type="hidden" name="revision" value={row.revision}/>
          <div className="form-row"><button className="b b-primary" name="intent" value="confirmed" disabled={viewOnly || !membership.may("check_figures",clientId) || !sourceReady || !source || !!issues.length || active.state==="confirmed"}>Yes, this is right</button><button className="b b-secondary" name="intent" value="rejected" disabled={viewOnly || !membership.may("check_figures",clientId) || active.state==="rejected"}>No, this is wrong</button></div>

        </form>
        {!viewOnly && sourceReady && canEdit && <FigureEdit key={`${row.id}-${active.id}-${row.revision}`} client={clientId} draft={row.id} line={active.id} revision={row.revision} value={candidate?.value ?? figures.get(active.id)!.value} reason={candidate?.reason} kind={figures.get(active.id)!.kind} kept={!!candidate}/>}
        {!viewOnly && !canEdit && <form action={askPermission}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="right" value="edit_figures"/><button className="b b-ghost">Ask to edit figures</button></form>}
      </div>
      <div className="panel"><h3>Source</h3><p>{source?.name ?? "Source unavailable"}. {active.source.cell ? `Sheet ${active.source.sheet}, cell ${active.source.cell}` : `Page ${active.source.page}`}</p>{source && process.env.FILE_WORKER_URL && process.env.FILE_WORKER_SECRET ? <FileViewer key={`${source.id}-${active.source.sheet ?? 1}`} sheet={active.source.sheet ?? 1} id={source.id} page={active.source.page} hideInactive={membership.settings.viewer_hide_inactive===true}/> : <p className="hint">The source cannot be shown here yet.</p>}</div>
    </div>
  </section>;
}
