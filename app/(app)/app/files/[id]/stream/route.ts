import { currentMember, currentWriter } from "@/src/lib/member";
import {grantFor} from "@/src/lib/permission-grants";
import { serverCrypto } from "@/src/lib/crypto";
import { dropboxAccessToken } from "@/src/lib/dropbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import { signView, viewerLabel, viewLimits, type ViewRequest } from "@/src/lib/file-worker";

// Every opening checks the person's access before the worker sees a drive token.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const copy=request.method==="POST";
  if(copy && request.headers.get("origin")!==new URL(process.env.APP_BASE_URL ?? request.url).origin) return new Response("Not allowed",{status:403});
  const { supabase, userId, membership } = copy ? await currentWriter() : await currentMember();
  const { id } = await params;
  const sheet=new URL(request.url).searchParams.get("sheet");
  if(sheet!==null && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(sheet)) return new Response("Not found",{status:404});
  if (!membership) return new Response("Not found", { status: 404 });
  const { data: visible } = await supabase.from("documents").select("id, size, client_id, prepared").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!visible) return new Response("Not found", { status: 404 });
  const permission=copy && !membership.may("download",visible.client_id) ? await grantFor(membership.firmId,userId,"download",visible.client_id,id) : null;
  if(copy && (visible.prepared || !membership.may("download",visible.client_id) && !permission)) return new Response("Ask to download this file first.",{status:403});
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  if (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) return new Response("Documents cannot be shown yet.", { status: 503, headers });
  if (visible.size > viewLimits.bytes) return new Response("This file is too large to show here.", { status: 413, headers });
  const admin = supabaseAdmin();
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document) return new Response("Not found", { status: 404, headers });
  if (!account) return new Response("The firm's drive is not connected.", { status: 409, headers });
  try {
    if (!["local", "dropbox"].includes(account.provider)) throw new Error("Drive not supported");
    const credentials = account.provider === "local" ? null : JSON.parse(await serverCrypto().decrypt(membership.firmId, `accounts/${account.id}/credentials`, account.credentials_enc));
    const view: ViewRequest = { firm: membership.firmId, file: document.drive_file_id, name: document.name, label: viewerLabel(membership.email, membership.firmName), limit: viewLimits.pages, expires: Math.floor(Date.now() / 1000) + 60, ...(sheet && {sheet:Number(sheet)}), ...(copy && {purpose:"copy" as const}), provider: account.provider as ViewRequest["provider"], token: credentials ? await dropboxAccessToken(credentials.refreshToken) : "" };
    const body = JSON.stringify(view);
    const response = await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/, "")}/${copy ? "copy" : "view"}/${encodeURIComponent(view.file)}`, {
      method: "POST", headers: { Authorization: await signView(body, process.env.FILE_WORKER_SECRET), "Content-Type": "application/json" }, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]), cache: "no-store",
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Worker refused"); }
    if(permission) {
      const {data:spent,error}=await admin.from("requests").update({status:"used"}).eq("id",permission).eq("firm_id",membership.firmId).eq("status","approved").gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
      if(error || !spent) {await response.body.cancel();return new Response("Ask for permission again.",{status:403,headers});}
    }
    const { error } = await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: copy ? "document.downloaded" : "document.viewed", entity_type: "document", entity_id: id, ...(copy && {details:{stamped:true,limit:viewLimits.pages,...(sheet && {sheet:Number(sheet)}),permission}}) });
    if (error) { await response.body.cancel(); throw error; }
    // Do not collect the body. Cancellation and backpressure reach the worker through fetch.
    return new Response(response.body, { headers: { ...headers, "Content-Type": copy ? "application/pdf" : "application/x-inboxca-pages", ...(copy && {"Content-Disposition":"attachment; filename=\"document-pages.pdf\""}) } });
  } catch { return new Response("This file could not be opened.", { status: 422, headers }); }
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}) {return GET(request,context);}
