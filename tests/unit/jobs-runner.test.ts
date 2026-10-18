import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  retryDelaySeconds,
  runDueJobs,
  type Job,
  type JobStore,
} from "@/src/jobs/runner";

const job = (values: Partial<Job>, index = 0): Job => ({
  id: index + 1,
  firm_id: null,
  kind: "test",
  entity_type: null,
  entity_id: null,
  schedule_version: 0,
  idempotency_key: `k${index}`,
  run_at: "",
  state: "claimed",
  claimed_until: null,
  attempts: 1,
  last_error_code: null,
  ...values,
});

// An in-memory store that records what the runner asks of it.
function memoryStore(jobs: Partial<Job>[]) {
  const finished: { id: number; outcome: string; code?: string; at?: Date }[] = [];
  const sending: number[] = [];
  let claimed = false;
  const store: JobStore = {
    async claim() {
      if (claimed) return [];
      claimed = true;
      return jobs.map(job);
    },
    async markSending(id) {
      sending.push(id);
    },
    async finish(id, outcome, code, at) {
      finished.push({ id, outcome, code, at });
      return true;
    },
  };
  return { store, finished, sending };
}

const now = () => new Date("2026-10-14T10:00:00Z");

afterEach(() => vi.restoreAllMocks());

describe("the job runner", () => {
  it("finishes a job its handler completes", async () => {
    const { store, finished } = memoryStore([{ kind: "ocr" }]);
    const summary = await runDueJobs(store, { ocr: async () => ({ done: true }) }, { now });
    expect(summary).toEqual({ claimed: 1, done: 1, retried: 0, failed: 0 });
    expect(finished).toEqual([{ id: 1, outcome: "done" }]);
  });

  it("waits longer before each new try", async () => {
    const { store, finished } = memoryStore([{ kind: "send", attempts: 3 }]);
    await runDueJobs(store, { send: async () => ({ retry: "mailbox_busy" }) }, { now });
    expect(finished[0]).toMatchObject({ outcome: "retry", code: "mailbox_busy" });
    expect(finished[0].at?.toISOString()).toBe("2026-10-14T10:04:00.000Z");
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(retryDelaySeconds)).toEqual([
      60, 120, 240, 480, 960, 1920, 3600, 3600,
    ]);
  });

  it("gives up after the last try", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, finished } = memoryStore([{ kind: "send", attempts: MAX_ATTEMPTS }]);
    const summary = await runDueJobs(store, { send: async () => ({ retry: "timeout" }) }, { now });
    expect(summary.failed).toBe(1);
    expect(finished[0]).toMatchObject({ outcome: "failed", code: "timeout" });
  });

  it("waits patiently, every hour for 7 days, while the other side is away", async () => {
    const { store, finished } = memoryStore([{ kind: "file", attempts: MAX_ATTEMPTS }]);
    await runDueJobs(store, { file: async () => ({ retry: "drive_unreachable", patient: true }) }, { now });
    expect(finished[0]).toMatchObject({ outcome: "retry", code: "drive_unreachable" });
    expect(finished[0].at?.toISOString()).toBe("2026-10-14T11:00:00.000Z");
  });

  it("retries a handler that throws, and logs only the error's type", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, finished } = memoryStore([{ kind: "extract" }]);
    await runDueJobs(
      store,
      {
        extract: async () => {
          throw new TypeError("PAN ABCDE1234F could not be read from bills.pdf");
        },
      },
      { now },
    );
    expect(finished[0]).toMatchObject({ outcome: "retry", code: "exception" });
    const logged = errors.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("ABCDE1234F");
    expect(logged).not.toContain("bills.pdf");
  });

  it("lets a handler mark the moment it reaches outside", async () => {
    const { store, sending } = memoryStore([{ kind: "send" }]);
    await runDueJobs(
      store,
      {
        send: async (_job, { markSending }) => {
          await markSending();
          return { done: true };
        },
      },
      { now },
    );
    expect(sending).toEqual([1]);
  });

  it("stops claiming near the sweep time limit", async () => {
    let time = 0;
    let claims = 0;
    const store = memoryStore([{ id: 1 }]).store;
    store.claim = async () => {
      claims++;
      time += 30;
      return claims < 3 ? [job({ id: claims }, claims - 1)] : [];
    };
    await runDueJobs(store, { test: async () => ({ done: true }) }, { maxRunMs: 50, clock: () => time });
    expect(claims).toBe(2);
  });

  it("runs at most five jobs at a time", async () => {
    const { store } = memoryStore(Array.from({ length: 12 }));
    let active = 0;
    let most = 0;
    await runDueJobs(store, {
      test: async () => {
        active++;
        most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { done: true };
      },
    });
    expect(most).toBe(5);
  });

  it("does not overlap jobs for one entity", async () => {
    const { store } = memoryStore([
      { entity_type: "account", entity_id: "00000000-0000-4000-8000-000000000001" },
      { entity_type: "account", entity_id: "00000000-0000-4000-8000-000000000001" },
      { entity_type: "account", entity_id: "00000000-0000-4000-8000-000000000002" },
    ]);
    const active = new Set<string>();
    let overlap = false;
    await runDueJobs(store, {
      test: async (job) => {
        const entity = job.entity_id!;
        if (active.has(entity)) overlap = true;
        active.add(entity);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.delete(entity);
        return { done: true };
      },
    });
    expect(overlap).toBe(false);
  });
});
