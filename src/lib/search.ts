import { createHash } from "node:crypto";
import { z } from "zod";
import { wordSource } from "@/worker/word-source";
import { readSheet } from "./sheet";
import { serverCrypto, type firmCrypto } from "./crypto";
import { ocrLimits, signView } from "./file-worker";
import { log } from "./logger";
import { recogniseTaxPdf, textLines } from "./tax-papers";
import { openText } from "./workspace";

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

// What OCR text was read with, kept beside its sealed text (documents.details.text).
export type Ocr = { kind: "ocr_text"; engine: string; languages: string[]; confidence: number };
const ocrRead = z.object({ pages: z.array(z.string().max(1_000_000)).max(ocrLimits.pages), confidence: z.number().min(0).max(100), engine: z.string().max(100), languages: z.array(z.string().max(20)).max(5) });

// Pages without text and pictures, read once by OCR in the file worker (worker/ocr.ts), never
// in this server: the file goes with a signed ticket, then a locked PDF's password. Without
// the worker, or when it cannot read the file in time, there is no OCR text, and no retry.
async function ocr(bytes: Uint8Array, pages: number[], password: string | undefined, scan: { ocr?: Ocr }) {
  const url = process.env.FILE_WORKER_URL, secret = process.env.FILE_WORKER_SECRET;
  if (!url || !secret) return null;
  const tail = Buffer.from(password ?? ""), body = Buffer.concat([bytes, tail]);
  const ticket = JSON.stringify({ size: body.length, sha256: createHash("sha256").update(body).digest("hex"), zip: false, expires: Math.floor(Date.now() / 1000) + 60, pages, password: tail.length });
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/ocr`, {
      method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(100_000),
      headers: { Authorization: await signView(ticket, secret), "X-InboxCA-Intake": ticket, "Content-Type": "application/octet-stream" },
    });
    if (!response.ok) {
      log.warn("ocr_failed", { status: response.status });
      await response.body?.cancel();
      return null;
    }
    const { pages: read, ...meta } = ocrRead.parse(await response.json());
    scan.ocr = { kind: "ocr_text", ...meta };
    return read;
  } catch (error) {
    log.warn("ocr_failed", { error: (error as Error).name });
    return null;
  }
}

// A scan waiting to be checked may suggest its type and period from its sealed OCR text, by
// the rules that know a PDF's (src/lib/tax-papers.ts). Never its figures.
export async function scanType(firmId: string, documentId: string, details: unknown) {
  if ((details as { text?: Partial<Ocr> } | null)?.text?.kind !== "ocr_text") return null;
  const text = await openText(firmId, documentId, details).catch(() => null);
  return text ? recogniseTaxPdf(textLines(text)) : null;
}

// The text inside a file, read by rules, never by AI: PDF text (up to 200 pages), every sheet
// of a workbook (an old .xls file's first), CSV, Word and OpenDocument text, and plain text,
// JSON and XML. Given scan (the read_document job), PDF pages without text and JPEG, PNG and
// WebP pictures are read by OCR, and scan.ocr says how; else a scan or a picture gives no
// text. A damaged file, or a password-protected one without its saved password, gives none.
export async function readText(name: string, bytes: Uint8Array, password?: string, scan?: { ocr?: Ocr }) {
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
      // A page with almost no letters or digits in its text layer is a scan.
      const blank = pages.flatMap((page, at) => ((page.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 20 ? [at + 1] : [])).slice(0, ocrLimits.pages);
      (scan && blank.length ? await ocr(bytes, blank, password, scan) : null)?.forEach((text, at) => { pages[blank[at] - 1] = text; });
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
    if (scan && ["jpg", "jpeg", "png", "webp"].includes(extension)) return (await ocr(bytes, [], undefined, scan))?.[0] ?? "";
  } catch (error) {
    // Expected for password-protected or damaged files; only the kind of error is logged.
    log.warn("read_text_failed", { kind: extension, error: (error as Error).name });
    return "";
  }
  return "";
}
