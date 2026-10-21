import Link from "next/link";
import {redirect} from "next/navigation";
import {z} from "zod";
import {currentMember,currentWriter} from "@/src/lib/member";
import {grantFor} from "@/src/lib/permission-grants";
import {readSales,savedSalesMappings} from "@/src/lib/sales-draft";
import {workerSheet} from "@/src/lib/worker-read";
import {exactMapping,sameHeadings,mappingSchema} from "@/src/lib/sales-register";
import {salesSections,type SalesSection} from "@/src/lib/gstr1-fields";
import {askPermission} from "@/app/(app)/actions";

async function readRegister(form:FormData) {
  "use server";
  const {supabase,membership,userId}=await currentWriter();
  if(!membership) redirect("/app");
  const client=z.uuid().parse(form.get("client")),id=z.uuid().parse(form.get("source"));
  const back=`/app/clients/${client}?tab=extraction&source=${id}`;
  const permission=membership.may("edit_figures") ? null : await grantFor(membership.firmId,userId,"edit_figures",client);
  if(!membership.may("edit_figures") && !permission) redirect(`${back}&read=permission`);
  const {data:doc}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key,work_type,status").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",id).eq("work_type","gst").eq("status","filed").single();
  if(!doc) redirect(`${back}&read=source`);
  let draft:string|null=null;
  try {
    const section=z.enum(Object.keys(salesSections) as [SalesSection,...SalesSection[]]).parse(form.get("section"));
    const header=z.coerce.number().int().min(1).max(40).parse(form.get("header"))-1;
    const rows=await workerSheet(membership.firmId,doc);
    const mapping=mappingSchema.parse({section,header,headings:rows[header],columns:salesSections[section].headings.map((_,index)=>Number(form.get(`column${index}`) ?? -1))});
    draft=await readSales(doc,userId,mapping,permission);
  } catch {redirect(`${back}&read=check`);}
  redirect(`/app/clients/${client}?tab=extraction&draft=${draft}`);
}

export async function SalesInput({clientId,source,section:asked,header:askedHeader,read}:{clientId:string;source?:string;section?:string;header?:string;read?:string}) {
  const {supabase,membership,userId}=await currentMember();
  if(!membership) return null;
  const {data:files}=await supabase.from("documents").select("id,firm_id,client_id,name,sha256,period_key").eq("firm_id",membership.firmId).eq("client_id",clientId).eq("work_type","gst").eq("status","filed").order("received_at",{ascending:false}).limit(100);
  const registers=files?.filter((file)=>/\.(xlsx?|csv)$/i.test(file.name)) ?? [];
  if(!registers.length) return null;
  const selected=registers.find((file)=>file.id===source);
  let rows:string[][]=[],issue="";
  if(selected) {try {rows=await workerSheet(membership.firmId,selected);} catch {issue="The register could not be read. Check the drive connection, file size and columns. The first sheet may have up to 1,000 rows and 26 columns.";}}
  const mappings=rows.length ? await savedSalesMappings(membership.firmId,clientId) : [];
  const remembered=mappings.filter((map)=>sameHeadings(rows[map.header] ?? [],map.headings));
  const suggestion=remembered.length===1 ? remembered[0] : exactMapping(rows);
  const section=asked && Object.hasOwn(salesSections,asked) ? asked as SalesSection : suggestion?.section ?? "b2b";
  const header=Number(askedHeader || (suggestion?.header ?? 0)+1);
  const headings=Number.isInteger(header) && header>=1 && header<=40 ? rows[header-1] ?? [] : [];
  const canEdit=!membership.viewOnlyUntil && (membership.may("edit_figures") || !!await grantFor(membership.firmId,userId,"edit_figures",clientId));
  return <section className="section"><h2>Read a sales register</h2><p className="hint">Choose one section per file. Tally and other register exports use the columns you confirm here. These choices are remembered for this client. Nothing goes into a form until the figures are checked.</p>
    <nav className="pills" aria-label="Sales registers">{registers.map((file)=><Link href={`?tab=extraction&source=${file.id}`} key={file.id} aria-current={selected?.id===file.id ? "page" : undefined}>{file.name}</Link>)}</nav>
    {(issue || read) && <p className="alert" role="alert">{issue || (read==="permission" ? "Ask for permission to prepare these figures." : "Check the columns, dates and numbers, the file's month, and the drive connection. A changed source must be added again.")}</p>}
    {selected && rows.length>0 && <><form method="get" className="form-row"><input type="hidden" name="tab" value="extraction"/><input type="hidden" name="source" value={selected.id}/><label>GSTR-1 section<select name="section" defaultValue={section}>{Object.entries(salesSections).map(([key,value])=><option value={key} key={key}>{value.name}</option>)}</select></label><label>Column names are on row<input type="number" name="header" min={1} max={40} defaultValue={header}/></label><button className="b b-secondary">Show columns</button></form>
    {canEdit ? <form action={readRegister} className="fields"><input type="hidden" name="client" value={clientId}/><input type="hidden" name="source" value={selected.id}/><input type="hidden" name="section" value={section}/><input type="hidden" name="header" value={header}/>{salesSections[section].headings.map((name,index)=>{
      const column=suggestion?.section===section && suggestion.header===header-1 ? suggestion.columns[index] : headings.findIndex((heading)=>heading.trim().toLowerCase()===name.toLowerCase());
      return <label key={name}>{name}<select name={`column${index}`} defaultValue={column}><option value={-1}>Not in this file</option>{headings.map((heading,n)=><option key={n} value={n}>{String.fromCharCode(65+n)}: {heading.slice(0,200)}</option>)}</select></label>;
    })}<button className="b b-primary">Confirm columns and read figures</button></form> : !membership.viewOnlyUntil && <form action={askPermission}><input type="hidden" name="client" value={clientId}/><input type="hidden" name="right" value="edit_figures"/><button className="b b-secondary">Ask to edit figures</button></form>}</>}
  </section>;
}
