import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { localSupabase, query } from "./local-supabase";
import { TEST_WORKER_SECRET } from "../../playwright.config";

// The job worker endpoint that Supabase Cron calls.
const local = localSupabase();

test("the job worker refuses a call without its secret", async ({ request }) => {
  expect((await request.post("/api/jobs")).status()).toBe(401);
  const wrong = await request.post("/api/jobs", { headers: { Authorization: "Bearer nope" } });
  expect(wrong.status()).toBe(401);
  expect((await request.get("/api/jobs")).status()).toBe(405);
});

test("the job worker runs a due job and records the result", async ({ request }) => {
  test.skip(!local.dbUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
  const key = `e2e-job-${randomUUID()}`;
  // A kind with no handler, so the sweep fails it at once and touches nothing outside.
  await query(
    local.dbUrl,
    "insert into public.jobs (kind, idempotency_key, run_at) values ('e2e_unknown', $1, now() - interval '1 second')",
    [key],
  );
  try {
    const response = await request.post("/api/jobs", {
      headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).claimed).toBeGreaterThanOrEqual(1);
    const [job] = await query(
      local.dbUrl,
      "select state, last_error_code from public.jobs where idempotency_key = $1",
      [key],
    );
    expect(job).toEqual({ state: "failed", last_error_code: "no_handler" });
  } finally {
    await query(local.dbUrl, "delete from public.jobs where idempotency_key = $1", [key]);
  }
});
