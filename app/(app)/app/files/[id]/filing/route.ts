import {createHash,randomBytes,randomUUID} from "node:crypto";
import {z} from "zod";
import {visibleForm} from "@/src/lib/prepared";
import {supabaseAdmin} from "@/src/lib/supabase";
import {openDrive} from "@/src/lib/drive-account";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const origin=new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if(request.headers.get("origin")!==origin) return new Response("Not allowed",{status:403});
  const {id}=await params,{document,membership,userId}=await visibleForm(id),admin=supabaseAdmin();
  const {data:ready,error}=await admin.rpc("form_ready",{target:id});
  if(error || !ready) return Response.redirect(new URL(`/app/clients/${document.client_id}?tab=outputs&form=check`,origin),303);
  const token=randomBytes(32).toString("base64url"),ticket=randomUUID();
  const {error:failed}=await admin.from("requests").insert({id:ticket,firm_id:membership.firmId,client_id:document.client_id,kind:"filing_download",entity_type:"document",entity_id:id,expires_at:new Date(Date.now()+60_000).toISOString(),details:{by:userId,token_hash:createHash("sha256").update(token).digest("hex")}});
  if(failed) return new Response("The filing file could not be opened. Try again.",{status:503});
  const url=new URL(`/app/files/${id}/filing`,origin);
  url.search=new URLSearchParams({ticket,key:token}).toString();
  return new Response(null,{status:303,headers:{Location:url.toString(),"Cache-Control":"private, no-store"}});
}

// The image viewer never exposes this route. Each permitted download gets one short link.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params,{document,membership,userId}=await visibleForm(id),url=new URL(request.url);
  const ticket=z.uuid().safeParse(url.searchParams.get("ticket")),key=url.searchParams.get("key") ?? "";
  const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
  if(!ticket.success || !/^[A-Za-z0-9_-]{43}$/.test(key)) return new Response("This filing link has ended. Open the form to get another.",{status:410,headers});
  const admin=supabaseAdmin();
  // Check the ticket's document before consuming it, including when another visible id is supplied.
  const {data:bound}=await admin.from("requests").select("id").eq("firm_id",membership.firmId).eq("id",ticket.data).eq("entity_id",id).eq("kind","filing_download").maybeSingle();
  if(!bound) return new Response("Not found",{status:404,headers});
  const [{data:file},{data:account}]=await Promise.all([
    admin.from("documents").select("drive_file_id").eq("firm_id",membership.firmId).eq("id",id).single(),
    admin.from("connected_accounts").select("id,provider,credentials_enc").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle(),
  ]);
  if(!file || !account) return new Response("The firm's drive is not connected.",{status:409,headers});
  const {data:allowed,error}=await admin.rpc("take_form_download",{ticket:ticket.data,person:userId,token_hash:createHash("sha256").update(key).digest("hex")});
  if(error || allowed!==id) return new Response("This filing link has ended, or the figures need checking again.",{status:410,headers});
  const bytes=await (await openDrive(membership.firmId,account)).read(file.drive_file_id);
  return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`}});
}
