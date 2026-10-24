// A small A4 PDF writer for the demo firm's invented papers: text in the standard Helvetica
// fonts (so InboxCA can read it back), lines and shaded boxes. Every page carries a tiny
// "Demo" mark; government papers also carry a light "SAMPLE" across the page, and no
// emblem, seal or signature is ever drawn.

// Helvetica's character widths (Adobe's standard metrics), space to tilde, per 1000 units.
const widths = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
export const textWidth = (text: string, size: number, bold = false) =>
  [...text].reduce((sum, char) => sum + (widths[char.charCodeAt(0) - 32] ?? 556), 0) * size * (bold ? 1.06 : 1) / 1000;

type Style = { size?: number; bold?: boolean; align?: "left" | "right" | "center"; gray?: number };
const clean = (text: string) => text.replace(/[^\x20-\x7e]/g, "-").replace(/[()\\]/g, "\\$&");

export class Paper {
  private pages: string[][] = [];
  constructor(private sample = false) { this.page(); }
  page() { this.pages.push([]); return this; }
  private get ops() { return this.pages[this.pages.length - 1]; }
  // x and y in points from the top left of an A4 page (595 by 842).
  text(x: number, y: number, value: string, style: Style = {}) {
    const size = style.size ?? 9, bold = style.bold ?? false, text = String(value);
    const at = style.align === "right" ? x - textWidth(text, size, bold) : style.align === "center" ? x - textWidth(text, size, bold) / 2 : x;
    this.ops.push(`${style.gray ?? 0} g BT /${bold ? "F2" : "F1"} ${size} Tf ${at.toFixed(2)} ${(842 - y).toFixed(2)} Td (${clean(text)}) Tj ET 0 g`);
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5) {
    this.ops.push(`${width} w ${x1} ${842 - y1} m ${x2} ${842 - y2} l S`);
    return this;
  }
  box(x: number, y: number, w: number, h: number, fill?: number) {
    this.ops.push(fill === undefined ? `0.5 w ${x} ${842 - y - h} ${w} ${h} re S` : `${fill} g ${x} ${842 - y - h} ${w} ${h} re f 0 g`);
    return this;
  }
  bytes() {
    const fonts = 3 + this.pages.length * 2;
    const streams = this.pages.map((ops) => [
      ...(this.sample ? [`0.9 g BT /F2 96 Tf 0.819 0.574 -0.574 0.819 150 260 Tm (SAMPLE) Tj ET 0 g`] : []),
      ...ops,
      `0.6 g BT /F1 5 Tf 548 14 Td (Demo) Tj ET 0 g`,
    ].join("\n"));
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
      ...streams.flatMap((stream, i) => [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fonts} 0 R /F2 ${fonts + 1} 0 R >> >> >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ]),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    let body = "%PDF-1.4\n";
    const offsets = objects.map((object, at) => {
      const offset = Buffer.byteLength(body);
      body += `${at + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = Buffer.byteLength(body);
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Uint8Array(Buffer.from(body, "latin1"));
  }
}

// 1,23,456.00 in the Indian grouping.
export const inr = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only".
export function inWords(value: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]} ${ones[n % 10]}`.trim());
  const three = (n: number) => [n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : "", two(n % 100)].filter(Boolean).join(" ");
  let rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100), parts: string[] = [];
  for (const [unit, size] of [["Crore", 10_000_000], ["Lakh", 100_000], ["Thousand", 1_000]] as const) {
    if (rupees >= size) { parts.push(`${two(Math.floor(rupees / size)) || three(Math.floor(rupees / size))} ${unit}`); rupees %= size; }
  }
  if (rupees) parts.push(three(rupees));
  return `Rupees ${parts.join(" ") || "Zero"}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
