import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { logDownloads, mayDownload, PAUSED } from "@/src/lib/download-use";
import { openDrive } from "@/src/lib/drive-account";
import { openCookie, opens } from "@/src/lib/share-codes";
import { plainPage } from "@/src/lib/plain-page";
import { supabaseAdmin } from "@/src/lib/supabase";

// One download of a document the firm sent, through its secure link (PLAN.md 8.6): counted
// first, so a link stops after 5 downloads or 7 days; always downloaded, never shown on
// InboxCA's address. Each download is logged.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = supabaseAdmin();
  const back = (status: number, words: string) => plainPage(status, words, `/s/${encodeURIComponent(token)}`, "Go back to the page");
  const hash = createHash("sha256").update(token).digest("hex");
  // A private paper downloads only in a browser that entered its one-time code.
  const { data: locked } = await admin.from("shares").select("id, firm_id, needs_code").eq("link_token_hash", hash).maybeSingle();
  if (locked?.needs_code && !opens(locked.id, (await cookies()).get(openCookie(locked.id).name)?.value)) return back(403, "This paper is private. Enter the code from your email first.");
  // Past the firm's downloads this month the link waits, with none of its downloads used.
  if (locked && !(await mayDownload(locked.firm_id))) return back(429, PAUSED.client);
  const { data: used } = await admin.rpc("use_share", { token_hash: hash });
  const share = used?.[0];
  if (!share) return back(410, "This link has ended, or all its downloads have been used. Ask your CA's office to send the paper again.");
  const [{ data: document }, { data: account }] = await Promise.all([
    admin.from("documents").select("drive_file_id, name").eq("id", share.document_id).neq("status", "deleted").maybeSingle(),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", share.firm_id).eq("kind", "drive").maybeSingle(),
  ]);
  if (!document || !account) return back(410, "This paper is no longer available. Ask your CA's office to send it again.");
  const bytes = await openDrive(share.firm_id, account).then((drive) => drive.read(document.drive_file_id)).catch(() => null);
  if (!bytes) return back(503, "This paper could not be opened just now. Try again in a minute.");
  if (!(await logDownloads(share.firm_id, [{ action: "document.downloaded_by_client", entity_id: share.document_id }]))) return back(429, PAUSED.client);
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
