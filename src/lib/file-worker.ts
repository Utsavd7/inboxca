// Shared by the app, browser and file worker. No native or Node imports here.
import type {Template} from "./templates.ts";
// A file sent in (PLAN.md 5.15): up to 50 MB; a ZIP up to 1,000 files and 500 MB unpacked.
export const intakeLimits = { bytes: 50 * 1024 * 1024, entries: 1000, unpacked: 500 * 1024 * 1024 };
export const viewLimits = { bytes: intakeLimits.bytes, pages: 30, rows: 1000, columns: 26, rowsPerPage: 40, pixels: 40_000_000 };
// One-time OCR (PLAN.md 5.5.0, D29), sized for a small worker: the first 20 pages without
// text a file, a picture up to 25 megapixels by its header, a page drawn at 300 dots an
// inch within that, a minute a file, one file at a time.
export const ocrLimits = { pages: 20, pixels: 25_000_000, seconds: 60 };
export type ViewHeader = { pages: { width: number; height: number }[]; limited: boolean };
export type ViewRequest = { firm: string; file: string; name: string; label: string; limit: number; expires: number; provider: "local" | "dropbox" | "onedrive"; token: string; purpose?: "sheet" | "portal" | "edited" | "copy"; sheet?: number; form?:{template:Template;period:string;gstin?:string;pan?:string;official?:string}; password?: string };
const text = new TextEncoder();

export function viewerLabel(person: string, firm: string, at = new Date()) {
  return `${person}, ${firm}, ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

const key = (secret: string) => crypto.subtle.importKey("raw", text.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function signView(body: string, secret: string) {
  if (!secret) throw new Error("Worker is not configured");
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), text.encode(body))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validSignature(body:string,signature:string,secret:string) {
  if(!secret || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const mac=Uint8Array.from(signature.match(/../g)!,byte=>parseInt(byte,16));
  return crypto.subtle.verify("HMAC",await key(secret),mac,text.encode(body));
}

export async function verifyView(body: string, signature: string, secret: string, file: string, now = Date.now() / 1000, purpose?: ViewRequest["purpose"]): Promise<ViewRequest> {
  if (!secret || body.length > 16_384 || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Not allowed");
  if (!await validSignature(body,signature,secret)) throw new Error("Not allowed");
  const value = JSON.parse(body) as ViewRequest;
  if (value && value.sheet!==undefined && (!Number.isInteger(value.sheet) || value.sheet<1 || value.sheet>100 || value.purpose!==undefined && value.purpose!=="copy" || !/\.xlsx$/i.test(value.name))) throw new Error("Not allowed");
  if (!value || value.purpose !== purpose || typeof value.firm !== "string" || !value.firm || value.file !== file || !file || file.length > 4096 ||
    typeof value.name !== "string" || value.name.length > 2000 || typeof value.label !== "string" || !value.label || value.label.length > 1000 ||
    !Number.isInteger(value.limit) || value.limit < 1 || value.limit > viewLimits.pages || !Number.isInteger(value.expires) || value.expires <= now || value.expires > now + 75 ||
    !["local", "dropbox", "onedrive"].includes(value.provider) || typeof value.token !== "string" || (value.provider !== "local" && !value.token) ||
    value.password !== undefined && (typeof value.password !== "string" || !value.password || value.password.length > 200)) throw new Error("Not allowed");
  return value;
}

// A file sent in goes to the worker as it is, with a signed ticket naming its size and
// checksum, so the signature covers the bytes; zip asks the worker to open it.
export type IntakeTicket = { size: number; sha256: string; zip: boolean; expires: number };
export async function verifyIntake(ticket: string, signature: string, secret: string, now = Date.now() / 1000): Promise<IntakeTicket> {
  if (ticket.length > 1000 || !await validSignature(ticket, signature, secret)) throw new Error("Not allowed");
  const value = JSON.parse(ticket) as IntakeTicket;
  if (!value || !Number.isInteger(value.size) || value.size < 1 || value.size > intakeLimits.bytes || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.zip !== "boolean" || !Number.isInteger(value.expires) || value.expires <= now || value.expires > now + 75) throw new Error("Not allowed");
  return value;
}

const starts = (bytes: Uint8Array, text: string, at = 0) => bytes.length >= at + text.length && [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
function holds(bytes: Uint8Array, text: string) {
  const first = text.charCodeAt(0);
  for (let at = bytes.indexOf(first); at >= 0; at = bytes.indexOf(first, at + 1)) if (starts(bytes, text, at)) return true;
  return false;
}
// Programs, scripts and Office files with macros are never taken (PLAN.md 5.15, 8.6), known
// by their name or their first bytes: a Windows, Linux or Mac program, a script, or an Office
// file that holds a macro project whatever it is called.
const programs = /\.(exe|dll|com|scr|pif|cpl|msi|msp|msc|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|wsf|wsh|hta|jar|sh|bash|zsh|command|app|dmg|pkg|deb|rpm|apk|lnk|url|reg|inf|html?|xhtml|svg|xlsm|xltm|xlam|docm|dotm|pptm|potm|ppam|ppsm|sldm)$/i;
export function unsafeFile(name: string, bytes: Uint8Array) {
  if (programs.test(name.replace(/[\s.]+$/, ""))) return true;
  const word = (at: number) => bytes.length >= at + 4 ? ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0 : 0;
  const pe = bytes.length >= 64 ? bytes[60] | (bytes[61] << 8) | (bytes[62] << 16) | (bytes[63] << 24) : -1;
  if (starts(bytes, "MZ") && pe > 0 && starts(bytes, "PE\0\0", pe) || starts(bytes, "\x7fELF") || starts(bytes, "#!") || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(word(0))) return true;
  if (starts(bytes, "PK\x03\x04")) return holds(bytes, "vbaProject.bin");
  return starts(bytes, "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") && holds(bytes, "_\0V\0B\0A\0_\0P\0R\0O\0J\0E\0C\0T\0");
}
export const isZip = (name: string, bytes: Uint8Array) => /\.zip$/i.test(name) && (starts(bytes, "PK\x03\x04") || starts(bytes, "PK\x05\x06"));

// First frame: JSON page sizes. Each following frame: one MIME byte (1 PNG, 2 JPEG), then pixels.
// Every frame has a four byte unsigned big endian length. No file text or credentials enter it.
export function frameSize(bytes: Uint8Array, max = 16_000_000) {
  if (!bytes.length || bytes.length > max) throw new Error("Bad frame size");
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length);
  return prefix;
}

export async function* readFrames(stream: ReadableStream<Uint8Array>, max = 16_000_000) {
  const reader = stream.getReader();
  let chunk: Uint8Array = new Uint8Array(), at = 0;
  const take = async (length: number, end = false) => {
    const result = new Uint8Array(length);
    let used = 0;
    while (used < length) {
      if (at === chunk.length) {
        const next = await reader.read();
        if (next.done) {
          if (!used && end) return null;
          throw new Error("Incomplete page");
        }
        chunk = next.value;
        at = 0;
      }
      const size = Math.min(length - used, chunk.length - at);
      result.set(chunk.subarray(at, at + size), used);
      at += size;
      used += size;
    }
    return result;
  };
  try {
    for (;;) {
      const prefix = await take(4, true);
      if (!prefix) break;
      const length = new DataView(prefix.buffer).getUint32(0);
      if (!length || length > max) throw new Error("Bad frame size");
      yield (await take(length))!;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
