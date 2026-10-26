import { DELETED_FOLDER, INCOMING, VIRUS_FOLDER, safeName, workTypes, type FolderOrder, type WorkType } from "./drive";

// The Documents folder view: the firm's drive below InboxCA's own folder, one folder at a
// time, as Dropbox shows it, with only what the person's clients allow (PLAN.md 5.5.0, D18).

// A folder path from the address, as its folder names, or null when it is not one: no
// empty, "." or ".." part, nothing a drive refuses in a path, and not deeper than a drive goes.
export function parsePath(raw: string | null | undefined) {
  if (!raw) return [];
  const parts = raw.split("/");
  return parts.length <= 12 && parts.every((part) => part.length > 0 && part.length <= 255 && part !== "." && part !== ".." && !/[\u0000-\u001f\\]/.test(part)) ? parts : null;
}

// Where the client's and the work's folders sit, by the firm's folder order.
const levels: Record<FolderOrder, { client: number; work: number }> = {
  year_client_work: { client: 1, work: 2 },
  work_year_client: { client: 2, work: 0 },
  client_year_work: { client: 0, work: 2 },
};

// The client folder a path is inside, and the work its work folder names, when it says.
export function placeOf(parts: string[], order: FolderOrder) {
  const at = levels[order];
  return {
    client: parts.length > at.client ? parts[at.client] : null,
    work: (Object.keys(workTypes) as WorkType[]).find((work) => workTypes[work] === parts[at.work]) ?? null,
  };
}

// Files sent from a disk for the first import, removed files and files with a virus: the owner's alone.
const ownerOnly = new Set([INCOMING, DELETED_FOLDER, "Deleted and old versions", VIRUS_FOLDER]);

// Whether a person sees the folder or file at a path. Someone who sees every client sees it
// all but the owner's own folders. Anyone else sees only what is inside one of their clients'
// folders (clients: folder names), and a year or work folder above them only when it holds
// one: "probe" asks the caller to look inside.
export function access(parts: string[], who: { owner: boolean; clients: { has(name: string): boolean } | null }, order: FolderOrder, folder: boolean): "yes" | "no" | "probe" {
  if (parts.length && ownerOnly.has(parts[0])) return who.owner ? "yes" : "no";
  if (!who.clients || !parts.length) return "yes";
  const at = levels[order].client;
  if (parts.length > at) return who.clients.has(parts[at]) ? "yes" : "no";
  return folder ? "probe" : "no";
}

// The person's clients by the folder name InboxCA gives each (two clients may share one).
export function clientFolders(clients: { id: string; name: string }[]) {
  const folders = new Map<string, { id: string; name: string }[]>();
  for (const client of clients) {
    const name = safeName(client.name, 80);
    folders.set(name, [...(folders.get(name) ?? []), client]);
  }
  return folders;
}

// The kind of file, for its icon, by its extension.
export function kindOf(name: string) {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? "";
  if (extension === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return "sheet";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff"].includes(extension)) return "image";
  return extension === "json" ? "json" : "other";
}

// Files the viewer shows as pages.
export const viewable = (name: string) => /\.(pdf|png|jpe?g|gif|webp|xlsx?|csv|ods|json|txt|docx|odt)$/i.test(name);
