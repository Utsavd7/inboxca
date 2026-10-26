import "./return-work.css";
import Link from "next/link";
import {currentMember} from "@/src/lib/member";
import {draftSchema,openFigures} from "@/src/lib/datasets";
import {returnOf,stageLine,stepOf,steps,type Work} from "@/src/lib/return-work";

type Db=Awaited<ReturnType<typeof currentMember>>["supabase"];

// Where each return on a page stands, read as the signed in person.
export const returnStages=(supabase:Db,firm:string,tasks:string[])=>
  tasks.length ? Promise.resolve(supabase.rpc("return_stages",{target_firm:firm,task_ids:tasks})).then(({data})=>new Map((data ?? []).map(row=>[row.task,row as Work]))) : Promise.resolve(new Map<string,Work>());

// One plain line under a return: six small steps, then where it stands in words.
export function StageLine({code,work}:{code:string|null;work?:Work}) {
  if(!work || work.stage==="filed" || !returnOf(code) && work.stage==="none") return null;
  const at=stepOf(work.stage);
  return <span className="sub stage-line"><span className="stage-steps" role="img" aria-label={`${at} of ${steps.length} steps done`}>{steps.map((step,n)=><i key={step} className={n<at ? "on" : undefined}/>)}</span>{stageLine(work)}</span>;
}

// A filled draft's figures still to check, each highlighted with a link to check it. Approving
// and downloading wait until none is left.
export async function FillChecks({client,sources}:{client:string;sources:{id:string}[]}) {
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
      <Link className="b b-secondary b-small" href={`/app/clients/${client}?tab=extraction&draft=${draft}&line=${line.id}`}>{line.state==="rejected" ? "Correct" : "Check"}</Link>
    </li>)}</ul>
    {left.length>20 && <p className="hint">{left.length-20} more in <Link href={`/app/clients/${client}?tab=extraction`}>Figures</Link>.</p>}
  </section>;
}
