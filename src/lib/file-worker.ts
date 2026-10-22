// Shared by the app, browser and file worker. No native or Node imports here.
import type {Template} from "./templates.ts";
export const viewLimits = { bytes: 25_000_000, pages: 30, rows: 1000, columns: 26, rowsPerPage: 40, pixels: 40_000_000 };
export type ViewHeader = { pages: { width: number; height: number }[]; limited: boolean };
export type ViewRequest = { firm: string; file: string; name: string; label: string; limit: number; expires: number; provider: "local" | "dropbox"; token: string; purpose?: "sheet" | "portal" | "edited" | "copy"; sheet?: number; form?:{template:Template;period:string;gstin:string} };
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
    !["local", "dropbox"].includes(value.provider) || typeof value.token !== "string" || (value.provider === "dropbox" && !value.token)) throw new Error("Not allowed");
  return value;
}

// First frame: JSON page sizes. Each following frame: one MIME byte (1 PNG, 2 JPEG), then pixels.
// Every frame has a four byte unsigned big endian length. No file text or credentials enter it.
export function frameSize(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 16_000_000) throw new Error("Bad frame size");
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length);
  return prefix;
}

export async function* readFrames(stream: ReadableStream<Uint8Array>) {
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
      if (!length || length > 16_000_000) throw new Error("Bad frame size");
      yield (await take(length))!;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
