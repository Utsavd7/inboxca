import { currentMember } from "@/src/lib/member";
import { serverCrypto } from "@/src/lib/crypto";
import { dropboxAccessToken } from "@/src/lib/dropbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import { signView, viewerLabel, viewLimits, type ViewRequest } from "@/src/lib/file-worker";

// Every opening checks the person's access before the worker sees a drive token.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  const { id } = await params;
  const sheet=new URL(request.url).searchParams.get("sheet");
  if(sheet!==null && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(sheet)) return new Response("Not found",{status:404});
  if (!membership) return new Response("Not found", { status: 404 });
  const { data: visible } = await supabase.from("documents").select("id, size").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!visible) return new Response("Not found", { status: 404 });
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
    const view: ViewRequest = { firm: membership.firmId, file: document.drive_file_id, name: document.name, label: viewerLabel(membership.email, membership.firmName), limit: viewLimits.pages, expires: Math.floor(Date.now() / 1000) + 60, ...(sheet && {sheet:Number(sheet)}), provider: account.provider as ViewRequest["provider"], token: credentials ? await dropboxAccessToken(credentials.refreshToken) : "" };
    const body = JSON.stringify(view);
    const response = await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/, "")}/view/${encodeURIComponent(view.file)}`, {
      method: "POST", headers: { Authorization: await signView(body, process.env.FILE_WORKER_SECRET), "Content-Type": "application/json" }, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]), cache: "no-store",
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Worker refused"); }
    const { error } = await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.viewed", entity_type: "document", entity_id: id });
    if (error) { await response.body.cancel(); throw error; }
    // Do not collect the body. Cancellation and backpressure reach the worker through fetch.
    return new Response(response.body, { headers: { ...headers, "Content-Type": "application/x-inboxca-pages" } });
  } catch { return new Response("This file could not be opened.", { status: 422, headers }); }
}
