import { linkAllowed, officialStore } from "@/src/lib/official-files";

// A stored official file for the file worker, only with the link the app signed into the
// worker's request. The server's own client reads the store: nobody signs in here, and only
// the server reads the store. The worker checks the hash again before using it.
export async function GET(request: Request, { params }: { params: Promise<{ sha256: string }> }) {
  const { sha256 } = await params, url = new URL(request.url);
  if (!await linkAllowed(sha256, url.searchParams.get("until"), url.searchParams.get("sig"))) return new Response("Not allowed", { status: 403 });
  const bytes = await officialStore().read(sha256);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
}
