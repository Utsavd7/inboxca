import { beforeEach, expect, it, vi } from "vitest";

// Public sign up stops at its limits (PLAN.md 8.9) before it makes a login or sends a code:
// 10 codes an hour for one address, 10 sign ups an hour from one internet address, and 30 new
// firms an hour in all. And it makes no firm until the email code proves the address.
const mock = vi.hoisted(() => ({ limits: {} as Record<string, boolean>, ip: "", signUpsThisHour: 0, createUser: vi.fn(), rpc: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mock.ip ? { "cf-connecting-ip": mock.ip } : {}),
  cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }),
}));
vi.mock("@/src/lib/rate-limit", () => ({ withinLimit: async (kind: string) => mock.limits[kind] ?? true }));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ count: mock.signUpsThisHour }) }) }) }),
    auth: { admin: { createUser: mock.createUser } },
    rpc: mock.rpc,
  }),
  supabaseServer: async () => ({ auth: { signInWithOtp: async () => ({ error: null }) } }),
}));
import { signUp } from "@/app/(auth)/sign-up/actions";

const form = () => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ firm: "Shah and Co", email: "owner@shah.example", state: "27", accept: "on" })) data.set(name, value);
  return data;
};

beforeEach(() => {
  mock.limits = {};
  mock.ip = "";
  mock.signUpsThisHour = 0;
  mock.createUser.mockReset();
  mock.rpc.mockReset();
});

it("refuses the 31st new firm in an hour", async () => {
  mock.signUpsThisHour = 30;
  expect((await signUp({}, form())).error).toBe("Sign up is busy right now. Try again in an hour.");
  expect(mock.createUser).not.toHaveBeenCalled();
});

it("refuses a visitor past the sign ups of their internet address, so no one blocks every sign up", async () => {
  mock.ip = "203.0.113.7";
  mock.limits.signUp = false;
  expect((await signUp({}, form())).error).toBeTruthy();
  expect(mock.createUser).not.toHaveBeenCalled();
});

it("sends the code and makes no firm until the code proves the address", async () => {
  mock.createUser.mockResolvedValue({ data: { user: { id: "new-owner" } }, error: null });
  expect(await signUp({}, form())).toEqual({ email: "owner@shah.example" });
  expect(mock.rpc).not.toHaveBeenCalled();
});
