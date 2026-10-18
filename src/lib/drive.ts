import { link, mkdir, readdir, readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// The firm's own drive (PLAN.md 5.5.1, D36): one interface for every provider. Paths are
// below InboxCA's own folder in the drive. Saving never overwrites: a name already taken
// is refused, and the caller picks another.
export interface Drive {
  ensureFolder(folders: string[]): Promise<string>;
  save(folderId: string, name: string, bytes: Uint8Array): Promise<{ id: string } | "taken">;
  read(fileId: string): Promise<Uint8Array>;
  // Moves a file to another folder or name, refusing a name already taken.
  move(fileId: string, folderId: string, name: string): Promise<{ id: string } | "taken">;
  // Sends a file to the drive's own bin, where the drive's rules then apply.
  trash(fileId: string): Promise<void>;
  // The daily check: every file in InboxCA's folder, whether the folder is shared with
  // anyone or has a link, and the free space (null when the drive does not say).
  check(): Promise<{ files: { id: string; path: string }[]; shared: boolean; freeBytes: number | null }>;
  // For the first import: the drive's own top folders outside InboxCA's, and every file
  // under one of them with its size.
  folders(): Promise<string[]>;
  files(folder: string): Promise<{ id: string; path: string; size: number }[]>;
}

// InboxCA's own folder in the drive, as on Dropbox.
const OWN = "InboxCA";

// Where a removed file waits 30 days before it goes to the drive's bin.
export const DELETED_FOLDER = "Deleted and old versions";

// A test drive in a folder on this computer, for development and the tests only
// (DRIVE_LOCAL_DIR). No deployment sets it.
export function localDrive(root = process.env.DRIVE_LOCAL_DIR ?? ""): Drive {
  if (!root) throw new Error("DRIVE_LOCAL_DIR is not set");
  const inside = (relative: string) => {
    const full = path.resolve(root, relative);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("outside the test drive");
    return full;
  };
  return {
    async ensureFolder(folders) {
      const relative = path.join(OWN, ...folders);
      // InboxCA makes folders only inside its own.
      if (relative !== OWN && !relative.startsWith(OWN + path.sep)) throw new Error("outside the test drive");
      await mkdir(inside(relative), { recursive: true });
      return relative;
    },
    async save(folderId, name, bytes) {
      const relative = path.join(folderId, name);
      try {
        await writeFile(inside(relative), bytes, { flag: "wx" });
        return { id: relative };
      } catch (error) {
        if ((error as { code?: string }).code === "EEXIST") return "taken";
        throw error;
      }
    },
    read: (fileId) => readFile(inside(fileId)),
    async move(fileId, folderId, name) {
      const relative = path.join(folderId, name);
      // A hard link then an unlink, so a taken name is refused rather than replaced.
      try {
        await link(inside(fileId), inside(relative));
      } catch (error) {
        if ((error as { code?: string }).code === "EEXIST") return "taken";
        throw error;
      }
      await unlink(inside(fileId));
      return { id: relative };
    },
    trash: (fileId) => unlink(inside(fileId)),
    async check() {
      await mkdir(inside(OWN), { recursive: true });
      const files = (await this.files(OWN)).map(({ id, path }) => ({ id, path }));
      const space = await statfs(root);
      return { files, shared: false, freeBytes: space.bavail * space.bsize };
    },
    async folders() {
      const entries = await readdir(root, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory() && entry.name !== OWN).map((entry) => entry.name);
    },
    async files(folder) {
      const entries = await readdir(inside(folder), { recursive: true, withFileTypes: true });
      return Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const relative = path.relative(root, path.join(entry.parentPath, entry.name));
            return { id: relative, path: relative, size: (await stat(inside(relative))).size };
          }),
      );
    },
  };
}

// The version of the Drive access terms (the Terms' "Drive access" section) an owner
// agrees to at Connect. A change that widens what InboxCA does needs a new tick.
export const DRIVE_TERMS_VERSION = "2026-10-17";

export const workTypes = {
  gst: "GST",
  income_tax: "Income tax",
  tax_audit: "Tax audit",
  audit: "Audit",
  roc: "ROC",
  other: "Other",
} as const;
export type WorkType = keyof typeof workTypes;

// "FY 2026-27" for a period ending in any month from April 2026 to March 2027.
export function financialYear(periodKey: string) {
  const year = Number(periodKey.slice(0, 4));
  const start = Number(periodKey.slice(5, 7)) >= 4 ? year : year - 1;
  return `FY ${start}-${String(start + 1).slice(2)}`;
}

// A name every provider accepts: no characters OneDrive or Dropbox refuse, no leading or
// trailing dots and spaces, Unicode in one form, and short enough for deep paths.
export function safeName(name: string, max = 120) {
  const clean = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\\/:*?"<>|#%]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return clean.slice(0, max).trim() || "Untitled";
}

// Folders: Financial year / Client / Work type (the default, 17 Oct 2026); a firm may
// reorder the three in Settings.
export const folderOrders = ["year_client_work", "work_year_client", "client_year_work"] as const;
export type FolderOrder = (typeof folderOrders)[number];
export const folderOrderNames: Record<FolderOrder, string> = {
  year_client_work: "Year, client, work: FY 2026-27 / Patel Textiles / GST",
  work_year_client: "Work, year, client: GST / FY 2026-27 / Patel Textiles",
  client_year_work: "Client, year, work: Patel Textiles / FY 2026-27 / GST",
};
export function folderPath(order: FolderOrder, year: string, client: string, work: WorkType) {
  const parts = { year, client: safeName(client, 80), work: workTypes[work] };
  const sequence = { year_client_work: ["year", "client", "work"], work_year_client: ["work", "year", "client"], client_year_work: ["client", "year", "work"] }[order];
  return sequence.map((part) => parts[part as keyof typeof parts]);
}

// "Patel Textiles - Purchase bills - Sep 2026.pdf"; the received date, a version or a
// short id is added only when the plain name is already taken.
export function fileName(parts: { client: string; type: string; period: string; extension: string; suffix?: string }) {
  const base = [parts.client, parts.type, parts.period, parts.suffix].filter(Boolean).join(" - ");
  const extension = parts.extension.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
  return safeName(base, 150) + (extension ? `.${extension}` : "");
}
