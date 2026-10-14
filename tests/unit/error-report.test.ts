import { afterEach, describe, expect, it, vi } from "vitest";
import { errorEvent, parseDsn, reportError } from "@/src/lib/error-report";

const DSN = "https://publickey@o1.ingest.example.test/42";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("error reports to Sentry", () => {
  it("reads the address and key from the DSN, and refuses anything else", () => {
    expect(parseDsn(DSN)).toEqual({
      key: "publickey",
      endpoint: "https://o1.ingest.example.test/api/42/envelope/",
    });
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o1.ingest.example.test/42")).toBeNull();
  });

  it("sends the error's type and where it happened, never its message", () => {
    const error = new TypeError("client ram@example.com, PAN ABCDE1234F, Sharma Traders");
    const event = errorEvent(error, { route: "/app", method: "POST" });
    const text = JSON.stringify(event);
    for (const secret of ["ram@example.com", "ABCDE1234F", "Sharma Traders"])
      expect(text).not.toContain(secret);
    expect(event.exception.values[0].type).toBe("TypeError");
    expect(event.exception.values[0].stacktrace?.frames.length).toBeGreaterThan(0);
    expect(event.tags).toMatchObject({ route: "/app", method: "POST" });
  });

  it("masks identifiers that reach a tag", () => {
    expect(errorEvent(new Error("x"), { kind: "ram@example.com" }).tags.kind).toBe("[email]");
  });

  it("sends nothing while no DSN is set", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SENTRY_DSN", "");
    await reportError(new Error("x"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one envelope with the key, and never throws when Sentry is down", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SENTRY_DSN", DSN);
    await expect(reportError(new Error("ram@example.com"))).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://o1.ingest.example.test/api/42/envelope/");
    expect(init.headers["X-Sentry-Auth"]).toContain("sentry_key=publickey");
    expect(init.body.split("\n")).toHaveLength(3);
    expect(init.body).not.toContain("ram@example.com");
  });
});
