import type {currentMember} from "../member";
import {checkWords,itrChecks} from "../itr-check";
import {itrYear} from "../itr-fields";
import type {WorkItem} from "./forms";

type Member=Awaited<ReturnType<typeof currentMember>>;

// Each income tax return started and not yet filed whose figures differ from the client's Form
// 26AS or Form 16 (src/lib/itr-check.ts), for the client's assigned people, read as the signed in
// person so row level security decides which clients count. At most 50 returns are checked.
export async function itrCheckWorkItems({supabase,membership}:{supabase:Member["supabase"];membership:NonNullable<Member["membership"]>;userId?:string}):Promise<WorkItem[]> {
  const {data:started,error}=await supabase.from("datasets").select("client_id,period_key,form:data->target->>form").eq("firm_id",membership.firmId).eq("form_code","ITR").not("data->target","is",null).not("data->lines->0->source->>entered_by","is",null).limit(200);
  if(error || !started?.length) return [];
  const ids=[...new Set(started.map(row=>row.client_id))];
  const [{data:filed},{data:clients}]=await Promise.all([
    supabase.from("tasks").select("client_id,period_key").eq("firm_id",membership.firmId).like("code","ITR%").eq("status","filed").in("client_id",ids),
    supabase.from("clients").select("id,name").eq("firm_id",membership.firmId).in("id",ids),
  ]);
  const done=new Set((filed ?? []).map(task=>`${task.client_id}:${task.period_key?.slice(0,4)}`));
  const returns=[...new Map(started.filter(row=>row.form && !done.has(`${row.client_id}:${row.period_key}`)).map(row=>[`${row.client_id}:${row.period_key}:${row.form}`,{client:row.client_id,period:row.period_key,form:String(row.form)}])).values()].slice(0,50);
  const checks=await itrChecks(supabase,membership.firmId,returns).catch(()=>[]);
  return returns.flatMap((work,at)=>{
    const name=clients?.find(client=>client.id===work.client)?.name,differences=checks[at]?.differences ?? [];
    if(!name || !differences.length) return [];
    return [{key:`itr-check:${work.client}:${work.period}:${work.form}`,title:`${work.form.replace("ITR","ITR-")} for ${name}, ${itrYear(work.period)}`,why:`${checkWords(differences)}. Check before approving`,
      client:{id:work.client,name},action:{label:"See differences",href:`/app/clients/${work.client}/itr?form=${work.form}&year=${work.period}`},audience:"assigned" as const}];
  });
}
