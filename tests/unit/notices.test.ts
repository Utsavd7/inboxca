import { describe, expect, it } from "vitest";
import { confirmers, readNotice, reviewBy } from "@/src/lib/notices";

// Invented notice texts; the rules find what a CA looks for first.
describe("the notice tracker", () => {
  it("reads the authority, type, reference and a date to reply by", () => {
    expect(readNotice("Notice under section 148 of the Income-tax Act. DIN: ITBA/AST/F/148/2026-27/1050012345(1). Please respond on or before 25/10/2026.", "2026-10-17")).toEqual({
      authority: "income_tax",
      type: "Notice u/s 148",
      reference: "ITBA/AST/F/148/2026-27/1050012345",
      suggested: "2026-10-25",
    });
    expect(readNotice("Form GST DRC-01 for GSTIN 24AAPFM1234K1Z8. Reply within 30 days.", "2026-10-17")).toMatchObject({ authority: "gst", type: "DRC-01", suggested: "2026-11-16" });
    expect(readNotice("Please see the attached letter.", "2026-10-17")).toEqual({ authority: "other", type: "Other", reference: "", suggested: "" });
  });
  it("sets the firm's review deadline in working days, skipping Sundays and holidays", () => {
    expect(reviewBy("2026-10-17")).toBe("2026-10-19");
    expect(reviewBy("2026-10-16", 1, ["2026-10-17"])).toBe("2026-10-19");
    expect(reviewBy("2026-10-14", 2)).toBe("2026-10-16");
  });

  it("names who confirmed a date: the confirmation, else whoever added the notice with it", () => {
    const by = confirmers([
      { entity_id: "a", action: "notice.added", actor_id: "staff" },
      { entity_id: "a", action: "notice.date_confirmed", actor_id: "manager" },
      { entity_id: "b", action: "notice.added", actor_id: "owner" },
    ]);
    expect(Object.fromEntries(by)).toEqual({ a: "manager", b: "owner" });
  });
});
