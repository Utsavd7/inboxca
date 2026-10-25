import { createHash } from "node:crypto";
import { frameSize, intakeLimits, verifyIntake, type IntakeTicket } from "../src/lib/file-worker.ts";
import { scan } from "./scan.ts";
import { Refused, unpack, zipEntries } from "./zip.ts";

// A file a client or the team sends in, checked before InboxCA saves it (PLAN.md 5.15): read
// once into one buffer of the signed size, scanned, and a ZIP opened within its limits. Every
// file in a ZIP is unpacked, checked and scanned before any is sent back, so a ZIP is taken
// whole or not at all; then each is unpacked again and sent one at a time, so the worker
// holds the ZIP and one file. The answer's first frame says what was found; nothing is kept.
export async function intake(request: Request, secret: string) {
  let ticket: IntakeTicket;
  try { ticket = await verifyIntake(request.headers.get("x-inboxca-intake") ?? "", request.headers.get("authorization") ?? "", secret); }
  catch { await request.body?.cancel().catch(() => {}); return new Response("Not allowed", { status: 403 }); }
  const bytes = Buffer.alloc(ticket.size);
  let size = 0;
  const reader = request.body?.getReader();
  try {
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      if (size + next.value.length > bytes.length) throw new Error("Larger than signed");
      bytes.set(next.value, size);
      size += next.value.length;
    }
  } catch { return new Response("Not allowed", { status: 413 }); }
  finally { await reader?.cancel().catch(() => {}); }
  if (size !== ticket.size || createHash("sha256").update(bytes).digest("hex") !== ticket.sha256) return new Response("Not allowed", { status: 400 });
  const said = (value: object) => { const text = new TextEncoder().encode(JSON.stringify(value)); return [frameSize(text), text]; };
  const answer = (parts: AsyncIterable<Uint8Array> | Uint8Array[]) => {
    const iterator = (async function* () { yield* parts; })();
    return new Response(new ReadableStream({
      async pull(controller) {
        try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
        catch (error) { controller.error(error); }
      },
      async cancel() { await iterator.return(undefined); },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/x-inboxca-files", "Cache-Control": "private, no-store" } });
  };
  try {
    const whole = await scan(bytes, request.signal);
    if (typeof whole === "object") return answer(said(whole));
    if (!ticket.zip) return answer(said({ scanned: whole === "clean" }));
    const entries = zipEntries(bytes);
    for (const entry of entries) {
      request.signal.throwIfAborted();
      const verdict = await scan(unpack(entry), request.signal);
      if (typeof verdict === "object") return answer(said(verdict));
    }
    return answer((async function* () {
      yield* said({ scanned: whole === "clean", files: entries.map((entry) => entry.name) });
      for (const entry of entries) {
        const file = unpack(entry);
        yield frameSize(file, intakeLimits.bytes);
        yield file;
      }
    })());
  } catch (error) {
    if (error instanceof Refused) return answer(said({ refused: error.message }));
    return new Response("The file could not be checked.", { status: 503 });
  }
}
