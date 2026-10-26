import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { settleVersions } from "@/src/lib/documents";
import { supabaseAdmin } from "@/src/lib/supabase";
import { localSupabase } from "../local-env";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const paper = "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, status, drive_file_id, name, size, sha256, received_at, registration_id) values ($1, $2, $3, $4, $5, 'filed', $6, $6, 1, $6, $7, $8) returning id";
const gstin = "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, 'gstin', 'invented', $3) returning id";

it("keeps the GSTIN of a paper within its firm, and forgets it when the GSTIN goes", () =>
  rollback(db, async () => {
    await asOwner(db);
    const [firm, other, staff] = [randomUUID(), randomUUID(), randomUUID()];
    await db.query("insert into auth.users (id, email) values ($1, 'staff@versions.test')", [staff]);
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Versions Firm', '24', 'active'), ($2, 'Other Firm', '24', 'active')", [firm, other]);
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm, staff]);
    const [{ id: client }] = (await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Patel Textiles', 'company') returning id", [firm])).rows;
    const [{ id: elsewhere }] = (await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Other Client', 'company') returning id", [other])).rows;
    const [{ id: theirs }] = (await db.query(gstin, [other, elsewhere, `b-${randomUUID()}`])).rows;
    expect((await attempt(db, paper, [firm, client, "gst", "Purchase bills", "2026-09", "a.pdf", "2026-10-01", theirs])).ok).toBe(false);
    const [{ id: ours }] = (await db.query(gstin, [firm, client, `b-${randomUUID()}`])).rows;
    const [{ id: bills }] = (await db.query(paper, [firm, client, "gst", "Purchase bills", "2026-09", "a.pdf", "2026-10-01", ours])).rows;
    await db.query("update public.documents set status = 'earlier' where id = $1", [bills]);
    await actAs(db, staff);
    expect((await db.query("select status, registration_id from public.documents")).rows).toEqual([{ status: "earlier", registration_id: ours }]);
    await asOwner(db);
    await db.query("delete from public.client_registrations where id = $1", [ours]);
    expect((await db.query("select firm_id, registration_id from public.documents where id = $1", [bills])).rows).toEqual([{ firm_id: firm, registration_id: null }]);
  }));

it("keeps the latest paper of a type, period and GSTIN current and the others as earlier versions", async () => {
  const local = localSupabase();
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  const firm = randomUUID();
  try {
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Versions Worker Firm', '24', 'active')", [firm]);
    const [{ id: one }] = (await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'One GSTIN', 'business') returning id", [firm])).rows;
    const [{ id: two }] = (await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Two GSTINs', 'business') returning id", [firm])).rows;
    const [{ id: only }] = (await db.query(gstin, [firm, one, `v-${randomUUID()}`])).rows;
    const [{ id: first }] = (await db.query(gstin, [firm, two, `v-${randomUUID()}`])).rows;
    await db.query(gstin, [firm, two, `v-${randomUUID()}`]);
    const add = async (client: string, type: string, at: string, registration: string | null, work = "gst", extension = ".xlsx") => (await db.query(paper, [firm, client, work, type, "2026-09", `${randomUUID()}${extension}`, at, registration])).rows[0].id as string;
    const status = async (...ids: string[]) => (await db.query("select id, status from public.documents where id = any($1)", [ids])).rows.reduce((all, row) => ({ ...all, [row.id]: row.status }), {} as Record<string, string>);
    const admin = supabaseAdmin();
    const group = { client_id: one, work_type: "gst", document_type: "Purchase bills", period_key: "2026-09", registration_id: only };

    const older = await add(one, "Purchase bills", "2026-10-01", only);
    const newer = await add(one, "Purchase bills", "2026-10-05", only);
    await settleVersions(admin, group);
    expect(await status(older, newer)).toEqual({ [older]: "earlier", [newer]: "filed" });
    // Removing the current one brings the earlier one back; putting it back makes it current again.
    await db.query("update public.documents set status = 'deleted' where id = $1", [newer]);
    await settleVersions(admin, group);
    expect(await status(older)).toEqual({ [older]: "filed" });
    await db.query("update public.documents set status = 'filed' where id = $1", [newer]);
    await settleVersions(admin, group);
    expect(await status(older, newer)).toEqual({ [older]: "earlier", [newer]: "filed" });

    // A client with two GSTINs: papers whose GSTIN is not known stay as they are; known ones version by GSTIN.
    const [a, b] = [await add(two, "Sales bills", "2026-10-01", null), await add(two, "Sales bills", "2026-10-02", null)];
    await settleVersions(admin, { ...group, client_id: two, document_type: "Sales bills", registration_id: null });
    expect(await status(a, b)).toEqual({ [a]: "filed", [b]: "filed" });
    const c = await add(two, "Sales bills", "2026-10-03", first);
    await settleVersions(admin, { ...group, client_id: two, document_type: "Sales bills", registration_id: first });
    expect(await status(a, b, c)).toEqual({ [a]: "filed", [b]: "filed", [c]: "filed" });
    // Notices come several a month, each its own paper.
    const [n1, n2] = [await add(one, "Notice", "2026-10-01", null, "other"), await add(one, "Notice", "2026-10-02", null, "other")];
    await settleVersions(admin, { ...group, work_type: "other", document_type: "Notice", registration_id: null });
    expect(await status(n1, n2)).toEqual({ [n1]: "filed", [n2]: "filed" });
    // Bills come many a month: a PDF of bills is its own paper beside the register, and a bill the
    // earlier rule took for an old version is its own paper again.
    const [p1, p2] = [await add(one, "Purchase bills", "2026-10-06", only, "gst", ".pdf"), await add(one, "Purchase bills", "2026-10-07", only, "gst", ".pdf")];
    await db.query("update public.documents set status = 'earlier' where id = $1", [p1]);
    await settleVersions(admin, group);
    expect(await status(p1, p2, older, newer)).toEqual({ [p1]: "filed", [p2]: "filed", [older]: "earlier", [newer]: "filed" });
    // So does Form 16: one an employer, and often its Part A and Part B apart.
    const [f1, f2] = [await add(one, "Form 16", "2026-10-01", null, "income_tax"), await add(one, "Form 16", "2026-10-02", null, "income_tax")];
    await settleVersions(admin, { ...group, work_type: "income_tax", document_type: "Form 16", registration_id: null });
    expect(await status(f1, f2)).toEqual({ [f1]: "filed", [f2]: "filed" });
  } finally {
    await db.query("begin");
    await db.query("select set_config('app.log_purge', 'on', true)");
    await db.query("delete from public.firms where id = $1", [firm]);
    await db.query("commit");
    vi.unstubAllEnvs();
  }
});
