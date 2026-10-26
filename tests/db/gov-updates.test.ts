import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// New from the government (D42): a firm sees the last 14 days' items only in its clients' work
// areas, each person dismisses their own, and only Orelu's admin adds a line to an item or ends
// a form version, with the official link, logged.
let db: Client;
const gstFirm = "00000000-0000-4000-8000-0000000060a0", itFirm = "00000000-0000-4000-8000-0000000060b0";
const owner = "00000000-0000-4000-8000-0000000060a1", staff = "00000000-0000-4000-8000-0000000060a2", itOwner = "00000000-0000-4000-8000-0000000060b1", admin = "00000000-0000-4000-8000-0000000060c1";
const [gst, income, old] = ["a".repeat(16), "b".repeat(16), "c".repeat(16)];
const session = (id: string) => `${id.slice(0, -3)}d${id.slice(-2)}`;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// Acts as a listed admin with the passkey proof the server sends after a check.
async function asAdmin() {
  await asOwner(db);
  const { key } = (await db.query("select public.office_proof_key() as key")).rows[0];
  const until = Math.floor(Date.now() / 1000) + 3600;
  await actAs(db, admin, "aal2", session(admin));
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-orelu-admin": `${until}.${createHmac("sha256", key).update(`admin:${admin}:${session(admin)}:${until}`).digest("hex")}` })]);
}

async function seed() {
  await asOwner(db);
  // As PostgREST sends it with every request (an earlier test's proof leaves it empty).
  await db.query("select set_config('request.headers', '{}', true)");
  await db.query("insert into auth.users(id,email) values ($1,'owner@gov.test'),($2,'staff@gov.test'),($3,'it-owner@gov.test'),($4,'admin@gov.test')", [owner, staff, itOwner, admin]);
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session(admin), admin]);
  await db.query("insert into public.orelu_admins(user_id) values ($1)", [admin]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'GST Work Firm','27','active'),($2,'Income Tax Work Firm','27','active')", [gstFirm, itFirm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active'),($4,$5,'owner','active')", [gstFirm, owner, staff, itFirm, itOwner]);
  const client = async (firm: string, archived = false) => (await db.query("insert into public.clients(firm_id,name,kind,archived_at) values ($1,'Invented Client','business',$2) returning id", [firm, archived ? new Date() : null])).rows[0].id;
  const number = async (firm: string, id: string, kind: string, services: string[]) =>
    db.query("insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx,services) values ($1,$2,$3,'sealed',gen_random_uuid()::text,$4)", [firm, id, kind, services]);
  await number(gstFirm, await client(gstFirm), "gstin", ["GSTR1_M", "GSTR3B_M"]);
  await number(gstFirm, await client(gstFirm), "pan", []);
  await number(itFirm, await client(itFirm), "pan", ["ITR_NA"]);
  // An archived client's work is not the firm's work any more.
  await number(itFirm, await client(itFirm, true), "gstin", ["GSTR1_M"]);
  const today = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date)::text d")).rows[0].d;
  const longAgo = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date - 20)::text d")).rows[0].d;
  const item = (id: string, area: string, seen: string) => ({ id, source: "gst_news", area, title: `Invented ${id.slice(0, 1)}`, link: "https://www.gst.gov.in/newsandupdates/read/1", seen });
  await db.query("insert into public.platform_settings(key,value) values ('watch',$1) on conflict (key) do update set value=excluded.value", [
    JSON.stringify({ sources: { cbic_gst: { failures: 2 }, gst_news: { failures: 1 } }, changes: [], alerts: [], items: [item(old, "gst", longAgo), item(gst, "gst", today), item(income, "income_tax", today)] }),
  ]);
}
const updates = async (firm: string) => (await db.query("select public.gov_updates($1) u", [firm])).rows[0].u;

it("shows a firm the last 14 days' items in its clients' work areas only, and nobody outside the firm", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect(await updates(gstFirm)).toMatchObject({ areas: ["gst"], failing: ["cbic_gst"], items: [{ id: gst, area: "gst", dismissed: false }] });
    expect((await updates(gstFirm)).items).toHaveLength(1);
    expect((await attempt(db, "select public.gov_updates($1)", [itFirm])).error).toBe("Members only");
    await actAs(db, itOwner);
    expect(await updates(itFirm)).toMatchObject({ areas: ["income_tax"], items: [{ id: income }] });
    await actAs(db, null);
    expect((await attempt(db, "select public.gov_updates($1)", [gstFirm])).error).toContain("permission denied");
  }));

