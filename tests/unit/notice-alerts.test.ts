import { expect, it, vi } from "vitest";
import type { Job } from "@/src/jobs/runner";
const state = vi.hoisted(() => ({ claimed: false, notify: vi.fn() }));
vi.mock("@/src/lib/push", () => ({ notify: state.notify }));
vi.mock("@/src/lib/supabase", () => ({ supabaseAdmin: () => ({
  rpc: async () => { const claimed = state.claimed; state.claimed = true; return { data: claimed ? null : { firm_id: "firm", client_id: "client" } }; },
  from: (table: string) => ({
    select() { return this; }, eq() { return this; },
    then(resolve: (value: unknown) => void) { resolve({ data: table === "firm_members" ? [
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
  expect(state.notify).toHaveBeenCalledWith(["owner","partner","team"], { title: "A notice needs attention", body: "A notice's review deadline is within 3 days.", url: "/app/notices" });
});
