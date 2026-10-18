import { describe, expect, it } from "vitest";
import { askedPaper, isRoutine, pickPaper } from "@/src/lib/records";

const papers = [
  { id: "itrv-25", document_type: "ITR-V", period_key: "2025", status: "filed" },
  { id: "itrv-26", document_type: "ITR-V", period_key: "2026", status: "filed" },
  { id: "bs-26", document_type: "Balance sheet", period_key: "2026", status: "filed" },
  { id: "3b-sep", document_type: "GSTR-3B", period_key: "2026-09", status: "filed" },
  { id: "3b-sep-2", document_type: "GSTR-3B", period_key: "2026-09", status: "to_check" },
];

describe("the records auto-reply", () => {
  it("reads the paper and the year a client asks for", () => {
    expect(askedPaper("ITR", "Please send my ITR for AY 2025-26")).toEqual({ types: ["ITR-V", "Acknowledgement"], period: "2025" });
    expect(askedPaper("Need financial statements", "for FY 2025-26 for the bank")).toEqual({ types: ["Balance sheet"], period: "2026" });
    expect(askedPaper("Hello", "Can we meet?").types).toEqual([]);
  });
  it("picks the one filed paper for that year, or the newest when no year is named", () => {
    expect(pickPaper(papers, { types: ["ITR-V", "Acknowledgement"], period: "2025" })).toEqual({ document: papers[0] });
    expect(pickPaper(papers, { types: ["ITR-V", "Acknowledgement"], period: "" })).toEqual({ document: papers[1] });
    // September 2026 is in FY 2026-27, the year ending March 2027.
    expect(pickPaper(papers, { types: ["GSTR-3B"], period: "2027" })).toEqual({ document: papers[3] });
    expect(pickPaper(papers, { types: ["Audit report"], period: "" })).toEqual({ reason: "record_not_found" });
  });
  it("sends routine papers at once and keeps private ones for approval, as the owner sets", () => {
    expect(isRoutine("ITR-V")).toBe(true);
    expect(isRoutine("Balance sheet")).toBe(false);
    expect(isRoutine("Balance sheet", { routine: ["Balance sheet"] })).toBe(true);
    expect(isRoutine("ITR-V", { approve_all: true })).toBe(false);
  });
});