it("lets each person dismiss an item for themselves only", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [gstFirm, gst])).rows[0].ok).toBe(true);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [gstFirm, "not an item"])).rows[0].ok).toBe(false);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [itFirm, gst])).rows[0].ok).toBe(false);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, dismissed: true }]);
    await actAs(db, staff);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, dismissed: false }]);
    // Nobody changes the list by hand.
    expect((await attempt(db, "update public.firm_members set dismissed = '{}' where user_id = $1", [owner])).error).toContain("permission denied");
    await asOwner(db);
    expect((await db.query("select dismissed from public.firm_members where user_id = $1", [owner])).rows[0].dismissed).toEqual([gst]);
  }));

it("lets only an admin add the line firms see, logged", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect((await attempt(db, "select public.admin_note_update($1, current_date)", [gst])).error).toBe("Orelu admins only");
    await asAdmin();
    expect((await attempt(db, "select public.admin_note_update($1)", [gst])).error).toBe("A date or the periods");
    expect((await attempt(db, "select public.admin_note_update($1, '2026-11-01', 'returns up to Oct 2026')", [gst])).error).toBe("A date or the periods");
    expect((await db.query("select public.admin_note_update($1, '2026-11-01') ok", [gst])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_note_update($1, keeps => ' returns up to Oct 2026 ') ok", [income])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_note_update($1, '2026-11-01') ok", ["d".repeat(16)])).rows[0].ok).toBe(false);
    await actAs(db, owner);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, note: { uses: "2026-11-01" } }]);
    await actAs(db, itOwner);
    expect((await updates(itFirm)).items).toMatchObject([{ id: income, note: { keeps: "returns up to Oct 2026" } }]);
    await asOwner(db);
    expect((await db.query("select firm_id, details from public.activity_log where action = 'admin.update_noted' and actor_id = $1 order by at", [admin])).rows).toEqual([
      { firm_id: null, details: { item: gst, uses: "2026-11-01", keeps: null } },
      { firm_id: null, details: { item: income, uses: null, keeps: "returns up to Oct 2026" } },
    ]);
  }));

it("lets only an admin end a form version, only with the official link, after its first period, logged", () =>
  rollback(db, async () => {
    await seed();
    await asOwner(db);
    await db.query("insert into public.templates(form_code,version,valid_from,status,source,mappings) values ('GSTR1','9.9','2026-04-01','active','{\"file\":\"invented.xlsx\"}','{\"format\":\"xlsx\"}')");
    await actAs(db, owner);
    expect((await attempt(db, "select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'https://cbic-gst.gov.in/invented.pdf')")).error).toBe("Orelu admins only");
    expect((await attempt(db, "update public.templates set valid_until = '2026-10-01' where version = '9.9'")).error).toContain("permission denied");
    await asAdmin();
    expect((await attempt(db, "select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'http://cbic-gst.gov.in/invented.pdf')")).error).toBe("The official link is needed");
    expect((await db.query("select public.admin_end_template('GSTR1', '9.9', '2026-04-01', 'https://cbic-gst.gov.in/invented.pdf') ok")).rows[0].ok).toBe(false);
    expect((await db.query("select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'https://cbic-gst.gov.in/invented.pdf') ok")).rows[0].ok).toBe(true);
    await asOwner(db);
    expect((await db.query("select valid_until::text, status, source from public.templates where form_code = 'GSTR1' and version = '9.9'")).rows[0]).toEqual({ valid_until: "2026-10-01", status: "active", source: { file: "invented.xlsx", ended_by: "https://cbic-gst.gov.in/invented.pdf" } });
    expect((await db.query("select details from public.activity_log where action = 'admin.template_ended' and actor_id = $1", [admin])).rows).toEqual([
      { details: { form: "GSTR1", version: "9.9", until: "2026-10-01", link: "https://cbic-gst.gov.in/invented.pdf" } },
    ]);
  }));

it("runs the daily check at 08:30 India time", async () => {
  expect((await db.query("select schedule from cron.job where jobname = 'forms-watch'")).rows).toEqual([{ schedule: "0 3 * * *" }]);
  expect((await db.query("select ('2026-10-26 03:00:00+00'::timestamptz at time zone 'Asia/Kolkata')::time::text t")).rows[0].t).toBe("08:30:00");
});
