import { describe, expect, it } from "vitest";
import { EnvError, readServerEnv } from "@/src/lib/env";

describe("server settings", () => {
  it("starts with safe defaults when nothing is set", () => {
    const env = readServerEnv({});
    expect(env.MAIL_MODE).toBe("fake");
    expect(env.AWS_SES_REGION).toBe("ap-south-1");
    expect(env.AI_CLASSIFIER_MODEL).toBe("gpt-5-nano");
  });

  it("treats blank lines as unset", () => {
    expect(readServerEnv({ APP_BASE_URL: "", OPENAI_API_KEY: "" }).OPENAI_API_KEY).toBeUndefined();
  });

  it("refuses live email outside production", () => {
    expect(() => readServerEnv({ MAIL_MODE: "live", NODE_ENV: "development" })).toThrow(EnvError);
    expect(readServerEnv({ MAIL_MODE: "live", NODE_ENV: "production" }).MAIL_MODE).toBe("live");
  });

  it("names a bad setting without printing its value", () => {
    const secret = "not-a-web-address-sk-123456";
    try {
      readServerEnv({ SENTRY_DSN: secret });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).toContain("SENTRY_DSN");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("reads the AI spend cap as a number", () => {
    expect(readServerEnv({ AI_GLOBAL_DAILY_CAP_USD: "12.5" }).AI_GLOBAL_DAILY_CAP_USD).toBe(12.5);
    expect(() => readServerEnv({ AI_GLOBAL_DAILY_CAP_USD: "-1" })).toThrow(EnvError);
  });
});
