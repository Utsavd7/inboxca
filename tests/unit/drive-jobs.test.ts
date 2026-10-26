import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Drive } from "@/src/lib/drive";
import type { Job } from "@/src/jobs/runner";

// The server key's database, as far as the drive jobs use it: rows to read, and every write
// (a database function's answer is under its name).
const mock = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  writes: [] as { table: string; op: string; value: unknown; filters: string[] }[],
  drive: null as Drive | null,
}));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, value: unknown) => (mock.writes.push({ table: name, op: "rpc", value, filters: [] }), { data: mock.rows[name] ?? null }),
    from: (table: string) => {
      const filters: string[] = [];
      const query = {
        select: () => query,
        eq: (key: string, value: string) => (filters.push(`${key}=${value}`), query),
        neq: () => query,
        is: () => query,
        maybeSingle: async () => ({ data: mock.rows[table] ?? null }),
        insert: async (value: unknown) => (mock.writes.push({ table, op: "insert", value, filters }), { error: null }),
        upsert: async (value: unknown) => (mock.writes.push({ table, op: "upsert", value, filters }), { error: null }),
        update: (value: unknown) => (mock.writes.push({ table, op: "update", value, filters }), query),
        then: (resolve: (value: unknown) => void) => resolve({ data: mock.rows[table] ?? [], error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/src/lib/drive-account", async (actual) => ({
  ...(await actual<typeof import("@/src/lib/drive-account")>()),
  openDrive: async (...args: Parameters<typeof import("@/src/lib/drive-account").openDrive>) =>
    mock.drive ?? (await actual<typeof import("@/src/lib/drive-account")>()).openDrive(...args),
}));
import { driveCheck } from "@/src/jobs/drive-check";
import { driveSetup } from "@/src/jobs/drive-setup";
import { todayInIndia } from "@/src/lib/calendar";
import { financialYear, localDrive } from "@/src/lib/drive";

const tools = { markSending: async () => {} };
const job = (attempts = 1) => ({ entity_id: "account-1", attempts }) as Job;
const away = { check: async () => { throw new Error("dropbox_list"); }, ensureFolder: async () => { throw new Error("dropbox_folder"); } } as unknown as Drive;
const logged = () => mock.writes.filter((write) => write.table === "activity_log").map((write) => write.value);

beforeEach(() => {
  mock.writes = [];
  mock.drive = null;
  mock.rows = { connected_accounts: { id: "account-1", firm_id: "firm-1", provider: "local", credentials_enc: "", settings: {} } };
});

describe("setting up a newly connected drive", () => {
  it("makes InboxCA's folder and this year's client folders, checks a test file, and logs a tick for each", async () => {
    // A Dropbox account, its drive played by a folder here.
    const root = await mkdtemp(path.join(tmpdir(), "drive-setup-"));
    mock.drive = localDrive(root);
    mock.rows.connected_accounts = { id: "account-1", firm_id: "firm-1", provider: "dropbox", credentials_enc: "", settings: { dropbox_account: "invented" } };
    mock.rows.clients = [{ name: "Patel Textiles" }, { name: "Mehta: Exports" }];
    expect(await driveSetup(job(), tools)).toEqual({ done: true });
    const year = financialYear(todayInIndia().slice(0, 7));
    expect((await readdir(path.join(root, "InboxCA", year))).sort()).toEqual(["Mehta Exports", "Patel Textiles"]);
    // The test file was removed again.
    expect(await readdir(path.join(root, "InboxCA"))).toEqual([year]);
    expect(logged()).toEqual([{
      firm_id: "firm-1", action: "drive.setup", entity_type: "account", entity_id: "account-1",
      details: { reached: true, clients: 2, test_file: true, shared: false, free_bytes: expect.any(Number), notices: false },
    }]);
    // Run again (a long list carries on in a later run): folders already there are kept; and
    // with the app secret set, change notices are on.
    process.env.DROPBOX_APP_SECRET = "invented-app-secret";
    expect(await driveSetup(job(), tools)).toEqual({ done: true });
    delete process.env.DROPBOX_APP_SECRET;
    expect((await readdir(path.join(root, "InboxCA", year))).sort()).toEqual(["Mehta Exports", "Patel Textiles"]);
    expect(logged()[1]).toMatchObject({ details: { clients: 2, notices: true } });
  });

  it("makes no client folders in the test drive, which every firm on this computer shares", async () => {
    process.env.DRIVE_LOCAL_DIR = await mkdtemp(path.join(tmpdir(), "drive-setup-"));
    mock.rows.clients = [{ name: "Patel Textiles" }];
    expect(await driveSetup(job(), tools)).toEqual({ done: true });
    expect(await readdir(path.join(process.env.DRIVE_LOCAL_DIR, "InboxCA"))).toEqual([]);
    expect(logged()).toMatchObject([{ details: { reached: true, clients: 0, test_file: true } }]);
  });

  it("tries a drive it cannot reach five times, then says so", async () => {
    mock.drive = away;
    expect(await driveSetup(job(1), tools)).toEqual({ retry: "drive_unreachable" });
    expect(logged()).toEqual([]);
    expect(await driveSetup(job(5), tools)).toEqual({ fail: "drive_unreachable" });
    expect(logged()).toMatchObject([{ action: "drive.setup", details: { reached: false } }]);
  });
});

describe("the drive check, when the drive is away", () => {
  const alerts = () => mock.writes.filter((write) => write.table === "requests" && JSON.stringify(write).includes("drive_away"));

  it("tells the owner after five tries, and the next check that reaches the drive clears it", async () => {
    mock.drive = away;
    expect(await driveCheck(job(1), tools)).toEqual({ retry: "drive_unreachable" });
    expect(alerts()).toEqual([]);
    expect(await driveCheck(job(5), tools)).toEqual({ retry: "drive_unreachable" });
    expect(alerts()).toMatchObject([{ op: "upsert", value: { firm_id: "firm-1", kind: "alert", entity_type: "drive_away", reason_code: "drive_away", status: "pending" } }]);
    mock.writes = [];
    mock.drive = { check: async () => ({ files: [], shared: false, freeBytes: 5 * 1024 ** 3 }) } as unknown as Drive;
    expect(await driveCheck(job(1), tools)).toEqual({ done: true });
    expect(alerts()).toMatchObject([{ op: "update", value: { status: "done" }, filters: ["kind=alert", "entity_type=drive_away", "entity_id=firm-1"] }]);
  });

  it("sends the jobs that ran out of tries again once it reaches the drive, before the alert clears", async () => {
    const asked = () => mock.writes.filter((write) => write.table === "requeue_drive_jobs" || (write.table === "requests" && JSON.stringify(write).includes("drive_away"))).map((write) => [write.table, write.op, write.value]);
    mock.drive = away;
    await driveCheck(job(5), tools);
    expect(asked()).toEqual([["requests", "upsert", expect.anything()]]);
    mock.writes = [];
    mock.drive = { check: async () => ({ files: [], shared: false, freeBytes: 5 * 1024 ** 3 }) } as unknown as Drive;
    await driveCheck(job(1), tools);
    expect(asked()).toEqual([["requeue_drive_jobs", "rpc", { target_firm: "firm-1" }], ["requests", "update", { status: "done" }]]);
  });
});

describe("the drive check's low space alert", () => {
  const full = () => mock.writes.filter((write) => write.table === "requests" && JSON.stringify(write).includes("drive_full")).map((write) => [write.op, write.value]);
  const check = async (freeBytes: number) => {
    mock.writes = [];
    mock.drive = { check: async () => ({ files: [], shared: false, freeBytes }) } as unknown as Drive;
    await driveCheck(job(1), tools);
    return full();
  };

  it("warns when less than the files the firm added in the last 12 months is free", async () => {
    mock.rows.drive_year_bytes = 3 * 1024 ** 3;
    expect(await check(2 * 1024 ** 3)).toMatchObject([["upsert", { reason_code: "drive_full", status: "pending", details: { free_bytes: 2 * 1024 ** 3 } }]]);
    expect(await check(4 * 1024 ** 3)).toEqual([["update", { status: "done" }]]);
    expect(mock.writes).toContainEqual({ table: "drive_year_bytes", op: "rpc", value: { target_firm: "firm-1" }, filters: [] });
  });

  it("warns a new firm with little yet below the most one upload can add, 500 MB", async () => {
    mock.rows.drive_year_bytes = 20 * 1024 ** 2;
    expect(await check(400 * 1024 ** 2)).toMatchObject([["upsert", { details: { free_bytes: 400 * 1024 ** 2 } }]]);
    expect(await check(600 * 1024 ** 2)).toEqual([["update", { status: "done" }]]);
  });
});
