import "./return-work.css";
import Link from "next/link";
import {currentMember} from "@/src/lib/member";
import {checkFigures,draftSchema,openFigures,verifySources,type Draft} from "@/src/lib/datasets";
import {dueLabel} from "@/src/lib/calendar";
import {grouped} from "@/src/lib/form-layout";
import {salesSections} from "@/src/lib/gstr1-fields";
import {checkItr} from "@/src/lib/itr";
import {registerLine} from "@/src/lib/section-check";
import {viewOnlyWords} from "@/src/lib/member";
import type {Work} from "@/src/lib/return-work";
import {messages} from "./clients/[id]/dataset-review";
import {CheckGroups,type CheckGroup} from "./check-groups";

type Db=Awaited<ReturnType<typeof currentMember>>["supabase"];

// Where each return on a page stands, read as the signed in person.
export const returnStages=(supabase:Db,firm:string,tasks:string[])=>
  tasks.length ? Promise.resolve(supabase.rpc("return_stages",{target_firm:firm,task_ids:tasks})).then(({data})=>new Map((data ?? []).map(row=>[row.task,row as Work]))) : Promise.resolve(new Map<string,Work>());

// A filled draft's figures still to check, each highlighted with a link to check it. Approving
// and downloading wait until none is left. at: the page the figures open on, the client's or a
// return's own.
export async function FillChecks({client,sources,at=`/app/clients/${client}`}:{client:string;sources:{id:string}[];at?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const {data:rows}=await supabase.from("datasets").select("id,data").eq("firm_id",membership.firmId).eq("client_id",client).in("id",sources.map(source=>source.id));
  const left=[];
  for(const row of rows ?? []) {
    const data=draftSchema.parse(row.data),open=data.lines.filter(line=>line.state!=="confirmed");
    if(!open.length) continue;
    const values=await openFigures(membership.firmId,row.id,data);
    left.push(...open.map(line=>({draft:row.id,line,figure:values.get(line.id)!})));
  }
  if(!left.length) return null;
  return <section className="fill-checks" aria-label="Figures not checked yet">
    <p><strong>{left.length} {left.length===1 ? "figure" : "figures"} not checked yet.</strong> You can look at this draft. Approving and downloading wait until every figure is checked.</p>
    <ul>{left.slice(0,20).map(({draft,line,figure})=><li key={line.id} className={line.state==="rejected" ? "is-wrong" : undefined}>
      <span className="grow">{figure.label}{line.state==="rejected" && <span className="sub">Marked wrong</span>}</span><span className="num">{figure.value}</span>
      <Link className="b b-secondary b-small" href={`${at}?tab=extraction&draft=${draft}&line=${line.id}`}>{line.state==="rejected" ? "Correct" : "Check"}</Link>
    </li>)}</ul>
    {left.length>20 && <p className="hint">{left.length-20} more in <Link href={`${at}?tab=extraction`}>Figures</Link>.</p>}
  </section>;
}

// A return's Check step: the filled draft's figures still to check, a group at a time (an
// invoice's row of a register, or what one page of a paper gave), each group said yes to at once
// with any figure in it ticked as wrong (checkGroup in dataset-actions.ts). Every figure is still
// seen and decided by a person; its paper, at its spot, is one click away. at: the return's page.
export async function GroupChecks({client,sources,at,check}:{client:string;sources:{id:string}[];at:string;check?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const {data:rows}=await supabase.from("datasets").select("id,data,revision,period_key").eq("firm_id",membership.firmId).eq("client_id",client).in("id",sources.map(source=>source.id));
  const sets=[];
  for(const row of rows ?? []) {
    const data=draftSchema.parse(row.data);
    if(data.lines.every(line=>line.state==="confirmed")) continue;
    const figures=await openFigures(membership.firmId,row.id,data);
    let ready=true;
    try {await verifySources(membership.firmId,client,data);} catch {ready=false;}
    let issues:string[];
    try {issues=checkFigures(data,figures);} catch {issues=["These figures could not be checked."];}
    if(data.target) issues.push(...await checkItr(client,row.period_key,row.id,row.revision,data,figures).catch(()=>["These figures could not be checked against the official return yet."]));
    sets.push({row,data,figures,ready,issues});
  }
  if(!sets.length) return null;
  const ids=[...new Set(sets.flatMap(({data})=>data.lines.flatMap(line=>line.source.document ? [line.source.document] : [])))];
  const {data:papers}=ids.length ? await supabase.from("documents").select("id,document_type").eq("firm_id",membership.firmId).eq("client_id",client).in("id",ids).neq("status","deleted") : {data:[]};
  type Line=Draft["lines"][number];
  const where=(line:Line)=>line.source.entered_by ? "Typed by your team" : `${papers?.find(paper=>paper.id===line.source.document)?.document_type ?? "Paper"}, ${line.source.cell ? `sheet ${line.source.sheet}, cell ${line.source.cell}` : `page ${line.source.page}`}`;
  const groups:CheckGroup[]=[];
  for(const {row,data,figures,ready,issues} of sets) {
    // A register's row is one invoice or note; any other figure goes with the others of its kind
    // from the same page of the same paper.
    const keyOf=(line:Line)=>{const cell=registerLine(line.field);return cell ? `${cell.section}.${cell.row}` : `${line.field.replace(/\.[^.]+$/,"")}|${line.source.document ?? "typed"}|${line.source.page ?? ""}`;};
    const all=new Map<string,Line[]>();
    for(const line of data.lines) all.set(keyOf(line),[...all.get(keyOf(line)) ?? [],line]);
    for(const [key,lines] of all) {
      const open=lines.filter(line=>line.state!=="confirmed");
      if(!open.length) continue;
      const label=(line:Line)=>figures.get(line.id)!.label.replace(/, row \d+$/,""),cell=registerLine(lines[0].field);
      // A register row is named by its number and party; other figures by the words their labels share.
      const named=(test:RegExp)=>{const line=lines.find(one=>test.test(label(one)));return line && figures.get(line.id)!.value;};
      // The words every label starts with (head) or ends with (tail) name the group; each box keeps the rest.
      const parts=open.map(line=>label(line).split(", ")),shared=parts[0];
      let head=0,tail=0;
      while(open.length>1 && parts.every(one=>one.length>head+1 && one[head]===shared[head])) head++;
      while(open.length>1 && !head && parts.every(one=>one.length>tail+1 && one.at(-1-tail)===shared.at(-1-tail))) tail++;
      const words=head ? shared.slice(0,head) : shared.slice(shared.length-tail),shown=words.join(", ");
      const place=cell && `${salesSections[cell.section].name}, row ${cell.row.slice(1)}`,number=cell && named(/^(Invoice|Note|Document) Number$/);
      const title=cell ? number || place! : words.length ? `${shown[0].toUpperCase()}${shown.slice(1)}` : where(open[0]);
      const sub=cell ? [named(/^Receiver Name$/),number && place].filter(Boolean).join(", ") : words.length ? where(open[0]) : "";
      // At most 12 figures to a group, so one Yes never covers more than a person can see at once.
      for(let n=0;n<open.length;n+=12) groups.push({key:`${row.id}:${key}:${n}`,draft:row.id,revision:row.revision,title,sub,blocked:!ready ? messages.source : issues.length ? `${issues.join(" ")} Correct the figures first.` : undefined,
        figures:open.slice(n,n+12).map(line=>{const figure=figures.get(line.id)!;return {id:line.id,label:label(line).split(", ").slice(head,tail ? -tail : undefined).join(", ") || label(line),value:figure.kind==="date" ? dueLabel(figure.value) : grouped(figure.value,figure.kind,0),wrong:line.state==="rejected",where:where(line),href:`${at}?tab=extraction&draft=${row.id}&line=${line.id}`};})});
    }
  }
  const figures=groups.reduce((sum,group)=>sum+group.figures.length,0);
  const may=membership.may("check_figures",client),viewOnly=!!membership.viewOnlyUntil;
  return <CheckGroups client={client} groups={groups.slice(0,30)} figures={figures} more={groups.length-30} canCheck={!viewOnly && may} why={viewOnly ? viewOnlyWords(membership.viewOnlyUntil) : may ? "" : "Ask your firm's owner to let you check figures for this client."} focus={!!check}/>;
}
