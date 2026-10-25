import { parsePath } from "@/src/lib/drive-browse";
import { browseContext, cameFrom, listing } from "./data";

// The folder view's reads: one folder of the firm's drive (?path=, ?cursor= for its next
// page), or where one paper came from (?paper=). Read live from the drive on the server with
// the firm's stored sign in; the browser gets only what the person may see.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const search = new URL(request.url).searchParams;
  const ctx = await browseContext();
  if (!ctx) return new Response("Not found", { status: 404, headers });
  const paper = search.get("paper");
  if (paper) {
    const from = /^[0-9a-f-]{36}$/.test(paper) ? await cameFrom(ctx, paper) : null;
    return from ? Response.json({ from }, { headers }) : new Response("Not found", { status: 404, headers });
  }
  const parts = parsePath(search.get("path"));
  if (!parts) return new Response("Not found", { status: 404, headers });
  try {
    const found = await listing(ctx, parts, search.get("cursor") ?? undefined);
    return found ? Response.json(found, { headers }) : new Response("Not found", { status: 404, headers });
  } catch {
    return new Response("The drive could not be read just now.", { status: 502, headers });
  }
}
