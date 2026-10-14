import { describe, expect, it } from "vitest";
import { isWorkerCall } from "@/src/jobs/worker-call";

describe("the job worker's caller check", () => {
  const secret = "test-only-worker-secret";

  it("accepts the secret as a bearer token", () => {
    expect(isWorkerCall(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("refuses a missing, wrong or differently sent secret", () => {
    expect(isWorkerCall(null, secret)).toBe(false);
    expect(isWorkerCall("Bearer nope", secret)).toBe(false);
    expect(isWorkerCall(secret, secret)).toBe(false);
    expect(isWorkerCall(`Bearer ${secret}x`, secret)).toBe(false);
  });

  it("refuses everything while no secret is set", () => {
    expect(isWorkerCall("Bearer ", undefined)).toBe(false);
    expect(isWorkerCall("Bearer ", "")).toBe(false);
  });
});
