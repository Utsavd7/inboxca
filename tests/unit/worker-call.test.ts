import { expect, it } from "vitest";
import { isWorkerCall } from "@/src/jobs/worker-call";

it("accepts only the exact secret, sent as a bearer token, and nothing while none is set", () => {
  const secret = "test-only-worker-secret";
  expect(isWorkerCall(`Bearer ${secret}`, secret)).toBe(true);
  for (const header of [null, "Bearer nope", secret, `Bearer ${secret}x`])
    expect(isWorkerCall(header, secret)).toBe(false);
  expect(isWorkerCall("Bearer ", undefined)).toBe(false);
  expect(isWorkerCall("Bearer ", "")).toBe(false);
});
