import { crc32, inflateRawSync } from "node:zlib";
import { intakeLimits, unsafeFile } from "../src/lib/file-worker.ts";

// Why a ZIP is not opened: unsafe ("zip": another archive, a program, a path out of the ZIP,
// a link, or damaged), "zip_password" or "zip_large".
export class Refused extends Error {}

// What a computer adds to a ZIP by itself, left out without a word, and the archives a ZIP
// may not hold: one level only (PLAN.md 5.15).
const clutter = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
const archives = /\.(zip|zipx|rar|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|z|lz|lzh|lzma|zst|cab|iso|arj|ace)$/i;
const containers = /\.(docx|xlsx|pptx|odt|ods|odp)$/i;

// A ZIP's files from its central directory, before anything is unpacked: up to 1,000 entries
// and 500 MB unpacked, each within the file limit; no path that climbs out or starts at a
// root, no links, no passwords, no ZIP64 or split ZIPs, and no two entries sharing bytes.
export function zipEntries(zip: Buffer) {
  if (zip.length < 22) throw new Refused("zip");
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 22 - 65_535) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || end < zip.length - 22 - 65_535) throw new Refused("zip");
  const count = zip.readUInt16LE(end + 10), start = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== count || start + zip.readUInt32LE(end + 12) > end) throw new Refused("zip");
  if (count > intakeLimits.entries) throw new Refused("zip_large");
  const entries: { name: string; method: number; crc: number; size: number; data: Buffer }[] = [], spans: [number, number][] = [];
  let at = start, total = 0;
  for (let left = count; left > 0; left--) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) throw new Refused("zip");
    const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10), crc = zip.readUInt32LE(at + 16), packed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24);
    const length = zip.readUInt16LE(at + 28), mode = zip.readUInt32LE(at + 38) >>> 16, offset = zip.readUInt32LE(at + 42);
    const path = zip.toString(flags & 0x800 ? "utf8" : "latin1", at + 46, at + 46 + length);
    const unix = zip[at + 5] === 3;
    at += 46 + length + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const parts = path.split(/[\\/]/);
    if (!path || path.includes("\0") || /^([\\/]|[a-z]:)/i.test(path) || parts.includes("..") || unix && (mode & 0o170000) === 0o120000) throw new Refused("zip");
    if (/[\\/]$/.test(path) || clutter.test(path)) continue;
    if (flags & 1) throw new Refused("zip_password");
    if (method !== 0 && method !== 8 || archives.test(path)) throw new Refused("zip");
    if (size > intakeLimits.bytes || (total += size) > intakeLimits.unpacked) throw new Refused("zip_large");
    if (offset + 30 > start || zip.readUInt32LE(offset) !== 0x04034b50) throw new Refused("zip");
    const from = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    if (from + packed > start) throw new Refused("zip");
    spans.push([offset, from + packed]);
    if (size) entries.push({ name: parts.at(-1)!, method, crc, size, data: zip.subarray(from, from + packed) });
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some(([from], index) => index && from < spans[index - 1][1])) throw new Refused("zip");
  return entries;
}

// One file's bytes, never more than its entry says, only when its checksum agrees, and
// never a program or another archive under a harmless name.
export function unpack(entry: ReturnType<typeof zipEntries>[number]) {
  let bytes: Buffer;
  try { bytes = entry.method === 8 ? inflateRawSync(entry.data, { maxOutputLength: entry.size }) : entry.data; }
  catch { throw new Refused("zip"); }
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc || unsafeFile(entry.name, bytes)) throw new Refused("zip");
  const head = bytes.subarray(0, 6).toString("latin1");
  if (/^(PK\x03\x04|Rar!|7z\xbc\xaf|\x1f\x8b|BZh|\xfd7zXZ)/.test(head) && !containers.test(entry.name)) throw new Refused("zip");
  return bytes;
}
