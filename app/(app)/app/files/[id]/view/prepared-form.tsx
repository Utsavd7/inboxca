import "../../../returns.css";
import {createHash} from "node:crypto";
import Link from "next/link";
import {z} from "zod";
import {serverCrypto} from "@/src/lib/crypto";
import {hundredths} from "@/src/lib/datasets";
import {openDrive} from "@/src/lib/drive-account";
import {viewerLabel} from "@/src/lib/file-worker";
import {formLayout,grouped,gstr3bFile,textLayout,type FormLayout,type FormRow} from "@/src/lib/form-layout";
import {numericHeadings} from "@/src/lib/gstr1-fields";
import type {preparedSchema} from "@/src/lib/prepared";
import {currentMember} from "@/src/lib/member";
import {supabaseAdmin} from "@/src/lib/supabase";
import type {Template} from "@/src/lib/templates";
import {workerRead} from "@/src/lib/worker-read";
import {FigureForm} from "../../../clients/[id]/form-sheet";
import {FormStamp} from "./form-stamp";

const lines=z.object({lines:z.array(z.object({field:z.string(),label:z.string(),value:z.string(),kind:z.enum(["number","text","date"])})).max(10000)});
const money=(head:string)=>numericHeadings.test(head) && !/Rate|Quantity/.test(head);
const rupees=(amount:bigint,decimals:number)=>{const size=amount<BigInt(0) ? -amount : amount;return grouped(`${amount<BigInt(0) ? "-" : ""}${size/BigInt(100)}.${String(size%BigInt(100)).padStart(2,"0")}`,undefined,decimals);};
const PAGE=50;

// A prepared return, read only, the way the portal's form screens lay it out: GSTR-3B from its
// upload file, GSTR-1 from its offline tool workbook (a summary for each table, open to its rows,
// 50 at a time) and ITR-1 to ITR-4 from the return file (form-layout.ts). It is read again each
// time from the firm's drive (the GSTR-1 and ITR files through the file worker's form reader).
export async function PreparedForm({file,meta,template,from}:{file:{id:string;client_id:string;period_key:string};meta:z.infer<typeof preparedSchema>;template:Template;from?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const admin=supabaseAdmin(),itr=meta.form.startsWith("ITR");
  const [{data:paper},{data:account},{data:registration}]=await Promise.all([
    admin.from("documents").select("name,sha256,drive_file_id").eq("firm_id",membership.firmId).eq("id",file.id).single(),
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle(),
    supabase.from("client_registrations").select("kind,number_enc").eq("firm_id",membership.firmId).eq("client_id",file.client_id).eq("id",meta.registration).maybeSingle(),
  ]);
  let layout:FormLayout|null=null;
  const sums=new Map<string,(bigint|null)[]>();
  try {
    if(!paper || !account || !registration) throw new Error("Not available");
    if(meta.form==="GSTR3B") {
      const bytes=await (await openDrive(membership.firmId,account)).read(paper.drive_file_id);
      if(createHash("sha256").update(bytes).digest("hex")!==paper.sha256) throw new Error("The file changed");
      layout=gstr3bFile(JSON.parse(new TextDecoder().decode(bytes)));
    } else {
      const number=await serverCrypto().decrypt(membership.firmId,`clients/${file.client_id}/${registration.kind}`,registration.number_enc);
      const read=lines.parse(await workerRead(membership.firmId,{id:file.id,name:paper.name,sha256:paper.sha256},"edited",{template:itr ? {...template,mappings:{format:"json"}} : template,period:file.period_key,...(itr ? {pan:number} : {gstin:number})})).lines;
      const values=new Map(read.map((line)=>[line.field,{value:line.value,kind:line.kind}])),placed=formLayout(itr ? "ITR" : "GSTR1",read.map((line)=>({id:line.field,field:line.field,label:line.label})),{target:meta.form});
      // Each GSTR-1 table's totals of its amounts, over its own rows (not a register's total rows).
      if(!itr) for(const table of placed.tables) sums.set(table.key,table.heads.map((head,index)=>money(head) ? table.rows.filter((row)=>row.name.startsWith("Row")).reduce((sum,row)=>sum+(row.cells[index]?.ids ?? []).reduce((all,id)=>all+hundredths(values.get(id)!.value),BigInt(0)),BigInt(0)) : null));
      layout=textLayout(placed,values);
    }
  } catch {layout=null;}
  const note=<p className="pf-note">InboxCA preview. File it on the portal with your own code or signature.</p>;
  if(!layout) return <div className="pf">{note}<p className="hint">This return cannot be shown as a form here. Choose File view to see its pages.</p></div>;
  const [section,start]=/^([a-z0-9_]+):(\d+)$/.exec(from ?? "")?.slice(1) ?? [];
  // A total keeps its column's decimals rule.
  const decimals=(table:FormLayout["tables"][number],index:number)=>table.rows.some((row)=>row.cells[index]?.text?.includes(".")) ? 2 : 0;
  const totalRow=(table:FormLayout["tables"][number],cells:(bigint|null)[]):FormRow=>({key:`${table.key}.total`,name:"Total",fill:"worked",cells:cells.map((sum,index)=>sum===null ? null : {text:rupees(sum,decimals(table,index))})});
  return <FormStamp id={file.id} label={viewerLabel(membership.email,membership.firmName)} hideInactive={membership.settings.viewer_hide_inactive===true}>
    {note}
    {meta.form!=="GSTR1" ? <FigureForm layout={layout}/> : <div className="pf-secs">
      {layout.tables.map((table,index)=>{
        const rows=table.rows.filter((row)=>row.name.startsWith("Row")).length,first=table.key===section ? Number(start) : 0,shown=table.rows.slice(first,first+PAGE),total=sums.get(table.key);
        const main=table.heads.findIndex((head)=>head==="Taxable Value"),lead=main>=0 ? main : total?.findIndex((sum)=>sum!==null) ?? -1;
        return <details key={table.key} className="pf-sec" open={table.key===section || !section && index===0}>
          <summary><strong>{table.name}</strong><span>{rows} {rows===1 ? "row" : "rows"}</span>{total && lead>=0 && total[lead]!==null && <span>{table.heads[lead]} {rupees(total[lead]!,decimals(table,lead))}</span>}</summary>
          <FigureForm layout={{tables:[{...table,name:"",rows:[...shown,...(total ? [totalRow(table,total)] : [])]}],placed:0}}/>
          {table.rows.length>PAGE && <nav className="pager" aria-label={`${table.name} rows`}><span className="hint">Rows {first+1} to {Math.min(first+PAGE,table.rows.length)} of {table.rows.length}</span><span>{first>0 && <Link href={`?from=${table.key}:${first-PAGE}`} scroll={false}>Previous</Link>}{first+PAGE<table.rows.length && <Link href={`?from=${table.key}:${first+PAGE}`} scroll={false}>Next</Link>}</span></nav>}
        </details>;
      })}
      {!!layout.empty?.length && <details className="hint pf-empty"><summary>Nothing in the other {layout.empty.length} tables</summary><p>{layout.empty.join(", ")}.</p></details>}
    </div>}
  </FormStamp>;
}
