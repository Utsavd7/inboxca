import { promises as dns } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectSettings } from "@/src/lib/mailbox";

// Finding a mailbox's servers from its address, with DNS and the web mocked.
vi.mock("node:dns", () => ({ promises: { resolveMx: vi.fn(), lookup: vi.fn() } }));
const resolveMx = vi.mocked(dns.resolveMx);
const lookup = vi.mocked(dns.lookup) as unknown as ReturnType<typeof vi.fn>;
const fetch = vi.fn();
const mx = (...hosts: string[]) => resolveMx.mockResolvedValue(hosts.map((exchange) => ({ exchange, priority: 10 })));

beforeEach(() => {
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValue(new Response("", { status: 404 }));
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mx();
});
afterEach(() => vi.resetAllMocks());

describe("finding a mailbox's servers", () => {
  it("never asks a domain on a private network, and falls back to the usual names", async () => {
    lookup.mockImplementation(async (host: string) => [{ address: host === "autoconfig.thunderbird.net" ? "93.184.216.34" : "10.0.0.5", family: 4 }]);
    expect(await detectSettings("office@inside.test")).toEqual({ imap: { host: "imap.inside.test", port: 993 }, smtp: { host: "smtp.inside.test", port: 465 } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://autoconfig.thunderbird.net/v1.1/inside.test"]);
  });
});
