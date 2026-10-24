import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "@/src/lib/content-hash";
import { fileName, financialYear, folderPath, INCOMING, incomingPath, localDrive, safeName } from "@/src/lib/drive";

describe("the firm's drive", () => {
  it("files by financial year, client and work, or in the firm's own order", () => {
    expect(financialYear("2026-09")).toBe("FY 2026-27");
    expect(financialYear("2027-03")).toBe("FY 2026-27");
    expect(folderPath("year_client_work", "FY 2026-27", "Patel Textiles", "gst")).toEqual(["FY 2026-27", "Patel Textiles", "GST"]);
    expect(folderPath("work_year_client", "FY 2026-27", "Patel Textiles", "gst")).toEqual(["GST", "FY 2026-27", "Patel Textiles"]);
  });
  it("names a file the same way every time, with nothing a drive refuses", () => {
    expect(fileName({ client: "Patel Textiles", type: "Purchase bills", period: "Sep 2026", extension: "PDF" })).toBe("Patel Textiles - Purchase bills - Sep 2026.pdf");
    expect(fileName({ client: "Patel Textiles", type: "Purchase bills", period: "Sep 2026", extension: "pdf", suffix: "4 Oct 2026" })).toBe(
      "Patel Textiles - Purchase bills - Sep 2026 - 4 Oct 2026.pdf",
    );
    expect(fileName({ client: "Patel Textiles", type: "Purchase bills", period: "Sep 2026", extension: "pdf" }, "period_type_client")).toBe("Sep 2026 - Purchase bills - Patel Textiles.pdf");
    expect(safeName(' A/B: "Shah & Sons" | <Ltd>. ')).toBe("A B Shah & Sons Ltd");
  });
  it("never overwrites a file, and never leaves its own folder", async () => {
    const drive = localDrive(await mkdtemp(path.join(tmpdir(), "drive-")));
    const folder = await drive.ensureFolder(["FY 2026-27", "Patel Textiles", "GST"]);
    expect(await drive.save(folder, "bills.pdf", new Uint8Array([1]))).toEqual({ id: path.join(folder, "bills.pdf") });
    expect(await drive.save(folder, "bills.pdf", new Uint8Array([2]))).toBe("taken");
    expect([...(await drive.read(path.join(folder, "bills.pdf")))]).toEqual([1]);
    await drive.save(folder, "sales.pdf", new Uint8Array([3]));
    expect(await drive.move(path.join(folder, "sales.pdf"), folder, "bills.pdf")).toBe("taken");
    const checked = await drive.ensureFolder(["FY 2026-27", "Patel Textiles", "GST", "To check"]);
    expect(await drive.move(path.join(folder, "sales.pdf"), checked, "sales.pdf")).toEqual({ id: path.join(checked, "sales.pdf") });
    await expect(drive.ensureFolder(["..", "outside"])).rejects.toThrow("outside the test drive");
  });
  it("checks a file sent from a disk by the drive's own checksum, and keeps it inside Incoming", async () => {
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
    const small = new Uint8Array([1, 2, 3]);
    expect(await contentHash(new Blob([small]))).toBe(createHash("sha256").update(sha(small)).digest("hex"));
    // Dropbox's checksum works on 4 MB blocks.
    const large = new Uint8Array(4 * 1024 * 1024 + 1).fill(7);
    expect(await contentHash(new Blob([large]))).toBe(createHash("sha256").update(Buffer.concat([sha(large.subarray(0, 4 * 1024 * 1024)), sha(large.subarray(4 * 1024 * 1024))])).digest("hex"));

    expect(incomingPath("../Old files//Patel: Sons/ITR-V.pdf")).toBe("Untitled/Old files/Patel Sons/ITR-V.pdf");
    const drive = localDrive(await mkdtemp(path.join(tmpdir(), "drive-")));
    expect(await drive.folders()).toEqual([]);
    expect(await drive.incomingFile("Old files/ITR-V.pdf")).toBeNull();
    await drive.save(await drive.ensureFolder([INCOMING, "Old files"]), "ITR-V.pdf", small);
    expect(await drive.incomingFile("Old files/ITR-V.pdf")).toEqual({ id: path.join("InboxCA", "Incoming", "Old files", "ITR-V.pdf"), hash: await contentHash(new Blob([small])) });
    expect(await drive.folders()).toEqual([path.join("InboxCA", "Incoming")]);
  });
});

it("refuses oversized local viewer files before reading their contents", async () => {
  const { rm } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "viewer-drive-"));
  let reads = 0;
  try {
    const drive = localDrive(root, () => reads++, 2);
    const folder = await drive.ensureFolder(["Invented"]);
    const saved = await drive.save(folder, "small.pdf", new Uint8Array([1, 2, 3]));
    if (saved === "taken") throw new Error("Unexpected fixture");
    await expect(drive.read(saved.id)).rejects.toThrow("File too large");
    expect(reads).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
