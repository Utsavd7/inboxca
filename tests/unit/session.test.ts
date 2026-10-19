import { describe, expect, it, vi } from "vitest";
import { accessSetting, seenAt, seenCookie, tellOwnerOnRepeat } from "@/src/lib/session";

const repeat = vi.hoisted(() => ({ count: 0, upsert: vi.fn() }));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({ from: () => ({
    select() { return this; }, eq() { return this; },
    gte: async () => ({ count: repeat.count }), upsert: repeat.upsert,
  }) }),
}));

describe("signing in limits", () => {
  it("take the person's own setting, else the role's, else the firm's", () => {
    const settings = { access: { idle_minutes: 30, roles: { staff: { idle_minutes: 15 } } } };
    expect(accessSetting(settings, "staff", { idle_minutes: 60 }, "idle_minutes")).toBe(60);
    expect(accessSetting(settings, "staff", null, "idle_minutes")).toBe(15);
    expect(accessSetting(settings, "manager", null, "idle_minutes")).toBe(30);
  });

  // #3, #4, #17: the browser cannot move its signed activity time forward.
  it("trust the last active time only from a cookie signed for that person", () => {
    const cookie = seenCookie("person-a", 1_000);
    expect(seenAt("person-a", cookie)).toBe(1_000);
    expect(seenAt("person-b", cookie)).toBe(0);
    expect(seenAt("person-a", cookie.replace("1000.", "9000."))).toBe(0);
    expect(seenAt("person-a", undefined)).toBe(0);
  });
});

// #39, #46, #53: repeats tell the owner, once per person and kind, from the third that day.
it("alerts on repeated sign ins, renames and captures, not the first two", async () => {
  for (const [action, reason] of [["session.ended_other", "parallel"], ["document.renamed", "renames"], ["capture_attempt", "captures"]]) {
    repeat.upsert.mockClear();
    repeat.count = 2;
    await tellOwnerOnRepeat("firm", "person", "ravi@firm.test", action, reason);
    expect(repeat.upsert).not.toHaveBeenCalled();
    repeat.count = 3;
    await tellOwnerOnRepeat("firm", "person", "ravi@firm.test", action, reason);
    expect(repeat.upsert).toHaveBeenCalledWith(expect.objectContaining({ firm_id: "firm", entity_id: "person", reason_code: reason, details: expect.objectContaining({ email: "ravi@firm.test", count: 3 }) }), { onConflict: "kind,entity_type,entity_id" });
  }
});
