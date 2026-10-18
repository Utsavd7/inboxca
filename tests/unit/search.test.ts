import { describe, expect, it } from "vitest";
import { readText, words } from "@/src/lib/search";
import { pdf } from "@/tests/fixtures/pdf";

describe("finding files by their words", () => {
  it("takes each word once, in any script, whatever its case", () => {
    expect(words("HDFC Loan sanction letter, loan no. 4411, ખરીદી बिल")).toEqual(["hdfc", "loan", "sanction", "letter", "no", "4411", "ખરીદી", "बिल"]);
  });
  it("reads the text inside a PDF, and nothing from a damaged one", async () => {
    expect(await readText("letter.pdf", pdf("HDFC loan sanction letter"))).toContain("HDFC loan sanction letter");
    expect(await readText("letter.pdf", new TextEncoder().encode("%PDF-1.4 broken"))).toBe("");
  });
});
