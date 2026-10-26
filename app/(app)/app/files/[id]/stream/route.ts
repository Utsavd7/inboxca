import { currentMember, currentWriter } from "@/src/lib/member";
import {grantFor} from "@/src/lib/permission-grants";
import { serverCrypto } from "@/src/lib/crypto";
import { dropboxAccessToken } from "@/src/lib/dropbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import { signView, viewerLabel, viewLimits, type ViewRequest } from "@/src/lib/file-worker";
import { plainPage } from "@/src/lib/plain-page";

// Every opening checks the person's access before the worker sees a drive token.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const copy=request.method==="POST";
  const { id } = await params;
  // The viewer reads its pages with fetch and needs only the status; Download these pages is a
  // form the person sent, so what went wrong is a page in plain words with the way back.
  const fail=(status:number,words:string,headers:Record<string,string>={})=>copy ? plainPage(status,words,`/app/files/${id}/view`,"Go back to the paper",headers) : new Response(words,{status,headers});
  if(copy && request.headers.get("origin")!==new URL(process.env.APP_BASE_URL ?? request.url).origin) return fail(403,"This download could not start. Go back and try again.");
  const { supabase, userId, membership } = copy ? await currentWriter() : await currentMember();
  const sheet=new URL(request.url).searchParams.get("sheet");
  // A thumbnail, the first page of the paper a list shows first, is one page only; it is still
  // logged, marked as a thumbnail, so every page anyone sees has a record.
  const thumb=!copy && sheet===null && new URL(request.url).searchParams.get("thumb")==="1";
  if(sheet!==null && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(sheet)) return new Response("Not found",{status:404});
  if (!membership) return fail(404,"This paper is not available. It may have been removed.");
  const { data: visible } = await supabase.from("documents").select("id, size, client_id, prepared").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!visible) return fail(404,"This paper is not available. It may have been removed.");
  const permission=copy && !membership.may("download",visible.client_id) ? await grantFor(membership.firmId,userId,"download",visible.client_id,id) : null;
  if(copy && (visible.prepared || !membership.may("download",visible.client_id) && !permission)) return fail(403,"You need permission to download this paper. Go back and choose Ask to download.");
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  if (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) return fail(503, "InboxCA cannot show or download papers here yet. Ask the owner for the paper.", headers);
  if (visible.size > viewLimits.bytes) return fail(413, "This file is too large for InboxCA to show or download. Ask the owner for it.", headers);
  const admin = supabaseAdmin();
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name, password_enc").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document) return fail(404, "This paper is not available. It may have been removed.", headers);
  if (!account) return fail(409, "Your firm's drive is not connected. Ask the owner to connect it in Settings.", headers);
  try {
    if (!["local", "dropbox"].includes(account.provider)) throw new Error("Drive not supported");
    const credentials = account.provider === "local" ? null : JSON.parse(await serverCrypto().decrypt(membership.firmId, `accounts/${account.id}/credentials`, account.credentials_enc));
    const view: ViewRequest = { firm: membership.firmId, file: document.drive_file_id, name: document.name, label: viewerLabel(membership.email, membership.firmName), limit: thumb ? 1 : viewLimits.pages, expires: Math.floor(Date.now() / 1000) + 60, ...(sheet && {sheet:Number(sheet)}), ...(copy && {purpose:"copy" as const}), provider: account.provider as ViewRequest["provider"], token: credentials ? await dropboxAccessToken(credentials.refreshToken) : "",
      // A PDF's password, typed once by a person in the viewer, goes only to the worker.
      ...(document.password_enc && { password: await serverCrypto().decrypt(membership.firmId, `documents/${id}/password`, document.password_enc) }) };
    const body = JSON.stringify(view);
    const response = await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/, "")}/${copy ? "copy" : "view"}/${encodeURIComponent(view.file)}`, {
      method: "POST", headers: { Authorization: await signView(body, process.env.FILE_WORKER_SECRET), "Content-Type": "application/json" }, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]), cache: "no-store",
    });
    // A PDF with a password: the viewer asks for it, and nothing is shown or logged as viewed.
    if (response.status === 423) return copy ? fail(423, "This PDF has a password. Open it here, type the password, then download again.", headers) : new Response(await response.text(), { status: 423, headers });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Worker refused"); }
    if(permission) {
      const {data:spent,error}=await admin.from("requests").update({status:"used"}).eq("id",permission).eq("firm_id",membership.firmId).eq("status","approved").gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
      if(error || !spent) {await response.body.cancel();return fail(403,"Your permission to download has ended. Go back and ask again.",headers);}
    }
    const { error } = await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: copy ? "document.downloaded" : "document.viewed", entity_type: "document", entity_id: id, ...(copy && {details:{stamped:true,limit:viewLimits.pages,...(sheet && {sheet:Number(sheet)}),permission}}), ...(thumb && {details:{thumb:true}}) });
    if (error) { await response.body.cancel(); throw error; }
    // Do not collect the body. Cancellation and backpressure reach the worker through fetch.
    return new Response(response.body, { headers: { ...headers, "Content-Type": copy ? "application/pdf" : "application/x-inboxca-pages", ...(copy && {"Content-Disposition":"attachment; filename=\"document-pages.pdf\""}) } });
  } catch { return fail(422, "This file could not be opened. It may have been moved or removed in the drive.", headers); }
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}) {return GET(request,context);}
