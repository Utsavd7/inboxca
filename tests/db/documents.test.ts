import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeHash } from "@/src/lib/share-codes";
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
      // The firm's use is the owner's to see.
      expect((await db.query("select * from public.firm_usage($1)", [FIRM])).rows).toEqual([]);
      // A send's download count moves only through the server.
      expect((await attempt(db, "select * from public.use_share('x')")).ok).toBe(false);
    }));
});

describe("a private paper's one-time code", () => {
  it("gives guesses sent at once 5 tries between them, and a right code opens the paper once", async () => {
    const [firm, client, paper, share] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const tryCode = (on: Client, code: string) => on.query("select public.try_share_code($1, $2, 5) as answer", [share, codeHash(share, code)]).then(({ rows }) => rows[0].answer);
    const newCode = (code: string) => db.query("update public.shares set code_hash = $2, code_expires_at = now() + interval '10 minutes', code_attempts = 0 where id = $1", [share, codeHash(share, code)]);
    // Committed, so the guesses from other connections see it; the firm is removed at the end.
    await asOwner(db);
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Invented Code Firm', '24', 'active')", [firm]);
    await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Invented Code Traders', 'company')", [client, firm]);
    await db.query("insert into public.documents (id, firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256) values ($1, $2, $3, 'gst', 'Document', 'x.pdf', 'x.pdf', 1, 'x')", [paper, firm, client]);
    await db.query("insert into public.shares (id, firm_id, document_id, link_token_hash, link_expires_at, needs_code) values ($1, $2, $3, $4, now() + interval '7 days', true)", [share, firm, paper, randomUUID()]);
    try {
      await newCode("123456");
      const guessers = await Promise.all(Array.from({ length: 10 }, connect));
      const answers = await Promise.all(guessers.map((guesser, n) => tryCode(guesser, String(n).padStart(6, "0"))));
      await Promise.all(guessers.map((guesser) => guesser.end()));
      expect(answers.filter((answer) => answer === "wrong")).toHaveLength(4);
      expect(answers.filter((answer) => answer === "again")).toHaveLength(6);
      // The tries are used up, so even the right code needs a new one.
      expect(await tryCode(db, "123456")).toBe("again");
      await newCode("654321");
      expect(await tryCode(db, "654321")).toBe("right");
      expect(await tryCode(db, "654321")).toBe("again");
      // Only the server checks codes.
      await rollback(db, async () => {
        await actAs(db, null);
        expect((await attempt(db, "select public.try_share_code($1, 'x', 5)", [share])).ok).toBe(false);
      });
    } finally {
      await asOwner(db);
      await db.query("with gone as (select set_config('app.log_purge', 'on', false)) delete from public.firms where id = $1 and exists (select 1 from gone)", [firm]);
      await db.query("select set_config('app.log_purge', '', false)");
    }
  });
});
