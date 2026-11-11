import Link from "next/link";
import {Suspense} from "react";
import {notFound,redirect} from "next/navigation";
import {CircleCheck,FileText,ListChecks} from "lucide-react";
import {askPermission,manageTasks} from "@/app/(app)/actions";
import {dueLabel,isItr,periodLabel,todayInIndia,verifyBy} from "@/src/lib/calendar";
import {workOfService,type DocumentRequest} from "@/src/lib/checklists";
import {itrReturns} from "@/src/lib/itr-fields";
import {deskViewer,desksOf,workOf} from "@/src/lib/desks";
import {currentMember,viewOnlyWords} from "@/src/lib/member";
import {preparedSchema} from "@/src/lib/prepared";
import {personName} from "@/src/lib/roles";
import {currentStep,nextAction,stepNames,stepsFor,type Step} from "@/src/lib/return-steps";
import {returnPeriod,stageLine} from "@/src/lib/return-work";
import {shortReturn} from "@/src/lib/work/today";
import {DatasetReview,messages} from "../../dataset-review";
import {ItrReturn} from "../../itr/itr-return";
import {TdsStatement} from "../../tds/tds-statement";
import {PortalInput} from "../../portal-input";
import {PurchaseMatch} from "../../purchase-match";
import {SalesInput} from "../../sales-input";
import {Fill} from "../../../../fill";
import {MarkFiled} from "../../../../mark-filed";
import {Pending} from "../../../../pending";
import {PreparedForms} from "../../../../prepared-forms";
import {ReturnFrame} from "../../../../return-frame";
import {GroupChecks,returnStages} from "../../../../return-work";
import {DeskChip} from "../../../../desk-chip";
import {stepQueue} from "../../../../work-data";
import {Badge,Card,Row,Toast} from "../../../../ui";
import "../../../clients.css";

const uuid=/^[0-9a-f-]{36}$/;
// The prepared forms a return's files are, and the forms its figures are read into.
const formsOf=(code:string)=>/^GSTR1_/.test(code) ? {files:["GSTR1"],figures:["GSTR1"]} : /^GSTR3B_/.test(code) ? {files:["GSTR3B"],figures:["GSTR1","GSTR3B"]}
  : /^ITR_/.test(code) ? {files:[...itrReturns],figures:["ITR"]} : code==="TDS_RET" ? {files:["TDS138","TDS140","TDS144"],figures:["TDS138","TDS140","TDS144"]} : code==="TCS_RET" ? {files:["TDS143"],figures:["TDS143"]} : null;

