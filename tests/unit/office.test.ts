import { describe, expect, it } from "vitest";
import { ipv6Prefix, lineFor, onOfficeLine } from "@/src/lib/office";

describe("the office connection", () => {
  it("matches IPv4 exactly and IPv6 by its /64, however it is written", () => {
    expect(ipv6Prefix("2001:0db8:000a:000b:1:2:3:4")).toBe("2001:db8:a:b");
    expect(ipv6Prefix("2001:db8:a:b::1")).toBe("2001:db8:a:b");
    expect(ipv6Prefix("2001:db8::1")).toBe("2001:db8:0:0");
    expect(ipv6Prefix("203.0.113.10")).toBe("");
    const office = { on: true, lines: [lineFor("203.0.113.10", "2026-10-19")!, lineFor("2001:db8:a:b::7", "2026-10-19")!] };
    expect(onOfficeLine("203.0.113.10", office)).toBe(true);
    expect(onOfficeLine("203.0.113.11", office)).toBe(false);
    expect(onOfficeLine("2001:db8:a:b:ffff::9", office)).toBe(true);
    expect(onOfficeLine("2001:db8:a:c::9", office)).toBe(false);
    expect(onOfficeLine("", office)).toBe(false);
  });
});
