import { File, FileImage, FileJson, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";

// A paper's kind by its file name (PDF, sheet, image, JSON or other), as a tinted tile
// (documents.css .f-*).
const kinds: [RegExp, string, LucideIcon][] = [
  [/\.pdf$/i, "pdf", FileText],
  [/\.(xlsx?|csv|ods)$/i, "sheet", FileSpreadsheet],
  [/\.(png|jpe?g|gif|webp|heic|tiff?)$/i, "image", FileImage],
  [/\.json$/i, "json", FileJson],
];
export function FileTile({ name }: { name: string }) {
  const [, kind, Icon] = kinds.find(([pattern]) => pattern.test(name)) ?? [null, "other", File];
  return (
    <span className={`icon-tile f-${kind}`} aria-hidden>
      <Icon size={16} strokeWidth={2.2} />
    </span>
  );
}
