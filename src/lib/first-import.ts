import { describeFile, finalPapers } from "./documents";
import type { WorkType } from "./drive";

// The first import of past files already in the firm's drive (PLAN.md 5.16), by rules only:
// each file's client from the folder names in its path, its type, period and work from its
// name and folders. Nothing moves until the owner approves the preview.
export type Scope = "final" | "year" | "all";
export type Planned = { id: string; from: string; size: number; client: string | null; folder: string; work: WorkType; type: string; period: string; year: string; toCheck: boolean };

// A name as folders spell it: lower case, letters and digits, no company endings.
const plain = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private|ltd|limited|llp|co|company)\b\.?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const workWords: [RegExp, WorkType][] = [
  [/\bgst\b/, "gst"],
  [/income tax|\bitr\b|\btds\b/, "income_tax"],
  [/tax audit/, "tax_audit"],
  [/\baudit\b/, "audit"],
  [/\broc\b|\bmca\b/, "roc"],
];

// The client a path belongs to: the longest client name that is one of its folders, or is
// inside one. The folder it was found in is kept, so the owner can correct a whole folder.
export function matchClient(path: string, clients: { id: string; name: string }[]) {
  const folders = path.split(/[\\/]/).slice(0, -1);
  let best: { id: string; folder: string; length: number } | null = null;
  for (const client of clients) {
    const name = plain(client.name);
    if (name.length < 3) continue;
    folders.forEach((folder, at) => {
      const spelled = plain(folder);
      if ((spelled === name || ` ${spelled} `.includes(` ${name} `)) && (!best || name.length > best.length))
        best = { id: client.id, folder: folders.slice(0, at + 1).join("/"), length: name.length };
    });
  }
  const found = best as { id: string; folder: string } | null;
  return found && { id: found.id, folder: found.folder };
}

export function planImport(
  files: { id: string; path: string; size: number }[],
  clients: { id: string; name: string }[],
  scope: Scope,
  year: string,
  today: string,
  chosen: Record<string, string> = {},
) {
  return files.flatMap((file): Planned[] => {
    const name = file.path.split(/[\\/]/).pop() ?? "";
    const folders = file.path.slice(0, -name.length).toLowerCase();
    const about = describeFile(name, folders, null, `${today}T00:00:00Z`);
    const work = about.work !== "other" ? about.work : (workWords.find(([pattern]) => pattern.test(folders))?.[1] ?? "other");
    if (scope === "final" && !finalPapers.has(about.type)) return [];
    if (scope === "year" && about.year !== year) return [];
    const parent = file.path.split(/[\\/]/).slice(0, -1).join("/");
    const match = matchClient(file.path, clients);
    const client = chosen[match?.folder ?? parent] ?? match?.id ?? null;
    return [{ id: file.id, from: file.path, size: file.size, client, folder: match?.folder ?? parent, work, type: about.type, period: about.period, year: about.year, toCheck: !about.sure }];
  });
}
