import { beforeEach, expect, it, vi } from "vitest";

// Public sign up stops at its limits (PLAN.md 8.9) before it makes a login or sends a code:
// 10 codes an hour for one address, and 30 new firms an hour in all.
const mock = vi.hoisted(() => ({ withinLimit: true, signUpsThisHour: 0, createUser: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/src/lib/rate-limit", () => ({ withinLimit: async () => mock.withinLimit }));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ count: mock.signUpsThisHour }) }) }) }),
    auth: { admin: { createUser: mock.createUser } },
  }),
}));
import { signUp } from "@/app/(auth)/sign-up/actions";

const form = () => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ firm: "Shah and Co", email: "owner@shah.example", state: "27", accept: "on" })) data.set(name, value);
  return data;
};

beforeEach(() => {
  mock.withinLimit = true;
  mock.signUpsThisHour = 0;
  mock.createUser.mockReset();
});

it("refuses the 31st new firm in an hour", async () => {
  mock.signUpsThisHour = 30;
  expect((await signUp({}, form())).error).toBe("Sign up is busy right now. Try again in an hour.");
  expect(mock.createUser).not.toHaveBeenCalled();
});
