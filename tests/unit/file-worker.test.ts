import { expect, it } from "vitest";
import { frameSize, readFrames, signView, verifyView, type ViewRequest } from "@/src/lib/file-worker";

const secret = "invented-test-only-signing-secret";
const view: ViewRequest = { firm: "invented-firm", file: "InboxCA/invented.pdf", name: "invented.pdf", label: "Person, Invented Firm", provider: "local", token: "", limit: 30, expires: 1060 };
const body = JSON.stringify(view);

it("accepts only a valid signed request for this document, within a minute", async () => {
  const mac = await signView(body, secret);
  expect(await verifyView(body, mac, secret, view.file, 1000)).toEqual(view);
  for (const [data, signature, file, now] of [[body, "", view.file, 1000], [body, mac, view.file, 1061], [body, mac, "another.pdf", 1000], [body.replace("Person", "Other"), mac, view.file, 1000], [body, mac, view.file, 900]] as const)
    await expect(verifyView(data, signature, secret, file, now)).rejects.toThrow("Not allowed");
  await expect(verifyView(body, mac, "", view.file, 1000)).rejects.toThrow("Not allowed");
  const tooMany = JSON.stringify({ ...view, limit: 31 });
  await expect(verifyView(tooMany, await signView(tooMany, secret), secret, view.file, 1000)).rejects.toThrow("Not allowed");
  const sheet=JSON.stringify({...view,purpose:"sheet"});
  await expect(verifyView(sheet,await signView(sheet,secret),secret,view.file,1000)).rejects.toThrow("Not allowed");
  expect((await verifyView(sheet,await signView(sheet,secret),secret,view.file,1000,"sheet")).purpose).toBe("sheet");
  await expect(verifyView(body,mac,secret,view.file,1000,"sheet")).rejects.toThrow("Not allowed");
});

it("reads length prefixed frames across arbitrary network chunk boundaries", async () => {
  const header = new TextEncoder().encode('{"pages":[{"width":12,"height":20}],"limited":false}');
  const image = Uint8Array.of(1, 137, 80, 78, 71);
  const bytes = Uint8Array.from([...frameSize(header), ...header, ...frameSize(image), ...image]);
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const seen = [];
  for await (const frame of readFrames(stream)) seen.push([...frame]);
  expect(seen).toEqual([[...header], [...image]]);
});

it("refuses truncated and oversized frames and cancels the producer when reading stops", async () => {
  for (const bytes of [Uint8Array.of(0, 0), Uint8Array.of(0, 0, 0, 2, 1), Uint8Array.of(255, 255, 255, 255), Uint8Array.of(0, 0, 0, 0)]) {
    const read = async () => { for await (const frame of readFrames(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }))) void frame; };
    await expect(read()).rejects.toThrow();
  }
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(0, 0, 0, 1, 2)); }, cancel() { cancelled = true; } });
  for await (const frame of readFrames(stream)) { expect(frame[0]).toBe(2); break; }
  expect(cancelled).toBe(true);
});
