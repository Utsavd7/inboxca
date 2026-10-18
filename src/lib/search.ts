import { readSheet } from "./sheet";
import { serverCrypto } from "./crypto";
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

// The text inside a file, read by rules, never by AI: PDF text (up to 200 pages),
// spreadsheets and CSV, and plain text, JSON and XML. A scan or a picture gives no text
// until OCR is added; a password-protected or damaged file gives none.
export async function readText(name: string, bytes: Uint8Array) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  try {
    if (extension === "pdf") {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const pages: string[] = [];
      for (let number = 1; number <= Math.min(pdf.numPages, 200); number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      }
      return pages.join("\n");
    }
    if (["xlsx", "csv"].includes(extension)) return readSheet(Buffer.from(bytes), name).map((row) => row.join(" ")).join("\n");
    if (["txt", "json", "xml"].includes(extension)) return new TextDecoder().decode(bytes).replace(/<[^>]+>/g, " ");
  } catch (error) {
    // Expected for password-protected or damaged files; only the kind of error is logged.
    log.warn("read_text_failed", { kind: extension, error: (error as Error).name });
    return "";
  }
  return "";
}