// One page per return (runbooks/return-page-design-6nov.md): its six steps, or the ones it has,
// from where public.return_stages says it stands, with the step's own parts of the client's
// Figures and Return files for this return only, and an ITR's or TDS statement's own page as its
// Draft step. ?step= opens a step; ?tab=extraction (Figures) and ?tab=outputs (Return files), where
// the forms on them come back to, open its figures and the step it stands at; ?purchases= (the
// GSTR-2B match) its Check step. Who may do what is the same as on those tabs: the same actions decide.
export default async function ReturnPage({params,searchParams}:{params:Promise<{id:string;task:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) redirect("/app");
  const [{id,task:taskId},q]=await Promise.all([params,searchParams]);
  if(!uuid.test(id) || !uuid.test(taskId)) notFound();
  const firm=membership.firmId,today=todayInIndia(),viewOnly=!!membership.viewOnlyUntil;
  const [{data:task},{data:client},{data:people},{data:teams}]=await Promise.all([
    supabase.from("tasks").select("id,code,period_key,due_on,status,details,registration_id,doer").eq("firm_id",firm).eq("client_id",id).eq("id",taskId).eq("kind","compliance").maybeSingle(),
    supabase.from("clients").select("id,name,client_assignments(user_id,team_id,role,work),client_registrations(services)").eq("firm_id",firm).eq("id",id).maybeSingle(),
    supabase.rpc("firm_people",{target_firm:firm}),
    supabase.from("groups").select("id,name").eq("kind","team"),
  ]);
  if(!task || !client) notFound();
  const code=task.code ?? "",period=task.period_key ?? "",itr=/^ITR_/.test(code),forms=formsOf(code),work=workOfService(code);
  const papers=supabase.from("documents").select("id,name,document_type").eq("firm_id",firm).eq("client_id",id).not("status","in","(deleted,earlier)").is("prepared",null);
  const [{data:rule},stages,{data:drafts},{data:asks},{data:filedPapers}]=await Promise.all([
    supabase.from("compliance_types").select("name,frequency").eq("code",code).eq("period_key","").maybeSingle(),
    returnStages(supabase,firm,[task.id]),
    forms ? supabase.rpc("return_drafts",{task_id:task.id}) : Promise.resolve({data:[]}),
    supabase.from("requests").select("id,status,details").eq("firm_id",firm).eq("kind","documents").eq("client_id",id).eq("details->>period",period).in("status",["pending","done"]).order("expires_at",{ascending:false}).limit(5),
    (itr ? papers.like("period_key",`${period.slice(0,4)}%`) : papers.eq("period_key",period)).match(work ? {work_type:work} : {}).order("received_at",{ascending:false}).limit(30),
  ]);
  const stage=stages.get(task.id) ?? {stage:task.status==="filed" ? "filed" : "none",open:null,missing:null,form:null};
  const [{data:latest},{data:names}]=await Promise.all([
    stage.form ? supabase.from("documents").select("id,prepared").eq("firm_id",firm).eq("id",stage.form).maybeSingle() : Promise.resolve({data:null}),
    drafts?.length ? supabase.from("documents").select("id,name").eq("firm_id",firm).in("id",drafts.flatMap(draft=>draft.document ? [draft.document] : [])) : Promise.resolve({data:[]}),
  ]);
  const meta=latest ? preparedSchema.parse(latest.prepared) : null;

  // As Fill reads it: a latest file counts only when corrected outside InboxCA. A fill whose last
  // figure was just checked waits for the checked draft InboxCA makes from it (Return files says so).
  const making=stage.stage==="checked" && !!meta?.filled && meta.status==="draft";
  const now={...stage,stage:making ? "draft" : stage.stage,form:meta?.external ? stage.form : null};
  const periodWords=periodLabel(rule?.frequency ?? null,period,code),name=`${rule?.name ?? code} ${periodWords}`;
  const sets=(drafts ?? []).map(draft=>({...draft,name:draft.form_code==="GSTR3B" ? "the GSTR-2B" : draft.target ? "your team's entries" : names?.find(paper=>paper.id===draft.document)?.name ?? (itr ? "a paper" : "the sales register")}));
  const approver=!viewOnly && ["owner","partner","manager"].includes(membership.role),canPrepare=!viewOnly && membership.may("edit_figures",id),canFile=!viewOnly && membership.may("mark_filed",id);
  const steps=stepsFor(code),at=currentStep(now,code),filed=task.status==="filed";
  const shown:Step=steps.includes(q.step as Step) ? q.step as Step : q.purchases && steps.includes("check") ? "check" : q.tab==="extraction" && steps.includes("figures") ? "figures" : at;
  const next=making ? {step:"approve" as const,why:"Every figure is checked. InboxCA is making the checked draft now."} : nextAction(now,code,{period:returnPeriod(code,period),drafts:sets,approver});
  const base=`/app/clients/${id}`,here=`${base}/returns/${task.id}`;

  // The one button for the next step. Approving, downloading and marking filed are the return
  // file's own buttons, in their step: from another step the button opens that step.
  const tds=code==="TDS_RET" || code==="TCS_RET",own=`${here}?step=draft`;
  const firstOpen=sets.find(set=>set.open)?.id ?? sets[0]?.id;
  let why=next?.why,action:React.ReactNode=null;
  if(next?.act && next.label) {
    if(["approve","download","file"].includes(next.act)) action=next.step!==shown && <Link className="b b-primary" href={`${here}?step=${next.step}`} scroll={false}>Go to {stepNames[next.step]}</Link>;
    else if(viewOnly && ["ask","upload","fill"].includes(next.act)) why=viewOnlyWords(membership.viewOnlyUntil);
    // Papers for it already in without an ask: a TDS statement or an ITR goes on in its Draft step.
    else if(next.act==="ask" && (tds || itr) && filedPapers?.length) action=<Link className="b b-primary" href={own} scroll={false}>{tds ? "Prepare the statement" : "Start the return"}</Link>;
    else if(next.act==="ask" || next.act==="upload") action=<Link className="b b-primary" href={`${base}?tab=documents&${next.act==="ask" ? "ask" : "upload"}=1`} scroll={false}>{next.label}</Link>;
    else if(next.act==="fill" && !canPrepare) {why="Preparing a return needs the right to edit figures.";action=<form action={askPermission}><input type="hidden" name="client" value={id}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-primary">Ask to prepare returns</Pending></form>;}
    else if(next.act==="fill") action=<Fill task={task.id} label={name} words={next.label}/>;
    // On its own Draft step an ITR not started yet says where: the form picker just below.
    else if(next.act==="open" && shown==="draft" && itr) why="Choose its form below and press Open.";
    else if(next.act==="open" && shown!=="draft" && (itr || tds && task.registration_id)) action=<Link className="b b-primary" href={own} scroll={false}>{next.label}</Link>;
    else if(next.act==="check" && firstOpen && !(shown==="check" && meta && stage.stage==="filled")) action=<Link className="b b-primary" href={`${here}?tab=extraction&draft=${firstOpen}`} scroll={false}>{next.label}</Link>;
  }
  // A GSTR-3B waiting for its GSTR-2B: the client's papers take the portal file.
  else if(next?.step==="figures" && stage.missing==="credit" && !viewOnly) action=<Link className="b b-primary" href={`${base}?tab=documents`}>Add the GSTR-2B</Link>;
  const queued=shown==="figures" || shown==="check" ? "check" as const : approver && (shown==="approve" || shown==="file" && at==="file" && !filed) ? "approve" as const : null;
  // Who does this return: its desk's person (src/lib/desks.ts), or someone covering it this once.
  const nameOf=(user:string|null)=>personName(people?.find(person=>person.user_id===user)?.email);
  const desks=desksOf(client.client_assignments,client.client_registrations.flatMap(number=>number.services),one=>(one.team_id ? teams?.find(team=>team.id===one.team_id)?.name : nameOf(one.user_id)) ?? "");
  const doer=task.doer ? {id:task.doer,team:false,name:nameOf(task.doer)} : null;
  const days=Math.round((Date.parse(task.due_on)-Date.parse(today))/86_400_000),details=task.details as {filed_on?:string;by?:string;ack?:string;udin?:string;verified_on?:string};
  const due=filed ? `Filed${details.filed_on ? ` ${dueLabel(details.filed_on)}` : ""}` : `Due ${dueLabel(task.due_on)}, ${days<0 ? `${-days} ${days===-1 ? "day" : "days"} late` : days===0 ? "today" : days===1 ? "tomorrow" : `in ${days} days`}`;
  const only=forms && task.registration_id ? {files:forms.files,figures:forms.figures,period:itr ? period.slice(0,4) : period,registration:task.registration_id} : null;

  return <ReturnFrame back={{href:`${base}?tab=returns`,name:client.name}} title={name} due={due} late={!filed && days<0}
    people={<><span className="hint">Done by</span><DeskChip client={{id,name:client.name}} desks={desks} work={workOf(code)} task={filed ? undefined : {id:task.id,doer}} viewer={deskViewer(membership,userId)} named/></>}
    status={filed ? "Filed" : stageLine(now,code) || "Not started"} shown={stepNames[shown]}
    steps={steps.map((step,n)=>({key:stepNames[step],label:stepNames[step],href:`${here}?step=${step}`,state:filed || n<steps.indexOf(at) ? "done" : step===at ? "now" : "later"}))}
    next={next ? {step:stepNames[next.step],why,action} : null}
    // The next return waiting for this person at Figures or Check, or (an approver) at Approve, also
    // on File just after approving; never on a step this return has not reached yet.
    after={membership.role!=="front_desk" && queued && (filed || steps.indexOf(shown)<=steps.indexOf(at)) && <Suspense fallback={null}>
      <NextReturn task={task.id} step={queued} primary={(shown==="check" || shown==="approve") && !action}/>
    </Suspense>}>
    {steps.indexOf(shown)>steps.indexOf(at) && !filed && <p className="hint">This step waits until {stepNames[at]} is done.</p>}
    {shown==="papers" && <Card id="rp-papers" title={`Papers for ${periodWords}`} Icon={FileText} kind="papers" className="rs-papers" end={<Link className="b b-ghost" href={`${base}?tab=documents`}>All papers</Link>}>
      <ul className="app-rows">
        {(asks ?? []).flatMap(ask=>((ask.details as unknown as DocumentRequest).items ?? []).map((item,n)=><Row key={`${ask.id}-${n}`} title={item.type} meta="Asked for"
          status={<Badge tone={item.received.length ? "done" : "warn"}>{item.received.length ? "Received" : "Missing"}</Badge>}
          action={!!item.received.length && <Link className="b b-ghost" href={`/app/files/${item.received[0]}/view`}>Open</Link>}/>))}
        {(filedPapers ?? []).map(paper=><Row key={paper.id} title={paper.name} meta={paper.document_type ?? "Paper"} action={<Link className="b b-ghost" href={`/app/files/${paper.id}/view`}>Open</Link>}/>)}
      </ul>
      {!asks?.length && !filedPapers?.length && <p className="app-card-none">No papers for {periodWords} yet.</p>}
    </Card>}
    {shown==="figures" && only && <>
      <DatasetReview clientId={id} draftId={q.draft} lineId={q.line} check={q.check} view={q.view} only={{forms:only.figures,period:only.period}}/>
      <div className="fig-tools">
        {/^GSTR/.test(code) && <SalesInput clientId={id} at={here} period={period} source={q.source} section={q.section} header={q.header} read={q.read}/>}
        {/^GSTR3B_/.test(code) && <PortalInput clientId={id} period={period} message={q.portal}/>}
        {(itr || tds) && <Card id="rp-own" title={itr ? "Income tax return" : "TDS statement"} Icon={FileText} kind="docs" end={<Link className="b b-secondary" href={own} scroll={false}>Go to Draft</Link>}><p className="app-card-none">{itr ? "Details you enter for this return are in its Draft step." : "The quarter's registers and challans are read in its Draft step."}</p></Card>}
      </div>
    </>}
    {shown==="draft" && only && itr && <ItrReturn id={id} q={{...q,year:period.slice(0,4),form:q.form ?? sets.find(set=>set.target)?.target ?? undefined}} at={here}/>}
    {shown==="draft" && only && tds && <TdsStatement id={id} q={{...q,tan:only.registration,period}} at={here} only={code==="TCS_RET" ? ["TDS143"] : ["TDS140","TDS138","TDS144"]}/>}
    {shown==="draft" && only && !itr && !tds && <Card id="rp-draft" title={`${name}: figures to fill from`} Icon={ListChecks} kind="docs">
      <ul className="app-rows">{sets.map(set=><Row key={set.id} title={set.name} meta={set.wrong ? `${set.wrong} marked wrong` : set.open ? `${set.open} not checked yet` : "Every figure checked"}
        action={<Link className="b b-ghost" href={`${here}?tab=extraction&draft=${set.id}`} scroll={false}>See figures</Link>}/>)}</ul>
      {!sets.length && <p className="app-card-none">No figures read for {periodWords} yet.</p>}
      <p className="app-card-foot hint">InboxCA fills the official file from every figure it has read, checked or not. Approving and downloading wait until every figure is checked.</p>
    </Card>}
    {shown==="check" && <>
      {/* What the last group's All correct or Wrong did (checkGroup), also when it was the last figure. */}
      {q.check==="saved" || q.check==="marked" ? <Toast>{messages[q.check]}</Toast> : q.check && messages[q.check] && <p className="alert" role="status">{messages[q.check]}</p>}
      {meta && stage.stage==="filled" ? <GroupChecks client={id} sources={meta.sources} at={here} check={q.check}/> : (filed || steps.indexOf(at)>steps.indexOf("check")) && <p className="app-card-none">Every figure on the draft is checked.</p>}
      {/^GSTR3B_/.test(code) && <PurchaseMatch clientId={id} at={here} period={period} searchParams={searchParams}/>}
    </>}
    {(shown==="approve" || shown==="file") && only && <PreparedForms client={id} message={q.form} only={{forms:only.files,period:only.period,registration:only.registration}}/>}
    {shown==="file" && !filed && canFile && stage.stage!=="approved" && <Card id="rp-file" title="Mark filed" Icon={CircleCheck} kind="done">
      <MarkFiled state={<input type="hidden" name="client" value={id}/>} rows={[{id:task.id,name,sub:`Due ${dueLabel(task.due_on)}`,itr:isItr(code),udin:code==="TAX_AUDIT"}]}/>
    </Card>}
    {shown==="file" && filed && <Card id="rp-filed" title="Filed" Icon={CircleCheck} kind="done">
      <ul className="app-rows"><Row title={`Filed${details.filed_on ? ` ${dueLabel(details.filed_on)}` : ""}${details.by ? ` by ${personName(people?.find(person=>person.user_id===details.by)?.email)}` : ""}`}
        meta={[details.ack && `ARN ${details.ack}`,details.udin && `UDIN ${details.udin}`,isItr(code) && (details.verified_on ? `E-verified ${dueLabel(details.verified_on)}` : `Verify by ${dueLabel(verifyBy(details.filed_on ?? task.due_on))}`)].filter(Boolean).join(", ") || undefined}
        action={canFile && <form action={manageTasks}><input type="hidden" name="client" value={id}/><input type="hidden" name="task" value={task.id}/>{isItr(code) && !details.verified_on && <Pending className="b b-secondary" name="intent" value="verified">Mark verified</Pending>}<Pending className="b b-ghost" name="intent" value="reopen">Not filed after all</Pending></form>}/></ul>
    </Card>}
  </ReturnFrame>;
}

// The next return waiting at a step for this person, in the Calendar's order and visibility for
// that step (work-data.ts stepQueue): the one after this return, else the first. It is the page's
// one primary button once this return has left that step's list, when nothing else is (primary).
async function NextReturn({task,step,primary}:{task:string;step:"check"|"approve";primary:boolean}) {
  const {supabase,membership}=await currentMember();
  const queue=membership && await stepQueue({supabase,membership}).then(({groups})=>groups[step]).catch(()=>null);
  if(!queue) return null;
  const at=queue.findIndex(one=>one.id===task),next=[...queue.slice(at+1),...queue.slice(0,Math.max(at,0))][0];
  return <nav className="rs-after" aria-label={step==="check" ? "Next return to check" : "Next return to approve"}>
    {next ? <Link className={`b ${primary && at<0 ? "b-primary" : "b-secondary"}`} href={`/app/clients/${next.client_id}/returns/${next.id}`}>Next: {next.clients.name} {shortReturn(next.code ?? "",next.period_key ?? "",todayInIndia())}</Link>
      : <span className="hint">Nothing else to {step}</span>}
  </nav>;
}
