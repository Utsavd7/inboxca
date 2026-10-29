import { describe, expect, it } from "vitest";
import { dueLabel, gstPortalTakes, periodLabel } from "@/src/lib/calendar";

describe("calendar labels", () => {
  it.each([
    ["monthly", "2026-09", "Sep 2026"],
    ["quarterly", "2026-03", "Jan to Mar 2026"],
    ["yearly", "2026-03", "FY 2025-26"],
    ["yearly", "2027-03", "Tax year 2026-27"],
  ])("names a %s period ending %s", (frequency, key, label) => expect(periodLabel(frequency, key)).toBe(label));
  it("shows a due date the same in every time zone", () => expect(dueLabel("2026-10-20")).toBe("20 Oct 2026"));
  // Three years after the month that follows the month's quarter, when every due date has passed.
  it.each([
    ["2023-07", "2026-10-31", true], ["2023-07", "2026-11-01", false], ["2023-09", "2026-10-31", true],
    ["2023-12", "2027-01-31", true], ["2023-12", "2027-02-01", false], ["2024-01", "2027-04-30", true],
  ])("offers GST month %s on %s: %s", (period, today, open) => expect(gstPortalTakes(period, today)).toBe(open));
});
