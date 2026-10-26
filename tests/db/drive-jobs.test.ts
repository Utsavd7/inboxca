import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// What the daily drive check asks the database (PLAN.md 5.5.1), for the server only: about a
// year of the firm's files, and the jobs that ran out of tries while its drive was away.
const FIRM = "00000000-0000-4000-8000-00000000f101";
const OTHER = "00000000-0000-4000-8000-00000000f102";
const OWNER = "00000000-0000-4000-8000-00000000f103";
const CLIENT = "00000000-0000-4000-8000-00000000f104";
const OTHER_CLIENT = "00000000-0000-4000-8000-00000000f105";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users (id, email) values ($1, 'owner@drive-jobs.test')", [OWNER]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Drive Jobs Firm', '24', 'active'), ($2, 'Other Drive Firm', '24', 'active')", [FIRM, OTHER]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [FIRM, OWNER]);
  await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Mehta Traders', 'business'), ($3, $4, 'Shah Exports', 'business')", [CLIENT, FIRM, OTHER_CLIENT, OTHER]);
}
const asServer = () => db.query("set local role service_role");
const paper = (firm: string, client: string, size: number, daysAgo: number) =>
  db.query("insert into public.documents (id, firm_id, client_id, work_type, document_type, name, size, sha256, drive_file_id, received_at) values (gen_random_uuid(), $1, $2, 'gst', 'Sales', 'sales.pdf', $3, 'x', gen_random_uuid()::text, now() - make_interval(days => $4)) returning id", [firm, client, size, daysAgo]);
const job = (firm: string, kind: string, key: string, state: string, code: string | null) =>
  db.query("insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, $2, 'document', gen_random_uuid(), $3, $4, 168, $5)", [firm, kind, `test-drive-jobs-${key}`, state, code]);

describe("a year of the firm's files", () => {
  it("is the papers it added in the last 12 months at their files' size, leaving out the first import", () =>
    rollback(db, async () => {
      await seed();
      await paper(FIRM, CLIENT, 1000, 0);
      await paper(FIRM, CLIENT, 2000, 200);
      await paper(FIRM, CLIENT, 4000, 400);
      await paper(OTHER, OTHER_CLIENT, 16000, 0);
      // The first import's papers were in the drive already: entered at 0 bytes before they arrive.
      const imported = "00000000-0000-4000-8000-00000000f106";
      await db.query("insert into public.usage_ledger (firm_id, due_on, bytes, ref) values ($1, current_date, 0, $2)", [FIRM, imported]);
      await db.query("insert into public.documents (id, firm_id, client_id, work_type, document_type, name, size, sha256, drive_file_id, received_at) values ($1, $2, $3, 'gst', 'Sales', 'old.pdf', 8000, 'x', 'imported', now())", [imported, FIRM, CLIENT]);
      await asServer();
      expect((await db.query("select public.drive_year_bytes($1) as bytes", [FIRM])).rows).toEqual([{ bytes: "3000" }]);
      for (const role of [OWNER, null]) {
        await actAs(db, role);
        expect((await attempt(db, "select public.drive_year_bytes($1)", [FIRM])).ok).toBe(false);
      }
    }));
});

describe("the jobs that waited while the drive was away", () => {
  it("go once more each when the drive is back, only those that failed for the drive, and are logged", () =>
    rollback(db, async () => {
      await seed();
      await job(FIRM, "file_mail", "filing", "failed", "drive_unreachable");
      await job(FIRM, "read_document", "reading", "failed", "drive_unreachable");
      await job(FIRM, "import_files", "import", "failed", "drive_unreachable");
      // Not these: the drive's own checks, another failure, a job done, one already sent again,
      // and another firm's.
      await job(FIRM, "drive_check", "check", "failed", "drive_unreachable");
      await job(FIRM, "read_document", "unreadable", "failed", "exception");
      await job(FIRM, "read_document", "read", "done", null);
      await job(FIRM, "file_mail", "twice:again", "failed", "drive_unreachable");
      await job(OTHER, "file_mail", "other", "failed", "drive_unreachable");
      const requeue = async () => {
        await asServer();
        const [{ queued }] = (await db.query("select public.requeue_drive_jobs($1) as queued", [FIRM])).rows;
        await asOwner(db);
        return queued;
      };
      const again = () => db.query("select kind, state, idempotency_key from public.jobs where idempotency_key like 'test-drive-jobs-%:again' order by idempotency_key").then(({ rows }) => rows);
      const logged = () => db.query("select details from public.activity_log where firm_id = $1 and action = 'drive.back'", [FIRM]).then(({ rows }) => rows);

      // A check that finds all well, with no away alert open, sends nothing again.
      expect(await requeue()).toBe(0);
      await db.query("insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, status, details) values ($1, 'alert', 'drive_away', $1, 'drive_away', 'pending', '{}')", [FIRM]);
      expect(await requeue()).toBe(3);
      const sent = [
        { kind: "file_mail", state: "pending", idempotency_key: "test-drive-jobs-filing:again" },
        { kind: "import_files", state: "pending", idempotency_key: "test-drive-jobs-import:again" },
        { kind: "read_document", state: "pending", idempotency_key: "test-drive-jobs-reading:again" },
        { kind: "file_mail", state: "failed", idempotency_key: "test-drive-jobs-twice:again" },
      ];
      expect(await again()).toEqual(sent);
      expect(await logged()).toEqual([{ details: { jobs: 3 } }]);
      // Asked again, nothing is queued twice.
      expect(await requeue()).toBe(0);
      expect(await again()).toEqual(sent);
      expect(await logged()).toEqual([{ details: { jobs: 3 } }]);
      for (const role of [OWNER, null]) {
        await actAs(db, role);
        expect((await attempt(db, "select public.requeue_drive_jobs($1)", [FIRM])).ok).toBe(false);
      }
    }));
});
