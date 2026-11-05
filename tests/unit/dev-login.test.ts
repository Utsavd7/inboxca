import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/dev/switch/route";
import { demoEmail, devLoginOpen } from "@/src/lib/dev-login";

// The developer preview's person switcher must never open outside a developer's own laptop.
const local = { DEV_LOGIN: "1", SUPABASE_URL: "http://127.0.0.1:54321", NODE_ENV: "production" };
const post = (host: string, role: string) =>
  POST(new NextRequest(`http://${host}/dev/switch`, { method: "POST", headers: { host, origin: `http://${host}` }, body: new URLSearchParams({ role }) }));

afterEach(() => vi.unstubAllEnvs());

describe("developer person switcher", () => {
  it("opens only with DEV_LOGIN, the local Supabase and a request to this laptop", () => {
    expect(devLoginOpen(local, "127.0.0.1:3300")).toBe(true);
    expect(devLoginOpen({ ...local, DEV_LOGIN: undefined }, "127.0.0.1:3300")).toBe(false);
    expect(devLoginOpen({ ...local, SUPABASE_URL: "https://abcd.supabase.co" }, "127.0.0.1:3300")).toBe(false);
    expect(devLoginOpen(local, "app.inboxca.in")).toBe(false);
    expect(devLoginOpen(local, "127.0.0.1:3300", "https://elsewhere.example")).toBe(false);
  });

  it("is not found for a request to another host, even with DEV_LOGIN and the local Supabase", async () => {
    for (const [name, value] of Object.entries(local)) vi.stubEnv(name, value);
    expect((await post("app.inboxca.in", "owner")).status).toBe(404);
  });

  it("signs in only the demo people, never another address", async () => {
    for (const [name, value] of Object.entries(local)) vi.stubEnv(name, value);
    expect(demoEmail("partner")).toBe("nikhil.partner@demo.inboxca.test");
    expect(demoEmail("someone@firm.example")).toBeNull();
    expect(demoEmail("toString")).toBeNull();
    expect((await post("127.0.0.1:3300", "someone@firm.example")).status).toBe(404);
  });
});
