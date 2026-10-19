// A one-page PDF that says what it is, so a demo file opens in any viewer.
export function pdf(text: string, pages = 1) {
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
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, at) => {
    const offset = body.length;
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`;
  return new TextEncoder().encode(body);
}
