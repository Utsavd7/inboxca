import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Orelu's admin console (M11): only a listed admin past the 2 step code and a passkey check in
// this session reads it, and what it reads is firm health, never a client's name, email,
// documents or figures.
let db: Client;
const firm = "00000000-0000-4000-8000-000000000ad0", owner = "00000000-0000-4000-8000-000000000ad1", admin = "00000000-0000-4000-8000-000000000ad2";
const other = "00000000-0000-4000-8000-000000000ad3";
const session = (id: string) => `${id.slice(0, -3)}c${id.slice(-2)}`;
const calls = ["admin_firms()", "admin_accounts()", "admin_failed_jobs()", "admin_watch()", "admin_retry_job(0)", "admin_review_change('gstr1', 'x')", "admin_people()", `admin_remove_passkeys('${other}')`,
  "admin_post_incident('x', '{app}', 'down')", `admin_update_incident('${firm}', 'x', true)`, `admin_email_incident('${firm}')`, "admin_incidents()", `admin_firm('${firm}')`,
  "admin_reach('{GSTR1_M}')", "admin_verify_rule('GSTR1_M', '', 'https://example.test', 'CA Invented')", "admin_add_extension('GSTR1_M', '2026-09', '2026-10-30', 'https://example.test')",
  "admin_set_office(3, 14)", "admin_office(14)", `admin_ask_support('${firm}')`, `admin_support_view('${firm}')`];

// Acts as a person in their session, with the passkey proof the server sends after a check.
async function asAdmin(person: string, { seconds = 3600, key = "", forSession = session(person) } = {}) {
  await asOwner(db);
  key ||= (await db.query("select public.office_proof_key() as key")).rows[0].key;
  const until = Math.floor(Date.now() / 1000) + seconds;
  await actAs(db, person, "aal2", session(person));
  const proof = `${until}.${createHmac("sha256", key).update(`admin:${person}:${forSession}:${until}`).digest("hex")}`;
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-orelu-admin": proof })]);
}
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@admin-console.test'),($2,'admin@admin-console.test'),($3,'other@admin-console.test')", [owner, admin, other]);
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2),($3,$4),($5,$6)", [session(owner), owner, session(admin), admin, session(other), other]);
  await db.query("insert into public.orelu_admins(user_id) values ($1),($2)", [admin, other]);
  await db.query("insert into public.admin_passkeys(id,user_id,public_key) values ('a-key',$1,'a-public'),('o-key-1',$2,'o-public'),('o-key-2',$2,'o-public')", [admin, other]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Admin Console Test Firm','24','active')", [firm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active')", [firm, owner]);
  const client = (await db.query("insert into public.clients(firm_id,name,kind,email_enc) values ($1,'Invented Secret Client','individual','secret@client.test') returning id", [firm])).rows[0].id;
  await db.query("insert into public.activity_log(firm_id,action,entity_type,entity_id,details) values ($1,'client.changed','client',$2,'{\"name\":\"Invented Secret Client\"}')", [firm, client]);
  const account = (await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,'mail','imap','invented encrypted address','invented encrypted credentials','{\"mail_failures\":{\"read\":2}}') returning id", [firm])).rows[0].id;
  await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,state,last_error_code,run_at) values ($1,'mail_poll','account',$2,'admin-test:1','done',null,now()-interval '2 minutes'),($1,'mail_poll','account',$2,'admin-test:2','pending','mail_sign_in',now())", [firm, account]);
  const job = (await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,state,attempts,last_error_code) values ($1,'read_document','document',$2,'admin-test:3','failed',5,'exception') returning id", [firm, client])).rows[0].id;
  await db.query("insert into public.platform_settings(key,value) values ('watch',$1) on conflict (key) do update set value=excluded.value", [
    JSON.stringify({ sources: {}, changes: [{ source: "gstr1", name: "GSTR-1 tool", url: "https://example.test", at: "2026-10-25T00:00:00.000Z", status: "draft" }], alerts: [] }),
  ]);
  return { job, account };
}

