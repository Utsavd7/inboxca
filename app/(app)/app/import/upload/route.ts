import { INCOMING, incomingPath, localDrive } from "@/src/lib/drive";
import { currentWriter } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

// The owner's browser posts here (PLAN.md 5.16). With no path the bytes are only counted:
// the quick test of the office line's upload speed. With a path, one file is saved under
// Incoming, for the test drive only, which is on this server; a real drive takes the file
// from the browser itself, through the drive's own one-time link.
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response(null, { status: 403 });
  const { membership } = await currentWriter();
  if (membership?.role !== "owner" || Number(request.headers.get("content-length")) > 150 * 1024 * 1024) return new Response(null, { status: 403 });
  const relative = incomingPath(new URL(request.url).searchParams.get("path") ?? "");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 150 * 1024 * 1024) return new Response(null, { status: 403 });
  if (!relative) return new Response(null, { status: 204 });
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("provider").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle();
  if (account?.provider !== "local") return new Response(null, { status: 404 });
  const drive = localDrive();
  const parts = relative.split("/");
  const saved = await drive.save(await drive.ensureFolder([INCOMING, ...parts.slice(0, -1)]), parts[parts.length - 1], bytes);
  return new Response(null, { status: saved === "taken" ? 409 : 201 });
}
