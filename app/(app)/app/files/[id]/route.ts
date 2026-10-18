import { openDrive } from "@/src/lib/drive-account";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// Kinds a browser shows safely; anything else (a web page or a script above all) is only
// ever downloaded, so a file a client sends can never run on InboxCA's own address.
const shown: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8" };

// A filed document, read from the firm's drive through InboxCA's server (PLAN.md 5.5.1).
// For now only the owner opens files; the view-only viewer with a watermark for everyone
// else comes with the file viewer (M4). The document is found through the person's own
// access first, so a client they may not see stays hidden.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, membership } = await currentMember();
  const { id } = await params;
  const { data: visible } = await supabase.from("documents").select("id").eq("id", id).maybeSingle();
  if (membership?.role !== "owner" || !visible) return new Response("Not found", { status: 404 });
  const admin = supabaseAdmin();
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("id", id).single(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document || !account) return new Response("The firm's drive is not connected.", { status: 409 });
  const bytes = await (await openDrive(membership.firmId, account)).read(document.drive_file_id);
  const type = shown[document.name.split(".").pop()?.toLowerCase() ?? ""];
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
