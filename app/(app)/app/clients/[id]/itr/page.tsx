import Link from "next/link";
import {redirect,unstable_rethrow} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {itrDetails,itrField,itrYear,enterItr} from "@/src/lib/itr";
import {draftSchema} from "@/src/lib/datasets";
import {askPermission} from "@/app/(app)/actions";
import {grantFor} from "@/src/lib/permission-grants";

export default async function ItrPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {id}=await params,q=await searchParams,form=z.enum(["ITR1","ITR4"]).catch("ITR1").parse(q.form),period=/^20\d{2}$/.test(q.year ?? "") ? q.year! : "2026";
  let details:Awaited<ReturnType<typeof itrDetails>>;
  try {details=await itrDetails(id,form,period,false);} catch(error) {unstable_rethrow(error);return <div className="content"><h1>Income tax figures</h1><p>These figures cannot be opened yet. Check the client&apos;s PAN, assessment year and connection.</p><Link href={`/app/clients/${id}`}>Back to client</Link></div>;}
  const {context,entries}=details,{membership,supabase,client}=context;
  const canEdit=!membership.viewOnlyUntil && (membership.may("edit_figures",id) || !!await grantFor(membership.firmId,context.userId,"edit_figures",id));
  const {data:drafts}=await supabase.from("datasets").select("id,target:data->target").eq("firm_id",membership.firmId).eq("client_id",id).eq("form_code","ITR").eq("period_key",period).order("id").limit(100);
  const choices=drafts?.filter(row=>!row.target || z.object({form:z.string()}).parse(row.target).form===form),chosen=q.draft==="" ? null : choices?.find(row=>row.id===q.draft) ?? choices?.[0];
  const {data:draft}=chosen ? await supabase.from("datasets").select("id,data,revision").eq("firm_id",membership.firmId).eq("client_id",id).eq("id",chosen.id).maybeSingle() : {data:null};
  const groups=[...new Set(entries.map(entry=>entry.group))],group=groups.includes(q.group ?? "") ? q.group! : groups[0];
  const rows=[q.row,q.row2,q.row3,q.row4,q.row5].map(value=>z.coerce.number().int().min(1).max(1000).catch(1).parse(value ?? 1)-1);
  const existing=new Set(draft ? draftSchema.parse(draft.data).lines.map(line=>line.field) : []);
  async function save(input:FormData) {
    "use server";
    let draft:string;
    try {draft=await enterItr(id,form,period,input);} catch(error) {unstable_rethrow(error);redirect(`/app/clients/${id}/itr?form=${form}&year=${period}&message=check`);}
    revalidatePath("/app","layout");redirect(`/app/clients/${id}?tab=extraction&draft=${draft}`);
  }
  return <div className="content"><Link href={`/app/clients/${id}?tab=extraction`}>Back to {client.name}</Link><h1>Income tax figures</h1>
    <p>Enter the details from your records, then check each one. Filing files are not available yet. The software registration and remaining official checks still need verification.</p>
    {q.message && <p className="alert" role="status">Check the entries and your permission. Use the review screen to correct figures already saved.</p>}
    <form className="fields" method="get"><div className="form-row"><div><label htmlFor="return">Return</label><select name="form" id="return" defaultValue={form}><option value="ITR1">ITR-1</option><option value="ITR4">ITR-4</option></select></div><div><label htmlFor="year">Assessment year starts in</label><input id="year" name="year" defaultValue={period} inputMode="numeric" pattern="20[0-9]{2}" required/></div></div>
      <div><label htmlFor="group">Details</label><select name="group" id="group" defaultValue={group}>{groups.map(group=><option key={group}>{group}</option>)}</select></div>
      <div><label htmlFor="draft">Figures to add to</label><select name="draft" id="draft" defaultValue={draft?.id ?? ""}><option value="">New draft</option>{choices?.map((row,index)=><option key={row.id} value={row.id}>Draft {index+1}</option>)}</select></div>
      <div className="form-row">{Array.from({length:Math.max(1,...entries.filter(entry=>entry.group===group).map(entry=>entry.rows))},(_,index)=><div key={index}><label htmlFor={`row-${index}`}>{index ? `Inner row ${index}` : "Row, for repeated entries"}</label><input id={`row-${index}`} name={index ? `row${index+1}` : "row"} type="number" min={1} max={1000} defaultValue={rows[index]+1}/></div>)}</div><button className="b b-secondary">Open details</button>
    </form>
    <section className="panel"><h2>{form.replace("ITR","ITR-")} {itrYear(period)}: {group}</h2>
      <p className="hint">Leave anything that does not apply empty. Suggested values are from the official form. Check them against the client&apos;s records before saving.</p>
      {!canEdit ? <form action={askPermission}><input type="hidden" name="client" value={id}/><input type="hidden" name="right" value="edit_figures"/><button className="b b-secondary" disabled={!!membership.viewOnlyUntil}>Ask to enter figures</button></form> : <form action={save} className="fields"><input type="hidden" name="draft" value={draft?.id ?? ""}/><input type="hidden" name="revision" value={draft?.revision ?? 0}/>
        {entries.filter(entry=>entry.group===group).map(entry=>{const field=itrField(entry,rows),saved=existing.has(field);return <div key={field}><label htmlFor={field}>{entry.label}{entry.rows>0 && `, row ${rows[0]+1}`}</label>{saved ? <p className="hint">Already saved. Correct it on the review screen.</p> : entry.choices || entry.primitive==="boolean" ? <select id={field} name={field} defaultValue=""><option value="">Leave empty</option>{(entry.choices ?? ["true","false"]).map(choice=><option key={choice} value={choice}>{choice}</option>)}</select> : <input id={field} name={field} maxLength={2000} type={entry.kind==="date" ? "date" : "text"} inputMode={entry.kind==="number" ? "decimal" : undefined} defaultValue={entry.path==="PersonalInfo.PAN" ? context.number : entry.defaultValue ?? ""}/>}</div>;})}
        <button className="b b-primary">Save figures for checking</button>
      </form>}
      {draft && <Link href={`/app/clients/${id}?tab=extraction&draft=${draft.id}`}>Check saved figures</Link>}
    </section>
  </div>;
}
