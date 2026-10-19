import { createServer } from "node:http";
import { once } from "node:events";
import { handle } from "./handler.ts";

// No .env.local loader: this process never needs the app's database credentials.
createServer(async (incoming, outgoing) => {
  const stop = new AbortController();
  outgoing.on("close", () => stop.abort());
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 16_384) { outgoing.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const request = new Request(`http://worker${incoming.url}`, { method: incoming.method, headers: { authorization: incoming.headers.authorization ?? "" }, body: incoming.method === "POST" ? Buffer.concat(chunks) : undefined, signal: stop.signal });
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      reader = response.body.getReader();
      for (;;) {
        stop.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (!outgoing.write(value)) await once(outgoing, "drain", { signal: stop.signal });
      }
    }
    outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.destroy();
  } finally { await reader?.cancel().catch(() => {}); }
}).listen(Number(process.env.FILE_WORKER_PORT || 3101), "127.0.0.1", () => console.log("File worker ready"));
