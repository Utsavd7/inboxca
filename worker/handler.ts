import { localDrive } from "../src/lib/drive.ts";
import { frameSize, verifyView, viewLimits, type ViewRequest } from "../src/lib/file-worker.ts";
import { openView } from "./render.ts";

// Only test runs keep read counts, never file contents or credentials.
const reads = new Map<string, number>();
async function original(view: ViewRequest, signal: AbortSignal) {
  if (view.provider === "local") {
    if (!process.env.DRIVE_LOCAL_DIR) throw new Error("No local drive");
    return localDrive(process.env.DRIVE_LOCAL_DIR, (id) => { if (process.env.FILE_WORKER_TEST === "1") reads.set(id, (reads.get(id) ?? 0) + 1); }, viewLimits.bytes).read(view.file);
  }
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST", signal, headers: { Authorization: `Bearer ${view.token}`, "Dropbox-API-Arg": JSON.stringify({ path: view.file }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) },
  });
  if (!response.ok || Number(response.headers.get("Content-Length")) > viewLimits.bytes || !response.body) throw new Error("Cannot read file");
  // A fixed bounded buffer avoids joining a second original copy or trusting a size header.
  const length = Number(response.headers.get("Content-Length"));
  const bytes = new Uint8Array(Number.isSafeInteger(length) && length > 0 ? length : viewLimits.bytes);
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (size + value.length > bytes.length) throw new Error("File too large");
      bytes.set(value, size);
      size += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
}

// The same Request/Response handler can be wrapped by Lambda's response streaming adapter.
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return new Response("Ready");
  const secret = process.env.FILE_WORKER_SECRET ?? "";
  if (process.env.FILE_WORKER_TEST === "1" && request.method === "GET" && url.pathname === "/_reads" && secret && request.headers.get("authorization") === `Bearer ${secret}`)
    return Response.json({ reads: reads.get(url.searchParams.get("file") ?? "") ?? 0, peakRssKiB: process.resourceUsage().maxRSS });
  if (request.method !== "POST" || !url.pathname.startsWith("/view/")) return new Response("Not found", { status: 404 });
  let view: ViewRequest;
  try { view = await verifyView(await request.text(), request.headers.get("authorization") ?? "", secret, decodeURIComponent(url.pathname.slice(6))); }
  catch { return new Response("Not allowed", { status: 403 }); }
  try {
    request.signal.throwIfAborted();
    const data = await original(view, request.signal);
    const opened = await openView(Buffer.from(data.buffer, data.byteOffset, data.byteLength), view.name, view.label, view.limit, request.signal);
    let disposed = false;
    const dispose = async () => { if (!disposed) { disposed = true; await opened.dispose(); } };
    async function* frames() {
      try {
        const header = new TextEncoder().encode(JSON.stringify(opened.header));
        yield frameSize(header); yield header;
        for (let number = 1; number <= opened.header.pages.length; number++) {
          request.signal.throwIfAborted();
          const image = await opened.render(number);
          yield frameSize(image); yield image;
        }
      } finally { await dispose(); }
    }
    const iterator = frames();
    return new Response(new ReadableStream({
      async pull(controller) {
        try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
        catch (error) { controller.error(error); await iterator.return(undefined); }
      },
      async cancel() { await iterator.return(undefined); await dispose(); },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/x-inboxca-pages", "Cache-Control": "private, no-store" } });
  } catch { return new Response("This file could not be opened.", { status: 422 }); }
}
