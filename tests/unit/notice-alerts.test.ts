import { expect, it, vi } from "vitest";
import type { Job } from "@/src/jobs/runner";
const state = vi.hoisted(() => ({ claimed: false, fail: false, notify: vi.fn() }));
vi.mock("@/src/lib/push", () => ({ notify: state.notify }));
vi.mock("@/src/lib/supabase", () => ({ supabaseAdmin: () => ({
  rpc: async () => { const claimed = state.claimed; state.claimed = true; return { data: claimed ? null : { firm_id: "firm", client_id: "client" } }; },
  from: (table: string) => ({
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: { firm_id: "firm", client_id: "client" } }),
    then(resolve: (value: unknown) => void) { resolve({ error: state.fail ? new Error("Unavailable") : null, data: table === "firm_members" ? [
      { user_id: "owner", role: "owner" }, { user_id: "partner", role: "partner" },
      { user_id: "team", role: "staff", team_id: "assigned" }, { user_id: "other", role: "staff", team_id: "elsewhere" },
    ] : [{ team_id: "assigned" }] }); },
  }),
}) }));
import { noticeAlert } from "@/src/jobs/notify";
it("notifies the owner, partners and client team only once, without naming the client", async () => {
  const job = { entity_id: "notice", idempotency_key: "notice_alert:notice:review_near" } as Job;
  await noticeAlert(job, { markSending: async () => {} });
  await noticeAlert(job, { markSending: async () => {} });
  expect(state.notify).toHaveBeenCalledTimes(1);
  expect(state.notify).toHaveBeenCalledWith(["owner","partner","team"], { title: "A notice needs attention", body: "A notice still needs its action date checked. Your firm's deadline for this is within 3 days.", url: "/app/notices" });
});

it("retries a failed recipient lookup without consuming the stage", async () => {
  state.claimed = false;
  state.fail = true;
  const job = { entity_id: "notice", idempotency_key: "notice_alert:notice:review_near" } as Job;
  expect(await noticeAlert(job, { markSending: async () => {} })).toEqual({ retry: "notice_people_not_read" });
  expect(state.claimed).toBe(false);
  state.fail = false;
});
