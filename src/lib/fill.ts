import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/src/db/types";
import {draftSchema,openFigures,verifySources,type Figure} from "./datasets";
import {fills,notReady,returnPeriod} from "./return-work";
import {itrReady} from "./itr-fields";
import {formName} from "./prepared";

// Fill (PLAN.md 5.7.4 as the user changed it on 26 Oct 2026): a GSTR-1, GSTR-3B or ITR made from
// every figure InboxCA has read for the return, checked or not. Read with the caller's own database
// client: the person's for Fill, the server's for the automatic fill. Its draft can be looked at;
// approving, downloading and filing it wait until every figure is checked (fill_form). An ITR is
// the form its team chose on its own page (src/lib/itr.ts): that form's entered figures and the
// client's papers for the assessment year.
export async function fillWork(db:SupabaseClient<Database>,firm:string,task:string) {
  const [{data:row},{data:stages},{data:drafts}]=await Promise.all([
    db.from("tasks").select("client_id,registration_id,code,period_key").eq("firm_id",firm).eq("id",task).maybeSingle(),
    db.rpc("return_stages",{target_firm:firm,task_ids:[task]}),
    db.rpc("return_drafts",{task_id:task}),
  ]);
  if(!row?.registration_id || !row.period_key || !row.code || !stages?.[0] || !fills(row.code)) return {refusal:"InboxCA cannot fill this return here."};
  const itr=row.code.startsWith("ITR_"),forms=[...new Set((drafts ?? []).flatMap(draft=>draft.target ? [draft.target] : []))];
  const papers=(drafts ?? []).map(draft=>draft.document).filter((id):id is string=>!!id);
  const {data:names}=papers.length ? await db.from("documents").select("id,name").eq("firm_id",firm).in("id",papers) : {data:[]};
  // Only a file corrected outside InboxCA has to be checked first: an earlier fill whose figures
  // changed since is filled again, as its next version.
  const {data:latest}=stages[0].stage==="figures" && stages[0].form ? await db.from("documents").select("prepared").eq("firm_id",firm).eq("id",stages[0].form).maybeSingle() : {data:null};
  const refusal=notReady({...stages[0],form:(latest?.prepared as {external?:boolean} | null)?.external ? stages[0].form : null},(drafts ?? []).map(draft=>({wrong:draft.wrong,name:draft.form_code==="GSTR3B" ? "the GSTR-2B" : draft.target ? "your team's entries" : names?.find(paper=>paper.id===draft.document)?.name ?? (itr ? "a paper" : "the sales register")})),returnPeriod(row.code,row.period_key));
  if(refusal) return {refusal};
  // Never a guess between two forms, and no ITR file before the department's software ID.
  if(forms.length>1) return {refusal:`Figures are entered for both ${forms.map(formName).join(" and ")}. Prepare the right one under Return files.`};
  if(itr && !itrReady()) return {refusal:"InboxCA cannot make the return file for the income tax portal yet. It is waiting for its software ID from the Income Tax Department."};
  const {data:rows}=await db.from("datasets").select("id,revision,data").eq("firm_id",firm).eq("client_id",row.client_id).in("id",drafts!.map(draft=>draft.id));
  if(rows?.length!==drafts!.length || rows.length>25) return {refusal:"The figures changed. Open the return again."};
  const filled=[];
  for(const source of rows) {
    const data=draftSchema.parse(source.data);
    await verifySources(firm,row.client_id,data);
    const values=await openFigures(firm,source.id,data);
    filled.push({id:source.id,revision:source.revision,figures:data.lines.map(line=>[line.field,values.get(line.id)!] as [string,Figure])});
  }
  return {client:row.client_id,registration:row.registration_id,period:itr ? row.period_key.slice(0,4) : row.period_key,form:itr ? forms[0] : row.code.startsWith("GSTR1") ? "GSTR1" : "GSTR3B",drafts:filled};
}
