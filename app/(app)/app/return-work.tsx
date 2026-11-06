import "./return-work.css";
import Link from "next/link";
import {currentMember} from "@/src/lib/member";
import {draftSchema,openFigures} from "@/src/lib/datasets";
import type {Work} from "@/src/lib/return-work";

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
