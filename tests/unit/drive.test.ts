import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileName, financialYear, folderPath, localDrive, safeName } from "@/src/lib/drive";

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
});
