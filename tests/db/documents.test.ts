import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

const FIRM = "00000000-0000-4000-8000-0000000007a0";
const STAFF = "00000000-0000-4000-8000-0000000007a1";
const CLIENT = "00000000-0000-4000-8000-0000000007a2";
const DOCUMENT = "00000000-0000-4000-8000-0000000007a3";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("filed documents", () => {
  it("are seen by members, but where a file sits in the drive is known only to the server", () =>
    rollback(db, async () => {
      await asOwner(db);
      await db.query("insert into auth.users (id, email) values ($1, 'staff@documents.test')", [STAFF]);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Documents Firm', '24', 'active')", [FIRM]);
      await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [FIRM, STAFF]);
      await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Patel Textiles', 'company')", [CLIENT, FIRM]);
      await db.query(
        "insert into public.documents (id, firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, $3, 'gst', 'Document', 'FY 2026-27/Patel Textiles/GST/a.pdf', 'Patel Textiles - Document.pdf', 1, 'x')",
        [DOCUMENT, FIRM, CLIENT],
      );
      await actAs(db, STAFF);
      expect((await db.query("select name from public.documents")).rows).toEqual([{ name: "Patel Textiles - Document.pdf" }]);
      expect((await attempt(db, "select drive_file_id from public.documents")).ok).toBe(false);
      // Only the server may point a document at a file, so nobody reaches another file in the drive.
      const rename = "select public.rename_document($1, $2, 'gst', 'Document', '', 'filed', 'x.pdf', 'Private/salary.pdf')";
      expect((await attempt(db, rename, [DOCUMENT, STAFF])).ok).toBe(false);
      expect((await attempt(db, "update public.documents set drive_file_id = 'Private/salary.pdf'")).ok).toBe(false);
      // A send's download count moves only through the server.
      expect((await attempt(db, "select * from public.use_share('x')")).ok).toBe(false);
    }));
});
