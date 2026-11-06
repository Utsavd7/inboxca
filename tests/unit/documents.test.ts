import { describe, expect, it } from "vitest";
import { describeFile, filePeriod, gstinFor, periodName, tdsChallanText, typeByContent } from "@/src/lib/documents";
import { receiveItem, type DocumentRequest } from "@/src/lib/checklists";

// Attachment names as clients send them, and where InboxCA files each one.
describe("what an attachment is", () => {
  const received = "2026-10-17T05:00:00Z";
  it.each([
    ["purchase_bills_sep_2026.pdf", "", "data_gst", { type: "Purchase bills", work: "gst", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["Sales-Sept-26.xlsx", "", "data_gst", { type: "Sales bills", work: "gst", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["Form16 FY 2025-26.pdf", "", "data_income_tax", { type: "Form 16", work: "income_tax", period: "2026", year: "FY 2025-26", sure: true }],
    ["26AS AY 2026-27.pdf", "", null, { type: "Form 26AS", work: "income_tax", period: "2026", year: "FY 2025-26", sure: true }],
    ["Form No. 130 FY 2026-27.pdf", "", null, { type: "Form 130", work: "income_tax", period: "2027", year: "FY 2026-27", sure: true }],
    ["employer.pdf", "Form No. 168 for A.Y. 2027-28", null, { type: "Form 168", work: "income_tax", period: "2027", year: "FY 2026-27", sure: true }],
    ["statement.pdf", "Bank statement for 03/2026", "data_tax_audit", { type: "Bank statement", work: "tax_audit", period: "2026-03", year: "FY 2025-26", sure: true }],
    ["scan001.pdf", "Market report", "other", { type: "Document", work: "other", period: "", year: "FY 2026-27", sure: false }],
    ["ledger.xlsx", "", "data_tax_audit", { type: "Ledger", work: "tax_audit", period: "", year: "FY 2026-27", sure: false }],
  ])("%s", (name, subject, label, expected) => {
    expect(describeFile(name, subject, label, received)).toEqual(expected);
  });
});

// TDS papers are filed under TDS for the quarter of the statement they are for.
describe("a TDS paper and its quarter", () => {
  const received = "2026-10-17T05:00:00Z";
  it.each([
    ["TDS_Register_Q2_2026-27.xlsx", "", { type: "TDS register", work: "tds", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["ITNS 281 challan Aug 2026.pdf", "", { type: "TDS challans", work: "tds", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["challan.pdf", "TDS challan for Jan-Mar 2027", { type: "TDS challans", work: "tds", period: "2027-03", year: "FY 2026-27", sure: true }],
    ["Salary register June 2026.xlsx", "", { type: "Salary register", work: "tds", period: "2026-06", year: "FY 2026-27", sure: true }],
    ["data.xlsx", "TDS register Q4 FY 2026-27", { type: "TDS register", work: "tds", period: "2027-03", year: "FY 2026-27", sure: true }],
    // A TCS register is read for Form No. 143 like a TDS register, never as sales.
    ["TCS register Q2 2026-27.xlsx", "TCS on scrap sales", { type: "TDS register", work: "tds", period: "2026-09", year: "FY 2026-27", sure: true }],
    // A TDS register with no quarter it names, or only a year, waits under To check.
    ["TDS register 2026-27.xlsx", "", { type: "TDS register", work: "tds", period: "", year: "FY 2026-27", sure: false }],
    // Not TDS papers: a GST challan, salary slips and an advance tax challan.
    ["GST challan Sep 2026.pdf", "", { type: "Challan", work: "other", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["salary slip sep 2026.pdf", "", { type: "Salary slips", work: "income_tax", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["ITNS 280 challan Sep 2026.pdf", "Advance tax", { type: "Challan", work: "other", period: "2026-09", year: "FY 2026-27", sure: true }],
  ])("%s", (name, subject, expected) => {
    expect(describeFile(name, subject, null, received)).toEqual(expected);
  });

  it("reads a challan receipt as a TDS challan by its form or minor head, and answers a request for any month of its quarter", () => {
    expect(tdsChallanText("Challan No./ITNS 281N\nTax Year 2026-27")).toBe(true);
    expect(tdsChallanText("Type of Payment (Minor Head) TDS/TCS Payable by Taxpayer (200)")).toBe(true);
    expect(tdsChallanText("Challan No./ITNS 280 Advance Tax (100)")).toBe(false);
    expect(describeFile("scan001.pdf", "Payment Sep 2026", null, received, "TDS challans")).toEqual({ type: "TDS challans", work: "tds", period: "2026-09", year: "FY 2026-27", sure: true });
    const ask = (): DocumentRequest => ({ period: "2026-08", items: [{ type: "TDS challans", work: "tds", received: [] }] });
    expect(receiveItem(ask(), "TDS challans", "2026-09", "doc1")).toBe(true);
    expect(receiveItem(ask(), "TDS challans", "2026-12", "doc1")).toBe(false);
    expect(periodName("2026-09", "tds")).toBe("Jul to Sep 2026");
  });
});

describe("a period in words", () => {
  it("names an income tax paper's year by its Act, while other work and drive file names keep FY", () => {
    expect(periodName("2026", "income_tax")).toBe("AY 2026-27 (FY 2025-26)");
    expect(periodName("2027", "gst", "income_tax")).toBe("Tax year 2026-27");
    expect(periodName("2027", "gst")).toBe("FY 2026-27");
    expect(periodName("2026-09")).toBe("Sep 2026");
    expect(filePeriod("2027")).toBe("FY 2026-27");
    expect(filePeriod("2026-09")).toBe("Sep 2026");
  });
});

describe("the GSTIN a paper is for", () => {
  it("is the only GSTIN, or the one chosen among several, for GST work only", () => {
    expect(gstinFor("gst", ["a"])).toBe("a");
    expect(gstinFor("gst", ["a", "b"], "b")).toBe("b");
    expect(gstinFor("gst", ["a", "b"])).toBeNull();
    expect(gstinFor("gst", ["a", "b"], "elsewhere")).toBeNull();
    expect(gstinFor("income_tax", ["a"], "a")).toBeNull();
    expect(gstinFor("gst", [])).toBeNull();
  });
});

// A PDF named as a tax paper by the email's words is typed by what is printed in it.
describe("a tax paper's type from its content", () => {
  const named = { type: "Form 16", sure: true };
  it("keeps a Form 16 that reads as one, takes the printed type over the words, and sends anything else to To check", () => {
    expect(typeByContent(named, { type: "Form 16" })).toEqual(named);
    expect(typeByContent(named, { type: "Form 130" })).toEqual({ type: "Form 130", sure: true });
    expect(typeByContent(named, null)).toEqual({ type: "Document", sure: false });
    for (const name of ["form16.pdf", "Form-16 Part B.pdf", "form 16.pdf", "FORM_16.pdf"]) expect(typeByContent(named, null, name), name).toEqual({ type: "Form 16", sure: false });
    expect(typeByContent({ type: "Form 130", sure: true }, null, "form130.pdf")).toEqual({ type: "Form 130", sure: false });
    expect(typeByContent(named, null, "statement.pdf")).toEqual({ type: "Document", sure: false });
    expect(typeByContent({ type: "Bank statement", sure: true }, null)).toEqual({ type: "Bank statement", sure: true });
  });
});
