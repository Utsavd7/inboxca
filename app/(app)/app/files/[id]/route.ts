import { openDrive } from "@/src/lib/drive-account";
import { currentMember } from "@/src/lib/member";
import { plainPage } from "@/src/lib/plain-page";
import { supabaseAdmin } from "@/src/lib/supabase";

// Kinds a browser shows safely; anything else (a web page or a script above all) is only
// ever downloaded, so a file a client sends can never run on InboxCA's own address.
const shown: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8" };
// Only the owner may read the original. The viewer has a separate image stream.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  const { id } = await params;
  const { data: visible } = await supabase.from("documents").select("id, name, prepared").eq("firm_id",membership?.firmId ?? "00000000-0000-0000-0000-000000000000").eq("id", id).neq("status", "deleted").maybeSingle();
  const extension = visible?.name.split(".").pop()?.toLowerCase() ?? "";
  if (!membership || !visible || visible.prepared || membership.role !== "owner") return plainPage(404, "This paper is not available. It may have been removed, or only the owner can download it.", "/app/documents", "Go to Documents");
  const admin = supabaseAdmin();
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("id", id).single(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document || !account) return plainPage(409, "Your firm's drive is not connected. Connect it in Settings, then try again.", "/app/settings?group=email#drive", "Go to Settings");
  const bytes = await openDrive(membership.firmId, account).then((drive) => drive.read(document.drive_file_id)).catch(() => null);
  if (!bytes) return plainPage(503, "InboxCA could not read this paper from your firm's drive just now. Try again in a minute.", `/app/files/${id}/view`, "Go back to the paper");
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "document.downloaded", entity_type: "document", entity_id: id });
  const type = shown[extension];
  return new Response(new Blob([new Uint8Array(bytes)]), {
    headers: {
      "Content-Type": type ?? "application/octet-stream",
      "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
