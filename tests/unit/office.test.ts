import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionRule, ipv6Prefix, lineFor, onOfficeLine, requestLine } from "@/src/lib/office";

afterEach(() => vi.unstubAllEnvs());

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
  it("learns a new half only with a confirmed half on the same request", () => {
    const office = { lines: [{ ipv4: "203.0.113.10", ipv6: "2001:db8:a:b", confirmed_on: "2026-10-19" }] };
    expect(connectionRule({ ipv4: "203.0.113.11", ipv6: "2001:db8:a:b", confirmed_on: "" }, office, "laptop")).toBe("known");
    expect(connectionRule({ ipv4: "203.0.113.10", ipv6: "2001:db8:a:c", confirmed_on: "" }, office, "laptop")).toBe("known");
    expect(connectionRule({ ipv4: "203.0.113.11", ipv6: "2001:db8:a:c", confirmed_on: "" }, office, "laptop")).toBe("waiting");
  });
  it("never lets laptops confirm new connections or reuse expired approvals", () => {
    const line = { ipv4: "203.0.113.10", confirmed_on: "2026-10-19" };
    expect(connectionRule(line, {}, "laptop")).toBe("waiting");
    expect(connectionRule(line, {}, "office")).toBe("fixed_pc");
    expect(connectionRule(line, { lines: [{ ...line, until: "2026-10-19T12:30:00Z" }] }, "laptop", Date.parse("2026-10-19T12:30:00Z"))).toBe("waiting");
  });

  it("uses only actual address families from the host's configured headers", () => {
    vi.stubEnv("OFFICE_IP_HEADER", "x-test-ip");
    vi.stubEnv("OFFICE_SECOND_IP_HEADER", "x-test-other");
    expect(requestLine(new Headers({ "x-test-ip": "203.0.113.10", "x-test-other": "2001:db8:a:b::1" }), "2026-10-19"))
      .toEqual({ ipv4: "203.0.113.10", ipv6: "2001:db8:a:b", confirmed_on: "2026-10-19" });
    vi.stubEnv("OFFICE_IP_HEADER", "");
    vi.stubEnv("OFFICE_SECOND_IP_HEADER", "");
    expect(requestLine(new Headers({ "cf-connecting-ip": "240.1.2.3", "cf-connecting-ipv6": "2001:db8:a:b::1" }), "2026-10-19"))
      .toEqual({ ipv6: "2001:db8:a:b", confirmed_on: "2026-10-19" });
    expect(lineFor("999.1.2.3", "2026-10-19")).toBeNull();
    expect(lineFor("made:up", "2026-10-19")).toBeNull();
  });

});
