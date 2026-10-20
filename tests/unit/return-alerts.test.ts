import { expect, it, vi } from "vitest";
import type { Job } from "@/src/jobs/runner";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }));
vi.mock("@/src/lib/supabase", () => ({ supabaseAdmin: () => ({ rpc: mock.rpc }) }));
vi.mock("@/src/lib/push", () => ({ notify: mock.notify }));
import { returnAlert } from "@/src/jobs/notify";
it("tells only the claimed return's leads once and retries a failed claim", async () => {
  mock.rpc.mockResolvedValueOnce({data:["partner"]}).mockResolvedValueOnce({data:null}).mockResolvedValueOnce({error:{code:"offline"}});
  const job = {entity_id:"return"} as Job;
  await returnAlert(job,{markSending:async()=>{}});
  await returnAlert(job,{markSending:async()=>{}});
  expect(mock.notify).toHaveBeenCalledExactlyOnceWith(["partner"],{title:"A return needs attention",body:"A return is 3 or more days late. Please check with the client.",url:"/app/calendar?view=overdue"});
  expect(await returnAlert(job,{markSending:async()=>{}})).toEqual({retry:"return_not_claimed"});
});