it("refuses a firm owner, an admin before the 2 step code, and an admin without a current passkey proof for this session", () =>
  rollback(db, async () => {
    await seed();
    const refused = async () => {
      for (const call of calls) expect((await attempt(db, `select * from public.${call}`)).error).toBe("Orelu admins only");
      expect((await db.query("select public.is_orelu_admin() ok")).rows[0].ok).toBe(false);
    };
    for (const [person, aal] of [[owner, "aal2"], [admin, "aal1"], [admin, "aal2"]] as const) {
      await actAs(db, person, aal, session(person));
      await refused();
    }
    await asAdmin(owner);
    await refused();
    await asAdmin(admin, { seconds: -10 });
    await refused();
    await asAdmin(admin, { key: "0".repeat(64) });
    await refused();
    await asAdmin(admin, { forSession: session(other) });
    await refused();
    // A signed out session's proof opens nothing.
    await asOwner(db);
    await db.query("delete from auth.sessions where id = $1", [session(admin)]);
    await asAdmin(admin);
    await refused();
  }));

it("lets an admin remove another admin's passkeys, which signs them out and is logged, but not their own", () =>
  rollback(db, async () => {
    await seed();
    await asAdmin(admin);
    expect((await db.query("select * from public.admin_people() where email like '%@admin-console.test'")).rows).toEqual([
      { user_id: admin, email: "admin@admin-console.test", passkeys: 1 },
      { user_id: other, email: "other@admin-console.test", passkeys: 2 },
    ]);
    expect((await attempt(db, "select public.admin_remove_passkeys($1)", [admin])).error).toBe("Another admin removes your passkeys");
    expect((await db.query("select public.admin_remove_passkeys($1) n", [other])).rows[0].n).toBe(2);
    expect((await attempt(db, "select * from public.admin_passkeys")).error).toContain("permission denied");
    await asOwner(db);
    expect((await db.query("select count(*)::int n from public.admin_passkeys where user_id = $1", [other])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from auth.sessions where user_id = $1", [other])).rows[0].n).toBe(0);
    expect((await db.query("select firm_id, actor_id, action, details from public.activity_log where entity_id = $1", [other])).rows).toEqual([
      { firm_id: null, actor_id: admin, action: "admin.passkeys_removed", details: { removed: 2 } },
    ]);
    await asAdmin(other);
    expect((await db.query("select public.is_orelu_admin() ok")).rows[0].ok).toBe(false);
  }));

it("shows an admin each firm's health and no client data, and lets them retry a job and review a change", () =>
  rollback(db, async () => {
    const { job } = await seed();
    await asAdmin(admin);
    const firms = (await db.query("select * from public.admin_firms()")).rows;
    expect(firms.find((row) => row.id === firm)).toMatchObject({ name: "Admin Console Test Firm", members: 1, mailbox: true, drive: false });
    const accounts = (await db.query("select * from public.admin_accounts() where firm = 'Admin Console Test Firm'")).rows;
    expect(accounts).toMatchObject([{ kind: "mail", status: "connected", failures: 2, last_error: "mail_sign_in" }]);
    expect(accounts[0].last_run).not.toBeNull();
    const failed = (await db.query("select * from public.admin_failed_jobs()")).rows;
    expect(failed.find((row) => row.id === job)).toMatchObject({ kind: "read_document", firm: "Admin Console Test Firm", error: "exception" });
    const seen = JSON.stringify([firms, accounts, failed, (await db.query("select public.admin_watch() w")).rows]);
    for (const secret of ["Invented Secret Client", "secret@client.test", "invented encrypted"]) expect(seen).not.toContain(secret);
    expect((await db.query("select count(*)::int n from public.clients where firm_id = $1", [firm])).rows[0].n).toBe(0);

    expect((await db.query("select public.admin_retry_job($1) ok", [job])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_review_change('gstr1', '2026-10-25T00:00:00.000Z') ok")).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_review_change('gstr1', '2026-10-25T00:00:00.000Z') ok")).rows[0].ok).toBe(false);
    await asOwner(db);
    expect((await db.query("select state, attempts from public.jobs where id = $1", [job])).rows[0]).toEqual({ state: "pending", attempts: 0 });
    expect((await db.query("select value #> '{changes,0}' c from public.platform_settings where key = 'watch'")).rows[0].c).toMatchObject({ status: "reviewed", reviewed_by: admin });
    expect((await db.query("select actor_id, firm_id, details from public.activity_log where action = 'admin.job_retried' and details ->> 'job' = $1", [String(job)])).rows).toEqual([{ actor_id: admin, firm_id: null, details: { job: Number(job) } }]);
  }));

it("shows anyone each part's waiting work and the incidents, and lets only an admin post, note, close and email one", () =>
  rollback(db, async () => {
    await seed();
    await asOwner(db);
    await db.query("update public.jobs set state = 'done' where state = 'pending' and run_at < now() and kind in ('reminders', 'bulk_send')");
    await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,state,run_at) values ($1,'reminders','firm',$1,'admin-test:late','pending',now()-interval '2 hours')", [firm]);
    await actAs(db, null);
    const before = (await db.query("select public.service_status() s")).rows[0].s;
    expect(before.late.reminders).toBeGreaterThanOrEqual(7200);
    expect((await attempt(db, "select * from public.incidents")).error).toContain("permission denied");
    expect((await attempt(db, "select public.admin_post_incident('x', '{app}', 'down')")).error).toContain("permission denied");

    await asAdmin(admin);
    const incident = (await db.query("select public.admin_post_incident(' Mail reading is late ', '{mail}', 'slow') id")).rows[0].id;
    expect((await attempt(db, "select public.admin_post_incident('x', '{billing}', 'down')")).error).toContain("incidents_parts_check");
    expect((await db.query("select public.admin_update_incident($1, 'Looking into it', false) ok", [incident])).rows[0].ok).toBe(true);
    // The mail incident's email goes once to firms with a connected mailbox, as ids only.
    expect((await db.query("select public.admin_email_incident($1) n", [incident])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await db.query("select public.admin_email_incident($1) n", [incident])).rows[0].n).toBe(0);
    await asOwner(db);
    expect((await db.query("select firm_id, entity_type from public.jobs where kind = 'outage_email' and entity_id = $1 and firm_id = $2", [incident, firm])).rows).toEqual([{ firm_id: firm, entity_type: "incident" }]);
    await actAs(db, null);
    const shown = (await db.query("select public.service_status() s")).rows[0].s.incidents.find((row: { id: string }) => row.id === incident);
    expect(shown).toMatchObject({ title: "Mail reading is late", parts: ["mail"], level: "slow", ended_at: null, updates: [{ note: "Looking into it" }] });
    expect(JSON.stringify(shown)).not.toContain("Admin Console Test Firm");

    await asAdmin(admin);
    expect((await db.query("select public.admin_update_incident($1, 'Fixed', true) ok", [incident])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_update_incident($1, 'Again', false) ok", [incident])).rows[0].ok).toBe(false);
    expect((await db.query("select public.admin_email_incident($1) n", [incident])).rows[0].n).toBe(0);
    expect((await db.query("select emailed, ended_at is not null closed from public.admin_incidents() where id = $1", [incident])).rows[0]).toMatchObject({ closed: true });
    await asOwner(db);
    expect((await db.query("select action from public.activity_log where entity_id = $1 order by at, action", [incident])).rows.map((row) => row.action).sort())
      .toEqual(["admin.incident_closed", "admin.incident_emailed", "admin.incident_emailed", "admin.incident_posted", "admin.incident_updated"]);
  }));

it("lets an admin record an extension and a CA's check, which clears the rule's mark and moves only unfiled returns", () =>
  rollback(db, async () => {
    await seed();
    await asOwner(db);
    await db.query("insert into public.compliance_types(code,name,frequency,due_rule) values ('ZZ_ADMIN','Invented return','monthly','{\"for\":\"pan\",\"after\":1,\"day\":11}')");
    const client = (await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Calendar Client','individual') returning id", [firm])).rows[0].id;
    await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on,status,details) values ($1,$2,'ZZ_ADMIN','2026-09','2026-10-11','upcoming','{}'),($1,$2,'ZZ_ADMIN','2026-08','2026-09-11','filed','{\"filed_on\":\"2026-09-10\"}')", [firm, client]);
    await asAdmin(admin);
    expect((await db.query("select public.admin_add_extension('ZZ_ADMIN', '2026-09', '2026-10-31', 'https://example.test/notification') ok")).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_add_extension('NOPE', '2026-09', '2026-10-31', 'https://example.test') ok")).rows[0].ok).toBe(false);
    expect((await db.query("select * from public.admin_reach('{ZZ_ADMIN}', '2026-09', '2026-10-31')")).rows).toEqual([{ firm: "Admin Console Test Firm", returns: 1 }]);
    expect((await attempt(db, "select public.admin_verify_rule('ZZ_ADMIN', '', 'https://example.test/rule', ' ')")).error).toBe("Name the CA who checked it");
    expect((await db.query("select public.admin_verify_rule('ZZ_ADMIN', '', 'https://example.test/rule', 'CA Invented Person') ok")).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_verify_rule('ZZ_ADMIN', '', 'https://example.test/rule', 'CA Invented Person') ok")).rows[0].ok).toBe(false);
    // Until a CA checks the extension, the earlier date stands.
    await asOwner(db);
    expect((await db.query("select due_on::text from public.tasks where code = 'ZZ_ADMIN' order by period_key")).rows.map((row) => row.due_on)).toEqual(["2026-09-11", "2026-10-11"]);
    await asAdmin(admin);
    expect((await db.query("select public.admin_verify_rule('ZZ_ADMIN', '2026-09', 'https://example.test/notification', 'CA Invented Person') ok")).rows[0].ok).toBe(true);
    await asOwner(db);
    expect((await db.query("select due_on::text from public.tasks where code = 'ZZ_ADMIN' order by period_key")).rows.map((row) => row.due_on)).toEqual(["2026-09-11", "2026-10-31"]);
    expect((await db.query("select period_key, approved_by, verified_on is not null checked from public.compliance_types where code = 'ZZ_ADMIN' order by period_key")).rows).toEqual([
      { period_key: "", approved_by: "CA Invented Person", checked: true }, { period_key: "2026-09", approved_by: "CA Invented Person", checked: true },
    ]);
    expect((await db.query("select count(*)::int n from public.activity_log where actor_id = $1 and action in ('admin.extension_added', 'admin.rule_verified')", [admin])).rows[0].n).toBe(3);
  }));

it("shows an admin one firm's health and use, the office thresholds and changes, and nothing more", () =>
  rollback(db, async () => {
    const { job } = await seed();
    await asOwner(db);
    await db.query("update public.firms set settings = '{\"office\":{\"on\":true,\"lines\":[{\"ipv4\":\"203.0.113.9\",\"provider\":\"Invented Broadband\",\"seen_on\":\"2026-10-20\"}]}}' where id = $1", [firm]);
    await db.query("insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id) values ($1,$2,'office.confirm','firm',$1),($1,$2,'office.learned','device',$1)", [firm, owner]);
    await asAdmin(admin);
    const view = (await db.query("select public.admin_firm($1) f", [firm])).rows[0].f;
    expect(view).toMatchObject({ name: "Admin Console Test Firm", members: 1, accounts: [{ kind: "mail", status: "connected", failures: 2, last_error: "mail_sign_in" }], failed: [{ id: Number(job), error: "exception" }], support: null });
    expect((await db.query("select returns_this_year from public.firm_usage($1)", [firm])).rows).toHaveLength(1);
    expect((await db.query("select * from public.admin_office(14) where firm = 'Admin Console Test Firm'")).rows).toEqual([
      { firm: "Admin Console Test Firm", provider: "Invented Broadband", fixed: false, declined: false, taps: 1, changes: 2 },
    ]);
    expect((await attempt(db, "select public.admin_set_office(0, 14)")).error).toContain("Choose 1 to 50");
    expect((await db.query("select public.admin_set_office(4, 21) ok")).rows[0].ok).toBe(true);
    for (const secret of ["Invented Secret Client", "secret@client.test", "invented encrypted"]) expect(JSON.stringify(view)).not.toContain(secret);
    await asOwner(db);
    expect((await db.query("select value from public.platform_settings where key = 'office'")).rows[0].value).toMatchObject({ fixed_taps: 4, fixed_days: 21 });
    // A firm owner reads their own meters, and nobody else's.
    await actAs(db, other, "aal2", session(other));
    expect((await db.query("select * from public.firm_usage($1)", [firm])).rows).toEqual([]);
  }));

it("opens a support session only after the owner approves it, for an hour, to the admin who asked, with every step in the firm's log", () =>
  rollback(db, async () => {
    await seed();
    await asAdmin(admin);
    expect((await db.query("select public.admin_ask_support($1) ok", [firm])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_ask_support($1) ok", [firm])).rows[0].ok).toBe(false);
    expect((await db.query("select public.admin_support_view($1) v", [firm])).rows[0].v).toBeNull();
    // Only the owner answers.
    await actAs(db, other, "aal2", session(other));
    expect((await attempt(db, "select public.answer_support($1, 'approve')", [firm])).error).toBe("Only the owner decides");
    await actAs(db, owner, "aal2", session(owner));
    expect((await db.query("select status from public.requests where kind = 'support_access' and entity_id = $1", [firm])).rows).toEqual([{ status: "pending" }]);
    expect((await db.query("select public.answer_support($1, 'approve') ok", [firm])).rows[0].ok).toBe(true);

    await asAdmin(other);
    expect((await db.query("select public.admin_support_view($1) v", [firm])).rows[0].v).toBeNull();
    await asAdmin(admin);
    const look = (await db.query("select public.admin_support_view($1) v", [firm])).rows[0].v;
    expect(look).toMatchObject({ people: [{ email: "owner@admin-console.test", role: "owner", status: "active" }], clients: 1, names: ["Invented Secret Client"] });
    expect(Date.parse(look.until) - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(Date.parse(look.until) - Date.now()).toBeLessThanOrEqual(3600_000);

    await actAs(db, owner, "aal2", session(owner));
    expect((await db.query("select public.answer_support($1, 'end') ok", [firm])).rows[0].ok).toBe(true);
    expect((await db.query("select action from public.activity_log where firm_id = $1 and action like 'support.%' order by at", [firm])).rows.map((row) => row.action).sort())
      .toEqual(["support.approved", "support.asked", "support.ended", "support.viewed"]);
    await asAdmin(admin);
    expect((await db.query("select public.admin_support_view($1) v", [firm])).rows[0].v).toBeNull();
    // Ended, it can be asked for again; a lapsed hour opens nothing.
    expect((await db.query("select public.admin_ask_support($1) ok", [firm])).rows[0].ok).toBe(true);
    await asOwner(db);
    await db.query("update public.requests set status = 'approved', expires_at = now() - interval '1 second' where kind = 'support_access' and entity_id = $1", [firm]);
    await asAdmin(admin);
    expect((await db.query("select public.admin_support_view($1) v", [firm])).rows[0].v).toBeNull();
  }));
