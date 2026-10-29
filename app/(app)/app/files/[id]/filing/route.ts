import {createHash,randomBytes,randomUUID} from "node:crypto";
import {z} from "zod";
import {portalJson,visibleForm} from "@/src/lib/prepared";
import {supabaseAdmin} from "@/src/lib/supabase";
import {openDrive} from "@/src/lib/drive-account";
import {plainPage} from "@/src/lib/plain-page";

// A failure is a page in plain words with the way back to the client's return files.
const refuse=(status:number,words:string,client?:string)=>plainPage(status,words,client ? `/app/clients/${client}?tab=outputs` : "/app",client ? "Go back to the return files" : "Go to Today",{"Referrer-Policy":"no-referrer"});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const origin=new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if(request.headers.get("origin")!==origin) return refuse(403,"This download could not start. Go back to the return and try again.");
  const {id}=await params,form=await visibleForm(id).catch(()=>null);
  if(!form) return refuse(404,"This return file is not available.");
  const {document,membership,userId}=form,admin=supabaseAdmin();
  const {data:ready,error}=await admin.rpc("form_ready",{target:id});
  if(error || !ready) return Response.redirect(new URL(`/app/clients/${document.client_id}?tab=outputs&form=check`,origin),303);
  const token=randomBytes(32).toString("base64url"),ticket=randomUUID();
  const {error:failed}=await admin.from("requests").insert({id:ticket,firm_id:membership.firmId,client_id:document.client_id,kind:"filing_download",entity_type:"document",entity_id:id,expires_at:new Date(Date.now()+60_000).toISOString(),details:{by:userId,token_hash:createHash("sha256").update(token).digest("hex")}});
  if(failed) return refuse(503,"The return file could not be opened. Go back and try again.",document.client_id);
  const url=new URL(`/app/files/${id}/filing`,origin),excel=(await request.formData().catch(()=>null))?.get("format")==="excel";
  url.search=new URLSearchParams({ticket,key:token,...(excel && {format:"excel"})}).toString();
  return new Response(null,{status:303,headers:{Location:url.toString(),"Cache-Control":"private, no-store"}});
}

// The image viewer never exposes this route. Each permitted download gets one short link.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params,form=await visibleForm(id).catch(()=>null),url=new URL(request.url);
  if(!form) return refuse(404,"This return file is not available.");
  const {document,membership,userId}=form;
  const ticket=z.uuid().safeParse(url.searchParams.get("ticket")),key=url.searchParams.get("key") ?? "";
  const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
  if(!ticket.success || !/^[A-Za-z0-9_-]{43}$/.test(key)) return refuse(410,"This download link has ended. Go back to the return and download it again.",document.client_id);
  const admin=supabaseAdmin();
  // Check the ticket's document before consuming it, including when another visible id is supplied.
  const {data:bound}=await admin.from("requests").select("id").eq("firm_id",membership.firmId).eq("id",ticket.data).eq("entity_id",id).eq("kind","filing_download").maybeSingle();
  if(!bound) return refuse(404,"This return file is not available.",document.client_id);
  const [{data:file},{data:account}]=await Promise.all([
    admin.from("documents").select("drive_file_id").eq("firm_id",membership.firmId).eq("id",id).single(),
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle(),
  ]);
  if(!file || !account) return refuse(409,"Your firm's drive is not connected. Ask the owner to connect it in Settings.",document.client_id);
  // GSTR-1 downloads its portal JSON, made before the ticket is spent; its workbook is the Excel for the offline tool.
  const portal=document.prepared.form==="GSTR1" && url.searchParams.get("format")!=="excel" ? await portalJson(form).catch((failed:unknown)=>failed instanceof Error && failed.name==="Error" ? failed : new Error("The portal file could not be made. Try again in a minute.")) : null;
  if(portal instanceof Error) return refuse(422,portal.message,document.client_id);
  const {data:allowed,error}=await admin.rpc("take_form_download",{ticket:ticket.data,person:userId,token_hash:createHash("sha256").update(key).digest("hex")});
  if(error || allowed!==id) return refuse(410,"This download link has ended, or the figures changed and need checking again. Go back to the return.",document.client_id);
  if(portal) return new Response(portal.bytes,{headers:{...headers,"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.name.replace(/\.xlsx$/i,`.${portal.extension}`))}`}});
  const bytes=await openDrive(membership.firmId,account).then(drive=>drive.read(file.drive_file_id)).catch(()=>null);
  if(!bytes) return refuse(503,"InboxCA could not read the return file from your firm's drive just now. Try again in a minute.",document.client_id);
  return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`}});
}
