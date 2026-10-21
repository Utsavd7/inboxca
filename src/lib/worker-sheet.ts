import {z} from "zod";
import {serverCrypto} from "./crypto";
import {dropboxAccessToken} from "./dropbox";
import {signView,type ViewRequest} from "./file-worker";
import {supabaseAdmin} from "./supabase";

const result=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(z.array(z.string().max(2000)).max(26)).max(1000)});
// Called only after a document access check, or from its firm's document job.
export async function workerSheet(firm:string,document:{id:string;name:string;sha256:string}) {
  if(!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) throw new Error("The file reader is not ready yet.");
  const admin=supabaseAdmin();
  const [{data:account},{data:file}]=await Promise.all([
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",firm).eq("kind","drive").maybeSingle(),
    admin.from("documents").select("drive_file_id").eq("firm_id",firm).eq("id",document.id).eq("sha256",document.sha256).eq("status","filed").maybeSingle(),
  ]);
  if(!file) throw new Error("The source changed or is not available.");
  if(!account || !["local","dropbox"].includes(account.provider)) throw new Error("Connect the firm's drive first.");
  const credentials=account.provider==="local" ? null : JSON.parse(await serverCrypto().decrypt(firm,`accounts/${account.id}/credentials`,account.credentials_enc));
  const view:ViewRequest={firm,file:file.drive_file_id,name:document.name,label:"Read sales register",limit:30,expires:Math.floor(Date.now()/1000)+60,provider:account.provider as ViewRequest["provider"],token:credentials ? await dropboxAccessToken(credentials.refreshToken) : "",purpose:"sheet"};
  const body=JSON.stringify(view);
  const response=await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/,"")}/sheet/${encodeURIComponent(view.file)}`,{method:"POST",headers:{Authorization:await signView(body,process.env.FILE_WORKER_SECRET),"Content-Type":"application/json"},body,signal:AbortSignal.timeout(120_000),cache:"no-store"});
  if(!response.ok) throw new Error("The register could not be read. Use the first sheet, with up to 1,000 rows and 26 columns.");
  const parsed=result.parse(await response.json());
  if(parsed.sha256!==document.sha256) throw new Error("The source changed. Add the latest file before reading it again.");
  return parsed.rows;
}
