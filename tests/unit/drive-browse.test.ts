import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DELETED_FOLDER, INCOMING, localDrive } from "@/src/lib/drive";
import { access, clientFolders, parsePath, placeOf } from "@/src/lib/drive-browse";

describe("the folder view's paths", () => {
  it("reads a folder path from the address, and refuses one that leaves its folder", () => {
    expect(parsePath(null)).toEqual([]);
    expect(parsePath("FY 2026-27/Patel Textiles/GST")).toEqual(["FY 2026-27", "Patel Textiles", "GST"]);
    for (const bad of ["../secrets", "FY 2026-27/../x", "FY 2026-27//GST", "a\\b", "a/./b", "x\u0000y", Array(13).fill("a").join("/")]) expect(parsePath(bad), bad).toBeNull();
  });
  it("knows the client and the work of a path in each folder order", () => {
    expect(placeOf(["FY 2026-27", "Patel Textiles", "GST", "To check"], "year_client_work")).toEqual({ client: "Patel Textiles", work: "gst" });
    expect(placeOf(["FY 2026-27"], "year_client_work")).toEqual({ client: null, work: null });
    expect(placeOf(["Income tax", "FY 2026-27", "Patel Textiles"], "work_year_client")).toEqual({ client: "Patel Textiles", work: "income_tax" });
    expect(placeOf(["Patel Textiles", "FY 2026-27", "Notes"], "client_year_work")).toEqual({ client: "Patel Textiles", work: null });
  });
});

describe("who sees which folders", () => {
  const owner = { owner: true, clients: null };
  const partner = { owner: false, clients: null };
  const staff = { owner: false, clients: clientFolders([{ id: "c1", name: "Patel Textiles" }, { id: "c2", name: 'A/B: "Shah" Traders' }]) };
  it("shows someone who sees every client the whole folder but the owner's own two", () => {
    expect(access(["FY 2026-27", "Mehta Exports", "GST"], partner, "year_client_work", true)).toBe("yes");
    expect(access(["scan.pdf"], partner, "year_client_work", false)).toBe("yes");
    for (const folder of [INCOMING, DELETED_FOLDER]) {
      expect(access([folder], partner, "year_client_work", true)).toBe("no");
      expect(access([folder, "old.pdf"], partner, "year_client_work", false)).toBe("no");
      expect(access([folder, "old.pdf"], owner, "year_client_work", false)).toBe("yes");
    }
  });
  it("shows restricted staff only their clients' folders, and a year or work folder only when it holds one", () => {
    expect(access([], staff, "year_client_work", true)).toBe("yes");
    expect(access(["FY 2026-27", "Patel Textiles", "GST", "bills.pdf"], staff, "year_client_work", false)).toBe("yes");
    // The client's folder by InboxCA's own name for it.
    expect(access(["FY 2026-27", "A B Shah Traders"], staff, "year_client_work", true)).toBe("yes");
    expect(access(["FY 2026-27", "Mehta Exports"], staff, "year_client_work", true)).toBe("no");
    expect(access(["FY 2026-27", "Mehta Exports", "GST", "bills.pdf"], staff, "year_client_work", false)).toBe("no");
    expect(access(["FY 2026-27"], staff, "year_client_work", true)).toBe("probe");
    expect(access(["GST", "FY 2026-27"], staff, "work_year_client", true)).toBe("probe");
    expect(access(["GST", "FY 2026-27", "Patel Textiles"], staff, "work_year_client", true)).toBe("yes");
    // A file put by hand above the client folders belongs to no client the staff member has.
    expect(access(["FY 2026-27", "scan.pdf"], staff, "year_client_work", false)).toBe("no");
    expect(access(["Patel Textiles"], staff, "client_year_work", true)).toBe("yes");
    expect(access([INCOMING], staff, "year_client_work", true)).toBe("no");
  });
});

it("lists one folder of the test drive a page at a time, folders and files with their size", async () => {
  const drive = localDrive(await mkdtemp(path.join(tmpdir(), "drive-")));
  expect(await drive.list("")).toEqual({ entries: [], cursor: null });
  const folder = await drive.ensureFolder(["FY 2026-27", "Patel Textiles", "GST"]);
  await drive.save(folder, "b.pdf", new Uint8Array([1, 2, 3]));
  await drive.save(folder, "a.pdf", new Uint8Array([1]));
  await drive.ensureFolder(["FY 2026-27", "Patel Textiles", "GST", "To check"]);
  const first = await drive.list("FY 2026-27/Patel Textiles/GST", undefined, 2);
  expect(first.entries.map(({ name, path, folder, size }) => ({ name, path, folder, size }))).toEqual([
    { name: "To check", path: "FY 2026-27/Patel Textiles/GST/To check", folder: true, size: 0 },
    { name: "a.pdf", path: "FY 2026-27/Patel Textiles/GST/a.pdf", folder: false, size: 1 },
  ]);
  expect(first.entries[1].id).toBe(path.join(folder, "a.pdf"));
  const next = await drive.list("FY 2026-27/Patel Textiles/GST", first.cursor!, 2);
  expect(next.entries.map((entry) => entry.name)).toEqual(["b.pdf"]);
  expect(next.cursor).toBeNull();
  await expect(drive.list("../..")).rejects.toThrow("outside the test drive");
});
