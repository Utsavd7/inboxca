import "../../returns.css";
import Link from "next/link";
import {z} from "zod";
import {Check,FileText,ListChecks} from "lucide-react";
import {serverCrypto} from "@/src/lib/crypto";
import {FigureEdit,FigureNo} from "./figure-edit";
import { grantFor } from "@/src/lib/permission-grants";
import { currentMember, viewOnlyWords } from "@/src/lib/member";
import { checkFigures, draftSchema, openFigures, verifySources, place, type Draft } from "@/src/lib/datasets";
import { periodName } from "@/src/lib/documents";
import { when } from "@/src/lib/paper-origin";
import { personName } from "@/src/lib/roles";
import { askPermission } from "@/app/(app)/actions";
import { FileViewer } from "../../files/[id]/view/file-viewer";
import { Pending } from "../../pending";
import { Badge, Empty, IconTile, Toast } from "../../ui";
import { SourcePane } from "../../returns-client";
import { reviewFigure } from "./dataset-actions";
import {itrYear} from "@/src/lib/itr-fields";
import {formName} from "@/src/lib/prepared";
import {checkItr} from "@/src/lib/itr";
import {formLayout,grouped} from "@/src/lib/form-layout";
import {FormCheck} from "./form-check";
import {formCheckData} from "./form-check-data";
const messages:Record<string,string>={stale:"Someone changed these figures. Read the latest values and try again.",source:"The paper these figures came from is not available. Ask the owner to restore it.",permission:"Ask for permission before changing a figure.",value:"Check the value. Figures need no more than two decimal places; dates need a valid day.",reason:"Say why the figure needs to change.",totals:"The totals do not add up. Correct the figures before you mark any as right.",itr:"Fix the problems listed for this return before you mark a figure as right.",saved:"Your check was saved."};
type Line=Draft["lines"][number];

