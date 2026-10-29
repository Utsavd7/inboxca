import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { checkEnv } from "@/src/lib/env";

// The server does not start without its own key for recovery codes, owner computers and signed
// cookies (instrumentation.ts), rather than signing them with an empty one.
it("refuses to start without APP_HMAC_KEY, or with a short one", () => {
  expect(() => checkEnv({})).toThrow(/APP_HMAC_KEY/);
  expect(() => checkEnv({ APP_HMAC_KEY: "too short" })).toThrow(/APP_HMAC_KEY/);
  expect(() => checkEnv({ APP_HMAC_KEY: randomBytes(32).toString("base64") })).not.toThrow();
});
