// OneDrive's own checksum and its upload session (PLAN.md 5.5.1, 5.16), in the browser (the
// uploader) and on the server alike.

// quickXorHash, the one checksum OneDrive gives on home and work accounts alike (Microsoft's
// QuickXorHash snippet): each byte XORed into a 160-bit ring 11 bits on from the one before,
// then the length XORed into its last 8 bytes, in base64. Bytes 160 apart land on the same
// bits, so each of the 160 is XORed first and placed once.
export async function quickXorHash(file: Blob) {
  const sums = new Uint8Array(160);
  for (let at = 0; at < file.size; at += 4 * 1024 * 1024) {
    const bytes = new Uint8Array(await file.slice(at, at + 4 * 1024 * 1024).arrayBuffer());
    for (let index = 0; index < bytes.length; index++) sums[(at + index) % 160] ^= bytes[index];
  }
  const ring = new Uint8Array(20);
  sums.forEach((sum, index) => {
    const bit = (index * 11) % 160;
    const value = sum << (bit % 8);
    ring[bit >> 3] ^= value & 0xff;
    ring[((bit >> 3) + 1) % 20] ^= value >> 8;
  });
  for (let index = 0, length = file.size; index < 8; index++, length = Math.floor(length / 256)) ring[12 + index] ^= length % 256;
  return btoa(String.fromCharCode(...ring));
}

// A file sent to an upload session's one-time address: in order, in pieces of 10 MiB (a
// multiple of 320 KiB, as Microsoft asks), with no sign in. The last answer says how it went:
// the file once it is all there, or 409 when its name was taken meanwhile.
export const PIECE = 32 * 320 * 1024;
export async function sendPieces(url: string, file: Blob, timeout?: number) {
  let answer = new Response(null, { status: 400 });
  for (let at = 0; at < file.size && (at === 0 || answer.status === 202); at += PIECE) {
    const end = Math.min(at + PIECE, file.size);
    answer = await fetch(url, { method: "PUT", headers: { "Content-Range": `bytes ${at}-${end - 1}/${file.size}` }, body: file.slice(at, end), signal: timeout ? AbortSignal.timeout(timeout) : undefined });
  }
  return answer;
}