export async function DatasetReview({clientId,draftId,lineId,check,view}:{clientId:string;draftId?:string;lineId?:string;check?:string;view?:string}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) return null;
  const {data:rows}=await supabase.from("datasets").select("id,form_code,period_key,target:data->target->>form").eq("firm_id",membership.firmId).eq("client_id",clientId).order("period_key",{ascending:false}).limit(100);
  const selected=rows?.find((row)=>row.id===draftId) ?? rows?.[0];
  if(!selected) return <section className="app-card fig" aria-labelledby="figures"><header className="app-card-head"><IconTile Icon={ListChecks} kind="docs"/><h2 id="figures">Check the figures</h2></header><Empty Icon={ListChecks} kind="docs" title="No figures to check yet"><p className="hint">Read a statement or a register below. Its figures show here to check against the paper.</p></Empty></section>;
  const {data:row,error}=await supabase.from("datasets").select("*").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("id",selected.id).single();
  if(error || !row) throw new Error("The figures could not be read.");
  const draft=draftSchema.parse(row.data),figures=await openFigures(membership.firmId,row.id,draft);
  let sourceReady=true;
  try {await verifySources(membership.firmId,clientId,draft);} catch {sourceReady=false;}
  // An income tax draft is also checked against its official schema and rules.
  const issues=[...checkFigures(draft,figures),...(draft.target ? await checkItr(clientId,row.period_key,row.id,row.revision,draft,figures).catch(()=>["These figures could not be checked against the official return yet."]) : [])],active=draft.lines.find((line)=>line.id===lineId) ?? draft.lines.find((line)=>line.state==="pending") ?? draft.lines[0];
  const at=draft.lines.indexOf(active),shown=draft.lines.slice(Math.floor(at/50)*50,Math.floor(at/50)*50+50);
  // Figures that feed a return InboxCA knows open on its form (Check on the form); the list stays a click away.
  const onForm=view==="form" || view!=="list" && formLayout(row.form_code,draft.lines.map((line)=>({id:line.id,field:line.field,label:figures.get(line.id)!.label})),{target:draft.target?.form}).placed>0;
  // The papers the shown figures came from, for their From chips and the open one's preview.
  const ids=[...new Set((onForm ? draft.lines : shown).flatMap((line)=>line.source.document ? [line.source.document] : []))];
  const {data:papers}=ids.length ? await supabase.from("documents").select("id,name,document_type,period_key").eq("firm_id",membership.firmId).eq("client_id",clientId).in("id",ids).neq("status","deleted") : {data:[]};
  const source=papers?.find((paper)=>paper.id===active.source.document) ?? null;
  const {data:people}=await supabase.rpc("firm_people",{target_firm:membership.firmId});
  const who=(id?:string)=>{const email=people?.find((person)=>person.user_id===id)?.email;return email ? personName(email) : "your team";};
  const href=(line:string)=>`?tab=extraction&draft=${row.id}&line=${line}${onForm ? "" : "&view=list"}`;
  const canEdit=membership.may("edit_figures", clientId) || !!await grantFor(membership.firmId,userId,"edit_figures",clientId),viewOnly=!!membership.viewOnlyUntil;
  const kept=draft.edits?.[userId]?.[active.id];
  const candidate=canEdit && kept?.base===active.value_enc ? z.object({value:z.string().max(2000),reason:z.string().max(300)}).parse(JSON.parse(await serverCrypto().decrypt(membership.firmId,`${place(row.id,active.id)}/edit/${userId}`,kept.value_enc))) : null;
  const name=(item:{form_code:string;period_key:string;target:unknown})=>item.form_code==="ITR" ? `${item.target ? formName(String(item.target)) : "Income tax"} ${itrYear(item.period_key)}` : `${item.form_code.replace(/^GSTR(\d)/,"GSTR-$1")} ${periodName(item.period_key)}`;
  const checked=draft.lines.filter((line)=>line.state==="confirmed").length;
  // One rule for the Amount column: paise as two decimals when any amount has them, else none.
  const decimals=shown.some((line)=>{const figure=figures.get(line.id)!;return (!figure.kind || figure.kind==="number") && /\.\d*[1-9]/.test(figure.value);}) ? 2 : 0;
  // Why "Yes, this is right" cannot be pressed, when the alerts above do not say.
  const why=viewOnly ? viewOnlyWords(membership.viewOnlyUntil) : !membership.may("check_figures",clientId) ? "Ask your firm's owner to let you check figures for this client." : !source && !active.source.entered_by ? messages.source : "";
  const where=(line:Line,short=false)=>line.source.cell ? `Sheet ${line.source.sheet}, ${short ? "" : "cell "}${line.source.cell}` : `Page ${line.source.page}`;
  const from=(line:Line)=>{
    if(line.source.entered_by) return <span className="fig-from" title={`Entered by ${who(line.source.entered_by)}, ${when(line.source.entered_at!)}`}>Your team</span>;
    const paper=papers?.find((item)=>item.id===line.source.document);
    return paper ? <Link className="fig-from" href={`/app/files/${paper.id}/view`} title={paper.name} aria-label={`Open ${paper.name}, ${where(line)}`}><FileText size={13} aria-hidden/>{paper.document_type ?? "Paper"}, {where(line,true)}</Link> : <span className="fig-from">Not available</span>;
  };
  const state=(line:Line)=>line.state==="confirmed" ? <span title={line.by ? `Checked by ${who(line.by)}, ${when(line.at!)}` : undefined}><Badge key="done" tone="done">Checked</Badge></span> : line.state==="rejected" ? <Badge key="wrong">Wrong</Badge> : <Badge key="open" tone="warn">To check</Badge>;
  const onPaper=onForm ? await formCheckData({supabase,firm:membership.firmId,userId,row,draft,figures,papers:papers ?? [],who,issues,sourceReady,lineId}) : null;
  const switchTo=(to:"form"|"list")=>`?tab=extraction&draft=${row.id}&view=${to}${onPaper?.active ?? lineId ? `&line=${onPaper?.active ?? lineId}` : ""}`;
  return <section className="app-card fig" aria-labelledby="figures">
    <header className="app-card-head"><IconTile Icon={ListChecks} kind="docs"/><h2 id="figures">Check the figures</h2>
      {(rows?.length ?? 0)>1 && <nav className="pills head-end" aria-label="Sets of figures">{rows?.map((item)=><Link key={item.id} href={`?tab=extraction&draft=${item.id}`} aria-current={row.id===item.id ? "page" : undefined}>{name(item)}</Link>)}</nav>}
    </header>
    <div className="fig-progress"><span className="fig-for">{name(selected)}</span><strong>{checked} of {draft.lines.length} checked</strong><span className={`fig-bar${checked===draft.lines.length ? " is-done" : ""}`} role="progressbar" aria-label="Figures checked" aria-valuemin={0} aria-valuemax={draft.lines.length} aria-valuenow={checked}><i style={{transform:`scaleX(${checked/draft.lines.length})`}}/></span><nav className="pills fc-views" aria-label="Show the figures"><Link href={switchTo("form")} aria-current={onForm ? "page" : undefined} scroll={false}>On the form</Link><Link href={switchTo("list")} aria-current={onForm ? undefined : "page"} scroll={false}>List</Link></nav>{checked===draft.lines.length && ["GSTR1","GSTR3B","ITR"].includes(selected.form_code) && <Link className="b b-primary fig-next" href="?tab=outputs">Prepare the return</Link>}</div>
    <p className="hint fig-hint">Check each figure against the paper it came from. InboxCA uses none of these figures in a return until every one is checked.</p>
    {check==="saved" ? <Toast>{messages.saved}</Toast> : check && messages[check] && <p className="alert" role="status">{messages[check]}</p>}
    {!sourceReady && <p className="alert" role="alert">A paper these figures came from was changed or removed. Ask the owner to restore it, or read the paper again, before you check these figures.</p>}
    {!!issues.length && <p className="alert" role="alert">{issues.join(" ")} Correct the figures before you mark them as right.</p>}
    {onPaper ? <>
      <FormCheck key={row.id} layout={onPaper.layout} items={onPaper.items} papers={onPaper.papers} active={onPaper.active} client={clientId} draft={row.id} revision={row.revision} kept={onPaper.kept} focus={check==="saved"}
        canCheck={!viewOnly && membership.may("check_figures",clientId)} canEdit={!viewOnly && sourceReady && canEdit} ask={!viewOnly && !canEdit} why={viewOnly ? viewOnlyWords(membership.viewOnlyUntil) : !membership.may("check_figures",clientId) ? "Ask your firm's owner to let you check figures for this client." : ""}
        shown={!!process.env.FILE_WORKER_URL && !!process.env.FILE_WORKER_SECRET} hideInactive={membership.settings.viewer_hide_inactive===true}/>
      {(onPaper.pager.previous || onPaper.pager.next) && <nav className="pager" aria-label="Figure pages"><span>{onPaper.pager.previous && <Link href={href(onPaper.pager.previous)}>Previous</Link>}{onPaper.pager.next && <Link href={href(onPaper.pager.next)}>Next</Link>}</span></nav>}
    </> : <><div className="fig-layout">
      <div className="table-wrap fig-table"><table className="t">
        <thead><tr><th scope="col">Figure</th><th scope="col" className="is-num">Amount</th><th scope="col">From</th><th scope="col">Status</th></tr></thead>
        <tbody>{shown.map((line)=>{
          const figure=figures.get(line.id)!,open=line.id===active.id;
          const fields=<><input type="hidden" name="client" value={clientId}/><input type="hidden" name="draft" value={row.id}/><input type="hidden" name="line" value={active.id}/><input type="hidden" name="revision" value={row.revision}/><input type="hidden" name="view" value="list"/></>;
          return [<tr key={line.id} className={open ? "is-open" : undefined}>
            <td><Link className="fig-name" href={href(line.id)} scroll={false} aria-current={open ? "true" : undefined}>{figure.label}</Link></td>
            <td className={`num${!figure.kind || figure.kind==="number" ? " is-num" : ""}`}>{grouped(figure.value,figure.kind,decimals)}</td>
            <td>{from(line)}</td>
            <td>{state(line)}</td>
          </tr>,open && <tr key={`${line.id}-open`} className="fig-open"><td colSpan={4}><div className="fig-act">
            <div className="fig-decide">
              {/* A checked figure says who checked it (no undo: a check is changed only by No or a correction). */}
              <div className="fig-choice">
                {active.state==="confirmed" ? <p className="fig-done"><Check size={15} strokeWidth={2.6} aria-hidden/>Checked by {who(active.by)}, {when(active.at!)}</p> : <form action={reviewFigure}>{fields}<Pending className="b b-primary" name="intent" value="confirmed" disabled={viewOnly || !membership.may("check_figures",clientId) || !sourceReady || !source && !active.source.entered_by || !!issues.length}>Yes, this is right</Pending></form>}
                {/* No opens the correction for someone who may correct figures; for anyone else it marks the figure wrong. */}
                {!viewOnly && sourceReady && canEdit ? <FigureNo open={!!candidate}><FigureEdit key={`${row.id}-${active.id}-${row.revision}`} client={clientId} draft={row.id} line={active.id} revision={row.revision} value={candidate?.value ?? figure.value} reason={candidate?.reason} kind={figure.kind} kept={!!candidate} extra={{view:"list"}}/></FigureNo>
                  : <form action={reviewFigure}>{fields}<input type="hidden" name="next" value={active.id}/><Pending className="b b-secondary" name="intent" value="rejected" disabled={viewOnly || !membership.may("check_figures",clientId) || active.state==="rejected"}>No, this is wrong</Pending></form>}
              </div>
              {why && active.state!=="confirmed" ? <p className="fig-why">{why}</p> : active.source.entered_by && <p className="hint">Entered by {who(active.source.entered_by)}, {when(active.source.entered_at!)}. Check it against your records.</p>}
            </div>
            {!viewOnly && !canEdit && <form action={askPermission}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-ghost">Ask to edit figures</Pending></form>}
          </div></td></tr>];
        })}</tbody>
      </table></div>
      {active.source.entered_by ? null : <SourcePane title={<p className="fig-pane-title"><strong>{source?.name ?? "Source unavailable"}</strong><span className="sr-only">. </span><span className="sub">{active.source.cell ? `Sheet ${active.source.sheet}, cell ${active.source.cell}` : `Page ${active.source.page}`}</span></p>}>
        {source && process.env.FILE_WORKER_URL && process.env.FILE_WORKER_SECRET ? <FileViewer key={`${source.id}-${active.source.sheet ?? 1}`} sheet={active.source.sheet ?? 1} id={source.id} page={active.source.page} hideInactive={membership.settings.viewer_hide_inactive===true}/> : <p className="hint">The source cannot be shown here yet.</p>}
      </SourcePane>}
    </div>
    {draft.lines.length>50 && <nav className="pager" aria-label="Figure pages"><span>{at>=50 && <Link href={href(draft.lines[Math.floor(at/50)*50-50].id)}>Previous</Link>}{Math.floor(at/50)*50+50<draft.lines.length && <Link href={href(draft.lines[Math.floor(at/50)*50+50].id)}>Next</Link>}</span></nav>}
    </>}
  </section>;
}
