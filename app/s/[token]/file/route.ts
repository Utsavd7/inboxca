import { createHash } from "node:crypto";
import { openDrive } from "@/src/lib/drive-account";
import { supabaseAdmin } from "@/src/lib/supabase";

// One download of a document the firm sent, through its secure link (PLAN.md 8.6): counted
// first, so a link stops after 5 downloads or 7 days; always downloaded, never shown on
// InboxCA's address. Each download is logged.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = supabaseAdmin();
  const { data: used } = await admin.rpc("use_share", { token_hash: createHash("sha256").update(token).digest("hex") });
  const share = used?.[0];
  if (!share) return new Response("This link has expired or has been used up.", { status: 410 });
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("id", share.document_id).neq("status", "deleted").maybeSingle(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", share.firm_id).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document || !account) return new Response("This document is no longer available.", { status: 410 });
  const bytes = await (await openDrive(share.firm_id, account)).read(document.drive_file_id);
  await admin.from("activity_log").insert({ firm_id: share.firm_id, action: "document.downloaded_by_client", entity_type: "document", entity_id: share.document_id });
  return new Response(new Blob([new Uint8Array(bytes)]), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
