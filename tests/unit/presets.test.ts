import { describe, expect, it } from "vitest";
import { firmAdmin } from "@/src/lib/office";
import { presetOf, presets, type Preset } from "@/src/lib/presets";

describe("access presets (5.17)", () => {
  it("start a new firm on Standard and find each preset from the rules it sets", () => {
    expect(presetOf({})).toBe("standard");
    for (const key of Object.keys(presets) as Preset[]) {
      const { office, away, hours_only, idle_minutes, india_only } = presets[key];
      expect(presetOf({ office: { on: office, away }, access: { hours_only, idle_minutes: idle_minutes || undefined, india_only } })).toBe(key);
    }
  });

  it("match no preset once a rule is changed by hand", () => {
    expect(presetOf({ office: { on: true, away: false }, access: { hours_only: true, idle_minutes: 30 } })).toBeUndefined();
    // A firm that switched Office only on before presets still lets staff ask to work away.
    expect(presetOf({ office: { on: true }, access: { hours_only: true, idle_minutes: 15 } })).toBe("office_remote");
    // Remote friendly without India only is a rule changed by hand.
    expect(presetOf({ access: { hours_only: true } })).toBeUndefined();
  });
});

// #22: only the owner, or the one deputy named co-admin.
it("names the owner and the co-admin deputy as admins, nobody else", () => {
  const settings = { office: { deputies: ["ravi", "asha"], co_admin: "ravi" } };
  expect(firmAdmin("owner", "owner", settings)).toBe(true);
  expect(firmAdmin("partner", "ravi", settings)).toBe(true);
  expect(firmAdmin("partner", "asha", settings)).toBe(false);
  expect(firmAdmin("manager", "ravi", settings)).toBe(false);
  expect(firmAdmin("partner", "ravi", { office: { deputies: ["asha"], co_admin: "ravi" } })).toBe(false);
});
