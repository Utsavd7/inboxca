import {z} from "zod";
import {driveToken} from "./drive-account";
import {signView,type ViewRequest} from "./file-worker";
import {officialLink} from "./official-files";
import {supabaseAdmin} from "./supabase";

const rows=z.array(z.array(z.string().max(2000)).max(26)).max(1000);
const result=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),rows,sheet:z.number().int().min(1).max(40).default(1),more:z.array(z.object({sheet:z.number().int().min(2).max(40),rows})).max(39).default([])});
// Called only after a document access check, or from its firm's document job.
export async function workerRead(firm:string,document:{id:string;name:string;sha256:string},purpose:"sheet"|"portal"|"edited",form?:ViewRequest["form"],password?:string) {
  if(!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) throw new Error("The file reader is not ready yet.");
  const admin=supabaseAdmin();
  const [{data:account},{data:file}]=await Promise.all([
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",firm).eq("kind","drive").maybeSingle(),
    admin.from("documents").select("drive_file_id").eq("firm_id",firm).eq("id",document.id).eq("sha256",document.sha256).eq("status","filed").maybeSingle(),
  ]);
  if(!file) throw new Error("The paper changed or is not available.");
  if(!account || !["local","dropbox","onedrive"].includes(account.provider)) throw new Error("Connect the firm's drive first.");
  const view:ViewRequest={firm,file:file.drive_file_id,name:document.name,label:"Read client file",limit:30,expires:Math.floor(Date.now()/1000)+60,provider:account.provider as ViewRequest["provider"],token:await driveToken(firm,account),purpose,...(form && {form:{...form,official:await officialLink(form.template.source)}}),...(password && {password})};
  const body=JSON.stringify(view);
  const response=await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/,"")}/${purpose}/${encodeURIComponent(view.file)}`,{method:"POST",headers:{Authorization:await signView(body,process.env.FILE_WORKER_SECRET),"Content-Type":"application/json"},body,signal:AbortSignal.timeout(120_000),cache:"no-store"});
  if(!response.ok) throw new Error("The file could not be read. Check its size and layout.");
  const parsed=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough().parse(await response.json());
  if(parsed.sha256!==document.sha256) throw new Error("The paper changed. Add the latest file before reading it again.");
  return parsed;
}
// The register's sheet, and the workbook's other sheets with a register's official headings.
export async function workerSheets(firm:string,document:{id:string;name:string;sha256:string}) {return result.parse(await workerRead(firm,document,"sheet"));}
export async function workerSheet(firm:string,document:{id:string;name:string;sha256:string}) {return (await workerSheets(firm,document)).rows;}
