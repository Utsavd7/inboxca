import { createHash } from "node:crypto";

// A one-page PDF that says what it is, so a demo file opens in any viewer. Padding adds a
// comment of that many bytes, for a large file.
export function pdf(text: string, pages = 1, padding = 0) {
  const stream = `BT /F1 16 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const font = 3 + pages * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, (_, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]).flat(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = `%PDF-1.4\n${padding ? `%${"x".repeat(padding)}\n` : ""}`;
  const offsets = objects.map((object, at) => {
    const offset = body.length;
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`;
  return new TextEncoder().encode(body);
}

// The one-page PDF locked with a password by the standard 40-bit RC4 handler (ISO 32000-1,
// 7.6.3, revision 2), as banks and the tax portal lock statements.
export function lockedPdf(text: string, password: string) {
  const pad = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const padded = Buffer.concat([Buffer.from(password, "latin1"), pad]).subarray(0, 32);
  const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
  const rc4 = (key: Buffer, data: Buffer) => {
    const s = Array.from({ length: 256 }, (_, n) => n), out = Buffer.alloc(data.length);
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    for (let n = 0, i = 0, j = 0; n < data.length; n++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[n] = data[n] ^ s[(s[i] + s[j]) & 255]; }
    return out;
  };
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex"), permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-44);
  const owner = rc4(md5(padded).subarray(0, 5), padded), key = md5(padded, owner, permissions, id).subarray(0, 5);
  const content = rc4(md5(key, Buffer.from([4, 0, 0, 0, 0])).subarray(0, 10), Buffer.from(`BT /F1 16 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`, "latin1"));
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${rc4(key, pad).toString("hex")}> /P -44 >>`),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")], offsets: number[] = [];
  let at = parts[0].length;
  for (const [n, object] of objects.entries()) {
    const part = Buffer.concat([Buffer.from(`${n + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    offsets.push(at); parts.push(part); at += part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${at}\n%%EOF`));
  return new Uint8Array(Buffer.concat(parts));
}
