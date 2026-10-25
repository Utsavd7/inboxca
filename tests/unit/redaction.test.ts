import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorEvent } from "@/src/lib/error-report";
import { log, redact } from "@/src/lib/logger";

// Redaction (PLAN.md 8.9): logs, error reports and error messages never carry a client's email,
// PAN, GSTIN, phone, file contents or a token. Also covered: the details of activity_log
// (tests/unit/activity.test.ts), job payloads (tests/db/security.test.ts) and a job that
// throws (tests/unit/jobs-runner.test.ts).
const client = {
  email: "ramesh.shah@shahtraders.example",
  pan: "ABCPS1234K",
  gstin: "24ABCPS1234K1Z5",
  phone: "9876543210",
  token: randomBytes(32).toString("base64url"),
  jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlLXZhbHVlLWhlcmU"].join("."),
  sealed: randomBytes(48).toString("base64url"),
};
const leaks = (text: string) => Object.entries(client).filter(([, value]) => text.includes(value)).map(([key]) => key);
const all = Object.values(client).join(" ");

// Lines of the app's own code that match, from git (none is not an error).
function grep(pattern: string) {
  try {
    return execFileSync("git", ["grep", "-n", "-E", pattern, "--", "app", "src", "worker", "proxy.ts", "instrumentation.ts"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

afterEach(() => vi.restoreAllMocks());

describe("redaction", () => {
  it("masks a client's identifiers and every kind of token in a log line, at any depth", () => {
    const lines: string[] = [];
    for (const stream of ["log", "error"] as const) vi.spyOn(console, stream).mockImplementation((line) => void lines.push(String(line)));
    log.info("mail.filed", { from: client.email, note: all, nested: { link: `/s/${client.token}`, header: `Bearer ${client.jwt}`, values: [client.sealed] } });
    log.warn("drive.connect_failed", { provider: "dropbox", error: new Error(`refused for ${client.email}, PAN ${client.pan}`).message });
    log.error("job.threw", { error: all, content: "Opening balance as per ledger", body: "Dear sir", token: client.token });
    expect(lines).toHaveLength(3);
    expect(leaks(lines.join("\n"))).toEqual([]);
    expect(lines.join("\n")).not.toContain("Opening balance");
    expect(lines.join("\n")).not.toContain("Dear sir");
    expect(JSON.parse(lines[0])).toMatchObject({ event: "mail.filed", from: "[email]", nested: { link: "/s/[token]", header: "Bearer [token]" } });
  });

  it("masks a visitor's IP address, but not times or ids", () => {
    const line = redact(["from 203.0.113.7:443", "2001:db8::1", "fe80::1ff:fe23:4567:890a", "::ffff:198.51.100.4", "at 19:48:29.611", "job 00000000-0000-4000-8000-00000000000a"]);
    expect(line).toEqual(["from [ip]", "[ip]", "[ip]", "[ip]", "at 19:48:29.611", "job 00000000-0000-4000-8000-00000000000a"]);
  });

  it("keeps none of them in an error report, even from a route or a tag", () => {
    const event = JSON.stringify(errorEvent(new Error(all), { route: `/u/${client.token}`, kind: client.email }));
    expect(leaks(event)).toEqual([]);
  });

  it("logs only through the redacting logger", () => {
    const direct = grep("console\\.(log|info|warn|error|debug)\\(")
      .filter((line) => !line.startsWith("src/lib/logger.ts:") && !/^[^:]+:\d+:\s*\/\//.test(line))
      .filter((line) => !/console\.log\("[^"$`]*"\)/.test(line));
    expect(direct).toEqual([]);
  });

  it("names log events with fixed words, never with values", () => {
    expect(grep("\\blog\\.(debug|info|warn|error)\\(").filter((line) => !/\blog\.(debug|info|warn|error)\("[a-z_.]+"/.test(line))).toEqual([]);
  });

  it("puts only codes and fixed labels into error messages", () => {
    const values = grep("new Error\\(`").flatMap((line) => [...line.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()));
    expect(values.length).toBeGreaterThan(10);
    // A code or status, a fixed label or name, a row number, or an AWS error's type name.
    const fixed = /^([\w[\]]+\.)?(code|status|service|label|heading)$|^(key|label|heading|action|row ?\+ ?1)$|^String\(answer\.__type \?\? response\.status\)/;
    expect(values.filter((value) => !fixed.test(value))).toEqual([]);
  });
});
