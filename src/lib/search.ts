import { wordSource } from "@/worker/word-source";
import { readSheet } from "./sheet";
import { serverCrypto, type firmCrypto } from "./crypto";
import { log } from "./logger";

// The words of a text: letters (with their vowel signs) and digits in any script, 2 to 40 long, each once, at most
// 5,000 a file.
export function words(text: string, max = 5000) {
  const seen = new Set<string>();
  for (const match of text.normalize("NFKC").toLowerCase().matchAll(/[\p{L}\p{M}\p{N}]{2,40}/gu)) {
    seen.add(match[0]);
    if (seen.size >= max) break;
  }
  return [...seen];
}

// Each word's search token: a short hash keyed with the firm's own key.
export const searchTokens = (firmId: string, list: string[]) => {
  const crypto = serverCrypto();
  return Promise.all(list.map(async (word) => (await crypto.blindIndex(firmId, "word", word)).slice(0, 8)));
};

// The same paper saved again with other bytes (a re-saved PDF, a re-exported sheet) has the
// same text but for its spacing: a hash of the text without spaces, keyed with the firm's own
// key, so it means nothing outside the firm (D29). A file with no text has none.
export const fingerprint = async (firmId: string, text: string, crypto: Pick<ReturnType<typeof firmCrypto>, "blindIndex"> = serverCrypto()) =>
  text.trim() ? crypto.blindIndex(firmId, "fingerprint", text.replace(/\s+/g, "")) : null;

// The text inside a file, read by rules, never by AI: PDF text (up to 200 pages), every sheet
// of a workbook (an old .xls file's first), CSV, Word and OpenDocument text, and plain text,
// JSON and XML. A scan or a picture gives no text
// until OCR is added; a damaged file, or a password-protected one without its saved password, gives none.
export async function readText(name: string, bytes: Uint8Array, password?: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  try {
    if (extension === "pdf") {
      // The existing Node text job stays outside the web bundle too.
      const pdfjs = await import(/* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), password }).promise;
      const pages: string[] = [];
      for (let number = 1; number <= Math.min(pdf.numPages, 200); number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      }
      return pages.join("\n");
    }
    if (["xlsx", "xls", "ods", "csv"].includes(extension)) {
      const data = Buffer.from(bytes), rows = readSheet(data, name);
      for (let sheet = 2; ["xlsx", "ods"].includes(extension) && sheet <= 100; sheet++) {
        try {
          rows.push(...readSheet(data, name, { rows: 100_000, columns: 16_384, sheet }));
        } catch {
          break;
        }
      }
      return rows.map((row) => row.join(" ")).join("\n");
    }
    if (["docx", "odt"].includes(extension)) return wordSource(Buffer.from(bytes), name).lines.join("\n");
    if (["txt", "json", "xml"].includes(extension)) return new TextDecoder().decode(bytes).replace(/<[^>]+>/g, " ");
  } catch (error) {
    // Expected for password-protected or damaged files; only the kind of error is logged.
    log.warn("read_text_failed", { kind: extension, error: (error as Error).name });
    return "";
  }
  return "";
}
