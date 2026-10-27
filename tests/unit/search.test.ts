import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { firmCrypto, localKek } from "@/src/lib/crypto";
import { fingerprint, readText, words } from "@/src/lib/search";
import { pdf } from "@/tests/fixtures/pdf";
import { craft } from "@/tests/fixtures/zip";

describe("finding files by their words", () => {
  it("takes each word once, in any script, whatever its case", () => {
    expect(words("HDFC Loan sanction letter, loan no. 4411, ખરીદી बिल")).toEqual(["hdfc", "loan", "sanction", "letter", "no", "4411", "ખરીદી", "बिल"]);
  });
  it("reads the text inside a PDF, and nothing from a damaged one", async () => {
    expect(await readText("letter.pdf", pdf("HDFC loan sanction letter"))).toContain("HDFC loan sanction letter");
    expect(await readText("letter.pdf", new TextEncoder().encode("%PDF-1.4 broken"))).toBe("");
  });
});

describe("knowing the same paper saved again (D29)", () => {
  const keys = new Map<string, Buffer>();
  const crypto = firmCrypto(localKek(randomBytes(32)), { read: async (firm) => keys.get(firm) ?? null, write: async (firm, wrapped) => (keys.set(firm, wrapped), true) });
  const mark = async (name: string, bytes: Uint8Array, firm = "firm-a") => fingerprint(firm, await readText(name, bytes), crypto);
  const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const sheet = (...cells: string[]) => Buffer.from(`<worksheet><sheetData><row r="1">${cells.join("")}</row></sheetData></worksheet>`);
  // Two sheets of invented sales, written again (stored, not compressed) the way another program exports it.
  const workbook = (total: string, stored = false) =>
    craft([
      { name: "xl/worksheets/sheet1.xml", bytes: sheet(cell("A1", "Invented Traders"), cell("B1", "B2B")), stored },
      { name: "xl/worksheets/sheet2.xml", bytes: sheet(cell("A1", "Total"), cell("B1", total)), stored },
    ]);

  it("matches a re-saved PDF or workbook, and differs once a figure on any sheet changes", async () => {
    const bill = await mark("bill.pdf", pdf("Invented Traders bill 41 total 1,180.00"));
    expect(bill).toBeTruthy();
    expect(await mark("bill.pdf", pdf([[{ x: 72, y: 720, text: "Invented Traders bill 41" }, { x: 320, y: 720, text: "total 1,180.00" }]], 1, 64))).toBe(bill);
    expect(await mark("bill.pdf", pdf("Invented Traders bill 41 total 1,180.50"))).not.toBe(bill);
    const register = await mark("register.xlsx", workbook("1180"));
    expect(await mark("register.xlsx", workbook("1180", true))).toBe(register);
    expect(await mark("register.xlsx", workbook("1190"))).not.toBe(register);
    // Keyed with each firm's own key: the same paper in another firm is not known.
    expect(await mark("bill.pdf", pdf("Invented Traders bill 41 total 1,180.00"), "firm-b")).not.toBe(bill);
    // A scan or a damaged file has no text, so no fingerprint to match.
    expect(await mark("scan.pdf", new TextEncoder().encode("%PDF-1.4 broken"))).toBeNull();
  });
});
