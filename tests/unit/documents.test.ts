import { describe, expect, it } from "vitest";
import { describeFile } from "@/src/lib/documents";

// Attachment names as clients send them, and where InboxCA files each one.
describe("what an attachment is", () => {
  const received = "2026-10-17T05:00:00Z";
  it.each([
    ["purchase_bills_sep_2026.pdf", "", "data_gst", { type: "Purchase bills", work: "gst", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["Sales-Sept-26.xlsx", "", "data_gst", { type: "Sales bills", work: "gst", period: "2026-09", year: "FY 2026-27", sure: true }],
    ["Form16 FY 2025-26.pdf", "", "data_income_tax", { type: "Form 16", work: "income_tax", period: "2026", year: "FY 2025-26", sure: true }],
    ["26AS AY 2026-27.pdf", "", null, { type: "Form 26AS", work: "income_tax", period: "2026", year: "FY 2025-26", sure: true }],
    ["statement.pdf", "Bank statement for 03/2026", "data_tax_audit", { type: "Bank statement", work: "tax_audit", period: "2026-03", year: "FY 2025-26", sure: true }],
    ["scan001.pdf", "Market report", "other", { type: "Document", work: "other", period: "", year: "FY 2026-27", sure: false }],
    ["ledger.xlsx", "", "data_tax_audit", { type: "Ledger", work: "tax_audit", period: "", year: "FY 2026-27", sure: false }],
  ])("%s", (name, subject, label, expected) => {
    expect(describeFile(name, subject, label, received)).toEqual(expected);
  });
});
