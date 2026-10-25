import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { localSupabase, query } from "./local-supabase";
import { TEST_RUN, TEST_WORKER_SECRET } from "../../playwright.config";

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
  // This run's server runs only jobs of firms marked with the run's tag.
  const [{ id: firm }] = await query(local.dbUrl, "insert into public.firms (name, state_code, status, settings) values ('Jobs Test Firm', '27', 'active', $1) returning id", [{ test_run: TEST_RUN }]);
  // A kind with no handler, so the sweep fails it at once and touches nothing outside.
  await query(
    local.dbUrl,
    "insert into public.jobs (firm_id, kind, idempotency_key, run_at) values ($2, 'e2e_unknown', $1, now() - interval '1 second')",
    [key, firm],
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
    await query(local.dbUrl, "delete from public.firms where id = $1", [firm]);
  }
});
