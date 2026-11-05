// Report a problem or idea (app/(app)/app/report.tsx): what a person in a firm may send Orelu.
// The panel and the server both check against these.
export const reportKinds = {
  broken: "Something is broken",
  odd: "Something does not work as expected",
  idea: "An idea or a feature I need",
  old: "Something is out of date",
} as const;
export type ReportKind = keyof typeof reportKinds;
// At most 3 pictures, recordings or PDFs, 10 MB in all; a screen recording stops at 60 seconds.
export const reportFiles = { most: 3, bytes: 10 * 1024 * 1024, seconds: 60, accept: "image/png,image/jpeg,image/webp,video/webm,video/mp4,application/pdf" };

// What a file is by its first bytes, whatever it is called: a PNG, JPEG or WebP picture, a WebM
// or MP4 recording, or a PDF. Anything else is not sent.
const at = (bytes: Uint8Array, from: number, text: string) => [...text].every((char, index) => bytes[from + index] === char.charCodeAt(0));
export function reportFileType(bytes: Uint8Array) {
  if (at(bytes, 0, "\x89PNG\r\n\x1a\n")) return { ext: "png", type: "image/png" };
  if (at(bytes, 0, "\xff\xd8\xff")) return { ext: "jpg", type: "image/jpeg" };
  if (at(bytes, 0, "RIFF") && at(bytes, 8, "WEBP")) return { ext: "webp", type: "image/webp" };
  if (at(bytes, 0, "\x1a\x45\xdf\xa3")) return { ext: "webm", type: "video/webm" };
  // An MP4's brand, so a HEIC picture or a QuickTime file, which share the box, is not taken for one.
  if (at(bytes, 4, "ftyp") && /^(iso[m2-9]|mp4[12]|avc1|M4V |dash)$/.test(String.fromCharCode(...bytes.subarray(8, 12)))) return { ext: "mp4", type: "video/mp4" };
  if (at(bytes, 0, "%PDF-")) return { ext: "pdf", type: "application/pdf" };
  return null;
}
