import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { accessSetting, exceptionsOf, newRecoveryCodes, recoveryDigest, recoveryDigests, seenAt, seenCookie, tellOwnerOnRepeat } from "@/src/lib/session";

const repeat = vi.hoisted(() => ({ count: 0, upsert: vi.fn() }));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({ from: () => ({
    select() { return this; }, eq() { return this; },
    gte: async () => ({ count: repeat.count }), upsert: repeat.upsert,
  }) }),
}));
vi.stubEnv("APP_HMAC_KEY", randomBytes(32).toString("base64url"));

describe("signing in limits", () => {
  it("take the person's own setting, else the role's, else the firm's", () => {
    const settings = { access: { idle_minutes: 30, roles: { staff: { idle_minutes: 15 } } } };
    expect(accessSetting(settings, "staff", { idle_minutes: 60 }, "idle_minutes")).toBe(60);
    expect(accessSetting(settings, "staff", null, "idle_minutes")).toBe(15);
    expect(accessSetting(settings, "manager", null, "idle_minutes")).toBe(30);
  });

  // 5.17: every exception in force, a role's or a person's, with today's extra time only.
  it("list every exception a role or a person has, in plain words", () => {
    const settings = { access: { hours_only: true, roles: { partner: { hours_only: false, idle_minutes: 0 }, staff: {} } } };
    const people = [
      { user_id: "ravi", access: { session_hours: 8, always: ["download"], extra_time: { day: "2026-10-27", until: "19:30" } } },
      { user_id: "asha", access: { india_only: true, extra_time: { day: "2026-10-26", until: "20:00" } } },
      { user_id: "neha", access: null },
    ];
    expect(exceptionsOf(settings, people, "2026-10-27")).toEqual([
      { role: "partner", rule: "hours_only", words: "Can work outside office hours" },
      { role: "partner", rule: "idle_minutes", words: "Stays signed in when not in use" },
      { person: "ravi", rule: "session_hours", words: "Asked for the 2 step code again after 8 hours" },
      { person: "ravi", rule: "extra_time", words: "Extra time today, until 19:30" },
      { person: "asha", rule: "india_only", words: "From India only" },
    ]);
    expect(exceptionsOf({}, [], "2026-10-27")).toEqual([]);
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

// #23: ten different codes, each checked only for its own person, however it is typed.
it("makes ten recovery codes whose digests fit only their person", () => {
  const codes = newRecoveryCodes();
  expect(new Set(codes).size).toBe(10);
  expect(codes.every((code) => /^[A-Z2-9]{10}$/.test(code))).toBe(true);
  expect(recoveryDigest("owner", ` ${codes[0].toLowerCase()} `)).toBe(recoveryDigest("owner", codes[0]));
  expect(recoveryDigest("other", codes[0])).not.toBe(recoveryDigest("owner", codes[0]));
  expect(recoveryDigest("owner", codes[1])).not.toBe(recoveryDigest("owner", codes[0]));
});

// src/lib/env.ts: a new APP_HMAC_KEY must not lock an owner out while the key before is kept.
it("still takes a recovery code made with the key before, while APP_HMAC_OLD_KEY keeps it", () => {
  const [code] = newRecoveryCodes(), before = randomBytes(32).toString("base64url");
  vi.stubEnv("APP_HMAC_KEY", before);
  const kept = recoveryDigest("owner", code);
  vi.stubEnv("APP_HMAC_KEY", randomBytes(32).toString("base64url"));
  expect(recoveryDigests("owner", code)).not.toContain(kept);
  vi.stubEnv("APP_HMAC_OLD_KEY", before);
  expect(recoveryDigests("owner", code)).toContain(kept);
  expect(recoveryDigests("other", code)).not.toContain(kept);
  vi.stubEnv("APP_HMAC_OLD_KEY", "");
});
