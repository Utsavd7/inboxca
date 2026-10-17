import { describe, expect, it } from "vitest";
import { dueLabel, periodLabel } from "@/src/lib/calendar";

describe("calendar labels", () => {
  it.each([
    ["monthly", "2026-09", "Sep 2026"],
    ["quarterly", "2026-03", "Jan to Mar 2026"],
    ["yearly", "2026-03", "FY 2025-26"],
  ])("names a %s period ending %s", (frequency, key, label) => expect(periodLabel(frequency, key)).toBe(label));
  it("shows a due date the same in every time zone", () => expect(dueLabel("2026-10-20")).toBe("20 Oct 2026"));
});
