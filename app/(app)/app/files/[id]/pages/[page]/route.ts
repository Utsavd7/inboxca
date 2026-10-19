import { currentMember } from "@/src/lib/member";
import { openDrive } from "@/src/lib/drive-account";
import { supabaseAdmin } from "@/src/lib/supabase";
import { renderPage, viewerLabel, viewLimits } from "@/src/lib/viewer";

export const runtime = "nodejs";

// Check the person's access before reading from the drive. Only stamped pixels leave here.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  const { id, page } = await params;
  if (!membership || !/^\d{1,2}$/.test(page)) return new Response("Not found", { status: 404 });
  const { data: visible } = await supabase.from("documents").select("id, size").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle();
  if (!visible) return new Response("Not found", { status: 404 });
  if (visible.size > viewLimits.bytes) return new Response("This file is too large to show here.", { status: 413 });
  const admin = supabaseAdmin();
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("firm_id", membership.firmId).eq("id", id).neq("status", "deleted").maybeSingle(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document) return new Response("Not found", { status: 404 });
  if (!account) return new Response("The firm's drive is not connected.", { status: 409 });
  try {
    const original = await (await openDrive(membership.firmId, account)).read(document.drive_file_id);
    const image = await renderPage(Buffer.from(original), document.name, Number(page), viewerLabel(membership.email, membership.firmName));
    await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.viewed", entity_type: "document", entity_id: id });
    return new Response(new Uint8Array(image.bytes), { headers: {
      "Content-Type": "image/png", "Cache-Control": "private, no-store", Vary: "Cookie",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
      "X-InboxCA-Pages": String(image.count), "X-InboxCA-Limited": String(image.limited),
      "X-InboxCA-Width": String(image.width), "X-InboxCA-Height": String(image.height),
    } });
  } catch {
    return new Response("This page could not be opened.", { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}
