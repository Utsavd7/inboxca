import { describe, expect, it } from "vitest";
import { accessSetting, seenAt, seenCookie } from "@/src/lib/session";

describe("signing in limits", () => {
  it("take the person's own setting, else the role's, else the firm's", () => {
    const settings = { access: { idle_minutes: 30, roles: { staff: { idle_minutes: 15 } } } };
    expect(accessSetting(settings, "staff", { idle_minutes: 60 }, "idle_minutes")).toBe(60);
    expect(accessSetting(settings, "staff", null, "idle_minutes")).toBe(15);
    expect(accessSetting(settings, "manager", null, "idle_minutes")).toBe(30);
  });

  it("trust the last active time only from a cookie signed for that person", () => {
    const cookie = seenCookie("person-a", 1_000);
    expect(seenAt("person-a", cookie)).toBe(1_000);
    expect(seenAt("person-b", cookie)).toBe(0);
    expect(seenAt("person-a", cookie.replace("1000.", "9000."))).toBe(0);
    expect(seenAt("person-a", undefined)).toBe(0);
  });
});
