import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker, OEM } from "tesseract.js";
import { ocrLimits, verifyIntake } from "../src/lib/file-worker.ts";
import { pictureSize } from "./render.ts";

// Tesseract, a non-generative open source engine, reads English only (PLAN.md 5.5.0, 26 Oct
// 2026) with tessdata_best's integer model kept in worker/tessdata, so nothing is fetched.
const engine = `tesseract.js ${createRequire(import.meta.url)("tesseract.js/package.json").version}`, languages = ["eng"];
let turn: Promise<unknown> = Promise.resolve();

// One-time OCR of a scan or a picture (PLAN.md 5.5.0, D29). The app sends the file and then a
// locked PDF's password, with a signed ticket naming their size and checksum, the PDF pages
// without text and the password's length. A picture larger than the limit is refused by its
// header, before it is decoded. The answer is each page's text and the mean confidence;
// nothing is kept or logged. One file at a time, within the time limit.
export async function ocr(request: Request, secret: string) {
  let ticket: Awaited<ReturnType<typeof verifyIntake>> & { pages?: number[]; password?: number };
  try {
    ticket = await verifyIntake(request.headers.get("x-inboxca-intake") ?? "", request.headers.get("authorization") ?? "", secret);
    const { pages, password } = ticket;
    if (ticket.zip || !Array.isArray(pages) || pages.length > ocrLimits.pages || !pages.every((page) => Number.isInteger(page) && page >= 1) || !Number.isInteger(password) || password! < 0 || password! > 800) throw new Error("Not allowed");
  } catch { await request.body?.cancel().catch(() => {}); return new Response("Not allowed", { status: 403 }); }
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
  const file = bytes.subarray(0, size - ticket.password!), password = ticket.password ? bytes.subarray(size - ticket.password).toString() : undefined;
  const pdf = file.toString("latin1", 0, 5) === "%PDF-", picture = pdf ? null : pictureSize(file);
  if (!pdf && !picture) return new Response("Not a picture", { status: 415 });
  if (picture && !(picture.width && picture.height && picture.width * picture.height <= ocrLimits.pixels)) return new Response("Picture too large", { status: 413 });
  const run = turn.then(() => read(file, pdf ? ticket.pages! : null, password, request.signal));
  turn = run.catch(() => {});
  try { return Response.json(await run, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return new Response("This file could not be read.", { status: 422 }); }
}

type Page = { text: string; confidence: number };
async function read(file: Buffer, pages: number[] | null, password: string | undefined, signal: AbortSignal) {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(ocrLimits.seconds * 1000)]);
  stop.throwIfAborted();
  const stopped = new Promise<never>((_, reject) => stop.addEventListener("abort", () => reject(new Error("OCR stopped")), { once: true }));
  stopped.catch(() => {});
  // A failed read rejects its own promise; without errorHandler the engine would also throw.
  const starting = createWorker(languages, OEM.LSTM_ONLY, { langPath: join(process.cwd(), "worker/tessdata"), cacheMethod: "none", gzip: true, errorHandler: () => {} });
  try {
    const tesseract = await Promise.race([starting, stopped]);
    const recognise = async (image: Buffer): Promise<Page> => (await Promise.race([tesseract.recognize(image), stopped])).data;
    const found = pages ? await drawn(file, pages, password, stop, recognise) : [await recognise(await upright(file))];
    const worded = found.filter((page) => page.text.trim());
    return { pages: found.map((page) => page.text), confidence: worded.length ? Math.round(worded.reduce((sum, page) => sum + page.confidence, 0) / worded.length) : 0, engine, languages };
  } finally { void starting.then((tesseract) => tesseract.terminate(), () => {}); }
}

// A picture decoded as the viewer does, so a phone photo stands the way its camera says, on white.
async function upright(file: Buffer) {
  const image = await loadImage(file), canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  try { return await canvas.encode("png"); } finally { canvas.width = 1; canvas.height = 1; }
}

// Each page drawn alone at 300 dots an inch, smaller when that passes the pixel limit, which
// pdf.js also applies to the pictures inside it.
async function drawn(file: Buffer, pages: number[], password: string | undefined, stop: AbortSignal, recognise: (image: Buffer) => Promise<Page>) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = join(process.cwd(), "node_modules/pdfjs-dist");
  const task = getDocument({ data: new Uint8Array(file.buffer, file.byteOffset, file.byteLength), password, standardFontDataUrl: join(root, "standard_fonts/"), cMapUrl: join(root, "cmaps/"), cMapPacked: true, wasmUrl: join(root, "wasm/"), maxImageSize: ocrLimits.pixels, verbosity: 0 });
  const canvas = createCanvas(1, 1), found: Page[] = [];
  try {
    const pdf = await task.promise;
    for (const number of pages) {
      stop.throwIfAborted();
      const page = await pdf.getPage(number), { width, height } = page.getViewport({ scale: 1 });
      if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error("Invalid page size");
      const viewport = page.getViewport({ scale: Math.min(300 / 72, Math.sqrt(ocrLimits.pixels / (width * height))) });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      try {
        await page.render({ canvas: null, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
      } finally { page.cleanup(); }
      found.push(await recognise(await canvas.encode("png")));
    }
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    await task.destroy();
  }
  return found;
}
