import { unescape, xlsxEntries } from "../src/lib/sheet.ts";

// A letter's or certificate's words, paragraph by paragraph, for the viewer: Word's
// document.xml or OpenDocument's content.xml, wrapped at about 100 letters a line. Never its
// macros, fields, links or pictures; up to 1,200 lines, as for text files.
export function wordSource(bytes: Buffer, name: string) {
  const part = xlsxEntries(bytes).get(/\.docx$/i.test(name) ? "word/document.xml" : "content.xml");
  if (!part) throw new Error("Not a document");
  const text = unescape(part().toString("utf8")
    .replace(/<w:(instrText|delText)\b[^>]*>[\s\S]*?<\/w:\1>/g, "")
    .replace(/<(w:tab|text:tab)\b[^>]*\/>/g, "    ")
    .replace(/<(w:br|w:cr|text:line-break)\b[^>]*\/>|<\/(w:p|text:p|text:h)>/g, "\n")
    .replace(/<[^>]+>/g, ""));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let rest = paragraph.trimEnd();
    do {
      const space = rest.lastIndexOf(" ", 100), cut = rest.length <= 100 ? rest.length : space > 40 ? space : 100;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    } while (rest && lines.length < 1200);
    if (lines.length >= 1200) return { lines, limited: true };
  }
  return { lines, limited: false };
}
