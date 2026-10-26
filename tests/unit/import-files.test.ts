import { expect, it, vi } from "vitest";
import type { Job } from "@/src/jobs/runner";
import type { ImportPlan } from "@/src/jobs/import-files";

// The first import's job (PLAN.md 5.16) against a fake database and drive: a file the drive
// cannot give stays for the next try instead of being counted as moved.
const state = vi.hoisted(() => ({ plan: {} as ImportPlan, status: "pending", reads: [] as string[], away: new Set<string>(), documents: 0 }));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain,
        insert: () => { if (table === "documents") state.documents++; return chain; },
        update: (value: { details?: ImportPlan; status?: string }) => { if (value.details) state.plan = structuredClone(value.details); if (value.status) state.status = value.status; return chain; },
        maybeSingle: async () => ({ data: table === "requests" ? { id: "request", firm_id: "firm", status: state.status, details: structuredClone(state.plan) } : table === "connected_accounts" ? { id: "drive", provider: "local", settings: {} } : null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: table === "clients" ? [{ id: "client", name: "Invented Client" }] : null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/src/lib/drive-account", () => ({
  openDrive: async () => ({
    read: async (id: string) => { state.reads.push(id); if (state.away.delete(id)) throw new Error("drive away"); return Buffer.from(`%PDF-1.4 ${id}`); },
    ensureFolder: async () => "folder",
    move: async (id: string, _folder: string, name: string) => ({ id, name }),
  }),
}));
vi.mock("@/src/lib/crypto", () => ({ serverCrypto: () => ({ encrypt: async () => "sealed" }) }));
vi.mock("@/src/jobs/read-document", () => ({ queueRead: async () => {} }));
import { importFiles } from "@/src/jobs/import-files";

const file = (id: string) => ({ id, from: `Old/${id}.pdf`, client: "client", work: "gst", type: "GSTR-3B", period: "2026-09", toCheck: false });

it("tries a file the drive could not give again, and moves each file once", async () => {
  state.plan = { files: [file("one"), file("two"), file("three")], done: 0, moved: [] } as unknown as ImportPlan;
  state.away.add("two");
  const job = { entity_id: "request" } as Job;
  expect(await importFiles(job, {} as never)).toEqual({ retry: "drive_unreachable", patient: true });
  // The first file moved; the second, which the drive did not give, is next, not skipped.
  expect(state.plan.done).toBe(1);
  expect(state.plan.moved.map((row) => row.from)).toEqual(["Old/one.pdf"]);
  expect(await importFiles(job, {} as never)).toEqual({ done: true });
  expect(state.plan.done).toBe(3);
  expect(state.plan.moved.map((row) => row.from)).toEqual(["Old/one.pdf", "Old/two.pdf", "Old/three.pdf"]);
  expect(state.reads).toEqual(["one", "two", "two", "three"]);
  expect(state.documents).toBe(3);
  expect(state.status).toBe("done");
});
