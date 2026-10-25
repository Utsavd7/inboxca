import { openDrive } from "@/src/lib/drive-account";
import { zip } from "@/src/lib/firm-download";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// Papers chosen on Documents, read from the firm's drive into one ZIP. As for one paper
// (../[id]/route.ts), only the owner may read originals, and never a prepared form; each
// paper's download is logged.
export async function GET(request: Request) {
  const { supabase, userId, membership } = await currentMember();
  const ids = [...new Set(new URL(request.url).searchParams.getAll("pick"))].filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (!membership || membership.role !== "owner" || !ids.length || ids.length > 50) return new Response("Not found", { status: 404 });
  const { data: visible } = await supabase.from("documents").select("id, name, prepared, size").eq("firm_id", membership.firmId).in("id", ids).neq("status", "deleted");
  const papers = visible?.filter((paper) => !paper.prepared) ?? [];
  if (!papers.length) return new Response("Not found", { status: 404 });
  // The ZIP is built in the server's memory, so one holds at most 200 MB of papers.
  if (papers.reduce((sum, paper) => sum + (paper.size ?? 0), 0) > 200 * 1024 * 1024) return new Response("Choose fewer papers: one ZIP holds up to 200 MB.", { status: 413 });
  const admin = supabaseAdmin();
  const [{ data: files }, { data: account }] = await Promise.all([
    admin.from("documents").select("id, drive_file_id").in("id", papers.map((paper) => paper.id)),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
  ]);
  if (!account) return new Response("The firm's drive is not connected.", { status: 409 });
  const drive = await openDrive(membership.firmId, account);
  const place = new Map(files?.map((file) => [file.id, file.drive_file_id]));
  // Two papers of the same name keep both, the second as "name (2).pdf".
  const taken = new Map<string, number>();
  const entries = [];
  for (const paper of papers) {
    const safe = paper.name.replace(/[\\/:*?"<>|]/g, "-");
    const seen = (taken.get(safe.toLowerCase()) ?? 0) + 1;
    taken.set(safe.toLowerCase(), seen);
    entries.push({ name: seen > 1 ? safe.replace(/(\.[^.]*)?$/, ` (${seen})$1`) : safe, text: new Uint8Array(await drive.read(place.get(paper.id) ?? "")) });
  }
  await admin.from("activity_log").insert(papers.map((paper) => ({ firm_id: membership.firmId, actor_id: userId, action: "document.downloaded", entity_type: "document", entity_id: paper.id, details: { zip: true } })));
  return new Response(new Blob([new Uint8Array(zip(entries))]), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="InboxCA papers.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
