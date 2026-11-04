import { describe, expect, it } from "vitest";
import { dueLabel, gstPortalTakes, periodLabel, yearName } from "@/src/lib/calendar";

describe("calendar labels", () => {
  it.each([
    ["monthly", "2026-09", "", "Sep 2026"],
    ["quarterly", "2026-03", "", "Jan to Mar 2026"],
    ["yearly", "2026-03", "GSTR9", "FY 2025-26"],
    ["yearly", "2027-03", "AOC4", "FY 2026-27"],
    ["yearly", "2026-03", "ITR_NA", "AY 2026-27 (FY 2025-26)"],
    ["yearly", "2027-03", "TAX_AUDIT", "Tax year 2026-27"],
  ])("names a %s period ending %s for %s", (frequency, key, code, label) => expect(periodLabel(frequency, key, code)).toBe(label));
  // Income to 31 March 2026 is assessed under the Income-tax Act, 1961 (an assessment year); from
  // 1 April 2026 the Income-tax Act, 2025 has only the tax year. GST, TDS and ROC keep the FY.
  it("names a year by the law it falls under", () => {
    expect(["2025", "2026", "2027", "2028"].map((key) => yearName(key, true))).toEqual(["AY 2025-26 (FY 2024-25)", "AY 2026-27 (FY 2025-26)", "Tax year 2026-27", "Tax year 2027-28"]);
    expect(["2026", "2027"].map((key) => yearName(key))).toEqual(["FY 2025-26", "FY 2026-27"]);
  });
  it("shows a due date the same in every time zone", () => expect(dueLabel("2026-10-20")).toBe("20 Oct 2026"));
  // Three years after the month that follows the month's quarter, when every due date has passed.
  it.each([
    ["2023-07", "2026-10-31", true], ["2023-07", "2026-11-01", false], ["2023-09", "2026-10-31", true],
    ["2023-12", "2027-01-31", true], ["2023-12", "2027-02-01", false], ["2024-01", "2027-04-30", true],
  ])("offers GST month %s on %s: %s", (period, today, open) => expect(gstPortalTakes(period, today)).toBe(open));
});
