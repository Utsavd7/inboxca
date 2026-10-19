import { createCanvas, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";
import { readSheet } from "./sheet";

export const viewLimits = { bytes: 25_000_000, pages: 30, rows: 1000, columns: 12, rowsPerPage: 40 };

export function viewerLabel(person: string, firm: string, at = new Date()) {
  return `${person}, ${firm}, ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

// Tile beyond the rotated page edges too, so crops still show who opened it.
export function tiles(width: number, height: number, textWidth: number, size: number) {
  const reach = Math.hypot(width, height);
  const positions: { x: number; y: number }[] = [];
  for (let row = 0, y = -reach; y < reach; y += size * 7, row++)
    for (let x = -reach - (row % 2) * textWidth / 2; x < reach; x += textWidth + size * 4) positions.push({ x, y });
  return positions;
}

export async function renderPage(bytes: Buffer, name: string, pageNumber: number, label: string) {
  if (bytes.length > viewLimits.bytes || !Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("File or page too large");
  let canvas = createCanvas(1200, 1600);
  let count = 1;
  let limited = false;
  const fit = (width: number, height: number) => {
    const scale = Math.min(1200 / width, 1800 / height, 2);
    canvas = createCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
    return scale;
  };
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const root = join(process.cwd(), "node_modules/pdfjs-dist");
    const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: join(root, "standard_fonts/"), cMapUrl: join(root, "cmaps/"), cMapPacked: true, wasmUrl: join(root, "wasm/") });
    try {
      const pdf = await task.promise;
      count = Math.min(pdf.numPages, viewLimits.pages);
      limited = pdf.numPages > count;
      if (pageNumber > count) throw new Error("No page");
      const page = await pdf.getPage(pageNumber);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: fit(size.width, size.height) });
      await page.render({ canvas: null, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
    } finally {
      await task.destroy();
    }
  } else if (/\.(xlsx?|csv)$/i.test(name)) {
    const all = readSheet(bytes, name, { rows: viewLimits.rows + 1, columns: viewLimits.columns });
    const rows = all.slice(0, viewLimits.rows);
    limited = all.length > rows.length || rows.some((row) => row.length > viewLimits.columns);
    count = Math.max(1, Math.ceil(rows.length / viewLimits.rowsPerPage));
    if (pageNumber > count) throw new Error("No page");
    const shown = rows.slice((pageNumber - 1) * viewLimits.rowsPerPage, pageNumber * viewLimits.rowsPerPage);
    const columns = Math.max(1, ...rows.map((row) => Math.min(viewLimits.columns, row.length)));
    canvas = createCanvas(Math.max(800, columns * 180), 110 + Math.max(1, shown.length) * 34);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#17202f";
    context.font = "20px sans-serif";
    context.fillText(`Sheet 1, page ${pageNumber} of ${count}`, 24, 34);
    const cellWidth = (canvas.width - 48) / columns;
    shown.forEach((row, index) => {
      for (let column = 0; column < columns; column++) {
        const x = 24 + column * cellWidth, y = 60 + index * 34;
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
  } else if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
    if (pageNumber !== 1) throw new Error("No page");
    const signature = bytes.subarray(0, 12);
    const picture = signature.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" || signature.subarray(0, 3).toString("hex") === "ffd8ff"
      || /^GIF8[79]a/.test(signature.toString("ascii")) || signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8) === "WEBP";
    if (!picture) throw new Error("Not a picture");
    const image = await loadImage(bytes);
    fit(image.width, image.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else throw new Error("File not supported");
  const context = canvas.getContext("2d");
  const size = Math.max(15, Math.round(canvas.width / 48));
  context.font = `600 ${size}px sans-serif`;
  context.fillStyle = "rgba(24,32,47,0.18)";
  const positions = tiles(canvas.width, canvas.height, context.measureText(label).width, size);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(-Math.PI / 6);
  context.strokeStyle = "rgba(255,255,255,0.45)";
  context.lineWidth = 1;
  for (const { x, y } of positions) {
    context.strokeText(label, x, y);
    context.fillText(label, x, y);
  }
  return { bytes: await canvas.encode("png"), count, limited, width: canvas.width, height: canvas.height };
}
