// A file's checksum as Dropbox keeps it (its "content hash"): the SHA-256 of each 4 MB block,
// joined, then hashed again. The browser works it out before an upload, and the drive's own
// value is compared after it (PLAN.md 5.16). Runs in the browser and on the server alike.
const BLOCK = 4 * 1024 * 1024;

export async function contentHash(file: Blob) {
  const blocks: Uint8Array[] = [];
  for (let at = 0; at < file.size; at += BLOCK) blocks.push(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.slice(at, at + BLOCK).arrayBuffer())));
  const joined = new Uint8Array(blocks.length * 32);
  blocks.forEach((block, at) => joined.set(block, at * 32));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", joined)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
