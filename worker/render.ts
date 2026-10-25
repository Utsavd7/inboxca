import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { join } from "node:path";
import { readSheet } from "../src/lib/sheet.ts";
import { viewLimits, type ViewHeader } from "../src/lib/file-worker.ts";
import { jsonSource } from "./json-source.ts";
import { wordSource } from "./word-source.ts";

// A picture's size from its header, read before anything is decoded, so a small file that
// claims to be enormous never reaches the decoder. Null for anything not a known picture.
export function pictureSize(bytes: Buffer): { width: number; height: number } | null {
  const ascii = (start: number, end: number) => bytes.toString("ascii", start, end);
  if (bytes.length >= 24 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const kind = ascii(12, 16);
    if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8L") return { width: 1 + (bytes.readUInt32LE(21) & 0x3fff), height: 1 + ((bytes.readUInt32LE(21) >> 14) & 0x3fff) };
    if (kind === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // JPEG: walk the segments to the frame header, which holds the size.
  for (let at = 2; bytes[0] === 0xff && bytes[1] === 0xd8 && at + 9 < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
  }
  return null;
}

// Tile beyond the rotated page edges too, so crops still show who opened it.
export function tiles(width: number, height: number, textWidth: number, size: number) {
  const reach = Math.hypot(width, height);
  const positions: { x: number; y: number }[] = [];
  for (let row = 0, y = -reach; y < reach; y += size * 7, row++)
    for (let x = -reach - (row % 2) * textWidth / 2; x < reach; x += textWidth + size * 4) positions.push({ x, y });
  return positions;
}

// Parse once, measure pages without rendering, then reuse one canvas for this opening. A PDF
// with a password opens only with the one a person typed; a wrong or missing one throws
// pdf.js's PasswordException, and nothing is ever guessed.
export async function openView(bytes: Buffer, name: string, label: string, limit = viewLimits.pages, signal = new AbortController().signal, sheet?:number, password?:string) {
  signal.throwIfAborted();
  if (bytes.length > viewLimits.bytes) throw new Error("File too large");
  const fit = (width: number, height: number) => {
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error("Invalid page size");
    const scale = Math.min(1200 / width, 1800 / height, 2);
    return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
  };
  let canvas: Canvas | undefined;
  let photograph = false;
  let draw: (number: number) => Promise<Canvas>;
  let dispose = async () => {};
  const header: ViewHeader = { pages: [], limited: false };
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const root = join(process.cwd(), "node_modules/pdfjs-dist");
    // pdf.js owns this backing buffer for the life of the document, without another copy.
    const task = getDocument({ data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), password, standardFontDataUrl: join(root, "standard_fonts/"), cMapUrl: join(root, "cmaps/"), cMapPacked: true, wasmUrl: join(root, "wasm/") });
    dispose = () => task.destroy();
    const stop = () => { void dispose(); };
    signal.addEventListener("abort", stop, { once: true });
    const destroy = dispose;
    dispose = async () => { signal.removeEventListener("abort", stop); await destroy(); };
    try {
      const pdf = await task.promise;
      const count = Math.min(pdf.numPages, limit);
      header.limited = pdf.numPages > count;
      for (let number = 1; number <= count; number++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(number);
        header.pages.push(fit(page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height));
        page.cleanup();
      }
      draw = async (number) => {
        const page = await pdf.getPage(number);
        photograph = !(await page.getTextContent()).items.some((item) => "str" in item && item.str.trim());
        const viewport = page.getViewport({ scale: fit(page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height).scale });
        canvas ??= createCanvas(1, 1);
        canvas.width = header.pages[number - 1].width;
        canvas.height = header.pages[number - 1].height;
        try {
          await page.render({ canvas: null, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
        } finally { page.cleanup(); }
        return canvas;
      };
    } catch (error) { await dispose(); throw error; }
  } else if (/\.(json|txt|docx|odt)$/i.test(name)) {
    // A Word or OpenDocument letter is drawn as its words, without line numbers.
    const word=/\.(docx|odt)$/i.test(name);
    const source=/\.json$/i.test(name) ? jsonSource(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,""))) : word ? wordSource(bytes,name) : {lines:bytes.subarray(0,100_000).toString("utf8").split(/\r?\n/),limited:bytes.length>100_000},lines=source.lines;
    const count=Math.max(1,Math.min(limit,Math.ceil(lines.length/40)));
    header.limited=source.limited || lines.length>count*40;
    for(let number=1;number<=count;number++) header.pages.push({width:1200,height:1320});
    draw=async(number)=>{
      canvas ??= createCanvas(1200,1320);const context=canvas.getContext("2d");
      context.fillStyle="white";context.fillRect(0,0,1200,1320);context.fillStyle="#17202f";context.font=word ? "20px sans-serif" : "18px monospace";
      lines.slice((number-1)*40,number*40).forEach((line,index)=>context.fillText(word ? line : `${(number-1)*40+index+1} ${line}`,20,40+index*30));
      return canvas;
    };
  } else if (/\.(xlsx?|csv|ods)$/i.test(name)) {
    const cap=viewLimits.rows+(sheet ? 4 : 0);
    const all = readSheet(bytes, name, { rows: cap + 1, columns: viewLimits.columns + 1, keepEmpty:true, sheet });
    const capped=all.length>cap;
    while(all.length && !all.at(-1)!.some(cell=>cell.trim())) all.pop();
    const rows = all.slice(0, Math.min(cap, limit * viewLimits.rowsPerPage));
    header.limited = capped || all.length > rows.length || rows.some((row) => row.length > viewLimits.columns);
    const columns = Math.max(1, ...rows.map((row) => Math.min(viewLimits.columns, row.length)));
    const count = Math.max(1, Math.ceil(rows.length / viewLimits.rowsPerPage));
    for (let number = 1; number <= count; number++) header.pages.push({ width: Math.max(800, columns * 180), height: 110 + Math.max(1, rows.slice((number - 1) * viewLimits.rowsPerPage, number * viewLimits.rowsPerPage).length) * 34 });
    draw = async (number) => {
      canvas ??= createCanvas(1, 1);
      canvas.width = header.pages[number - 1].width;
      canvas.height = header.pages[number - 1].height;
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#17202f";
      context.font = "20px sans-serif";
      context.fillText(`Sheet ${sheet ?? 1}, page ${number} of ${count}`, 24, 34);
      const cellWidth = (canvas.width - 84) / columns;
      for(let column=0;column<columns;column++) context.fillText(String.fromCharCode(65+column),60+column*cellWidth,54);
      rows.slice((number - 1) * viewLimits.rowsPerPage, number * viewLimits.rowsPerPage).forEach((row, index) => {
        context.fillText(String((number-1)*viewLimits.rowsPerPage+index+1),8,84+index*34);
        for (let column = 0; column < columns; column++) {
          const x = 60 + column * cellWidth, y = 60 + index * 34;
          context.strokeStyle = "#cbd5e1";
          context.strokeRect(x, y, cellWidth, 34);
          context.save();
          context.beginPath();
          context.rect(x + 6, y, cellWidth - 12, 34);
          context.clip();
          context.fillText((row[column] ?? "").slice(0, 500).replace(/[\r\n]/g, " "), x + 6, y + 24);
          context.restore();
        }
      });
      return canvas;
    };
  } else if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
    const picture = pictureSize(bytes);
    if (!picture || !picture.width || !picture.height || picture.width * picture.height > viewLimits.pixels) throw new Error("Not a picture this viewer shows");
    const image = await loadImage(bytes);
    photograph = true;
    header.pages.push(fit(image.width, image.height));
    draw = async () => {
      canvas = createCanvas(header.pages[0].width, header.pages[0].height);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
  } else throw new Error("File not supported");
  return { header, dispose: async () => { if (canvas) { canvas.width = 1; canvas.height = 1; } await dispose(); },
    async render(number: number, jpegOnly=false) {
      signal.throwIfAborted();
      if (!Number.isInteger(number) || number < 1 || number > header.pages.length) throw new Error("No page");
      const page = await draw(number);
      signal.throwIfAborted();
      const context = page.getContext("2d");
      const size = Math.max(15, Math.round(page.width / 48));
      context.save();
      context.font = `600 ${size}px sans-serif`;
      context.fillStyle = "rgba(24,32,47,0.18)";
      const positions = tiles(page.width, page.height, context.measureText(label).width, size);
      context.translate(page.width / 2, page.height / 2);
      context.rotate(-Math.PI / 6);
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.lineWidth = 1;
      for (const { x, y } of positions) { context.strokeText(label, x, y); context.fillText(label, x, y); }
      context.restore();
      const png = jpegOnly ? null : await page.encode("png");
      const jpeg = jpegOnly || photograph ? await page.encode("jpeg", 85) : null;
      const image = jpeg && (!png || jpeg.length < png.length) ? jpeg : png!;
      const bytes = new Uint8Array(image.length + 1);
      bytes[0] = image === jpeg ? 2 : 1;
      bytes.set(image, 1);
      return bytes;
    },
  };
}
