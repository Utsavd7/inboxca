import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { join } from "node:path";
import { readSheet } from "../src/lib/sheet.ts";
import { viewLimits, type ViewFind, type ViewHeader, type ViewMark } from "../src/lib/file-worker.ts";
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
// A printed value equals a figure: amounts by their digits (8,32,545.00 is 832545), words as they are.
const same = (printed: string, value: string) => {
  const digits = (text: string) => text.replace(/^(₹|Rs\.?)\s*/i, "").replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(digits(printed)) && /^-?\d+(\.\d+)?$/.test(value) ? Number(digits(printed)).toFixed(2) === Number(value).toFixed(2) : printed.trim() === value.trim();
};
const spot = (id: string, page: number, x: number, y: number, width: number, height: number, size: { width: number; height: number }): ViewMark => {
  const part = (value: number, of: number) => Math.round(Math.min(1, Math.max(0, value / of)) * 10_000) / 10_000;
  return { id, page, x: part(x, size.width), y: part(y, size.height), width: part(width, size.width), height: part(height, size.height) };
};

// find: figures whose spots go back in the header (ViewFind), by the same layout as the pages.
export async function openView(bytes: Buffer, name: string, label: string, limit = viewLimits.pages, signal = new AbortController().signal, sheet?:number, password?:string, find: ViewFind[] = []) {
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
  const header: ViewHeader = { pages: [], limited: false }, marks: ViewMark[] = [];
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
        const wanted = find.filter((one) => one.page === number && one.value);
        if (wanted.length) {
          const items = (await page.getTextContent()).items, viewport = page.getViewport({ scale: 1 });
          for (const one of wanted) {
            const hit = items.find((item) => "str" in item && (same(item.str, one.value!) || item.str.split(/\s+/).some((word) => same(word, one.value!))));
            if (!hit || !("str" in hit)) continue;
            const [x0, y0] = viewport.convertToViewportPoint(hit.transform[4], hit.transform[5]), [x1, y1] = viewport.convertToViewportPoint(hit.transform[4] + hit.width, hit.transform[5] + (hit.height || Math.abs(hit.transform[3]) || 10));
            marks.push(spot(one.id, number, Math.min(x0, x1) - 3, Math.min(y0, y1) - 3, Math.abs(x1 - x0) + 6, Math.abs(y1 - y0) + 6, viewport));
          }
        }
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
    // A JSON figure's line by its path, a text file's by its number (/line/12); the value itself is
    // boxed when it can be found on that line, else the whole line.
    if(!word && find.length) {
      const measure=createCanvas(1,1).getContext("2d"),positions="positions" in source ? source.positions as Map<string,number> : null;measure.font="18px monospace";
      for(const one of find) {
        const at=positions ? positions.get(one.path ?? "") : Number(/^\/line\/(\d+)$/.exec(one.path ?? "")?.[1]);
        if(!at || at>count*40 || Math.ceil(at/40)!==one.page) continue;
        const text=`${at} ${lines[at-1]}`,start=positions ? text.search(/-?[\d.eE+]+,?$/) : one.value ? text.indexOf(one.value,String(at).length+1) : -1;
        const shown=start<0 ? text : positions ? text.slice(start).replace(/,$/,"") : one.value!;
        const x=20+(start<0 ? 0 : measure.measureText(text.slice(0,start)).width);
        marks.push(spot(one.id,one.page,x-4,40+((at-1)%40)*30-21,Math.min(measure.measureText(shown).width,1180-x)+8,28,{width:1200,height:1320}));
      }
    }
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
    // A cell's box, where draw below puts it.
    for (const one of find) {
      const column = (one.cell ?? "").charCodeAt(0) - 65, row = Number((one.cell ?? "").slice(1));
      if (!one.cell || column >= columns || row > rows.length || Math.ceil(row / viewLimits.rowsPerPage) !== one.page) continue;
      const size = header.pages[one.page - 1], cellWidth = (size.width - 84) / columns;
      marks.push(spot(one.id, one.page, 60 + column * cellWidth, 60 + ((row - 1) % viewLimits.rowsPerPage) * 34, cellWidth, 34, size));
    }
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
  if (marks.length) header.marks = marks;
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
