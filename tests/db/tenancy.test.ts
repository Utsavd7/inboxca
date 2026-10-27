import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Two firms, A and B. Every check runs inside a transaction that is rolled back.
const FIRM_A = "00000000-0000-4000-8000-00000000000a";
const FIRM_B = "00000000-0000-4000-8000-00000000000b";
const OWNER_A = "00000000-0000-4000-8000-0000000000a1";
const STAFF_A = "00000000-0000-4000-8000-0000000000a2";
const LEFT_A = "00000000-0000-4000-8000-0000000000a3";
const OWNER_B = "00000000-0000-4000-8000-0000000000b1";
const NEW_PERSON = "00000000-0000-4000-8000-0000000000c1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const id of [OWNER_A, STAFF_A, LEFT_A, OWNER_B, NEW_PERSON])
    await db.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${id.slice(-2)}@example.test`,
    ]);
  await db.query(
    "insert into public.firms (id, name, gstin, status) values ($1, 'Firm A', '27ABCDE1234F1Z5', 'active')",
    [FIRM_A],
  );
  await db.query(
    "insert into public.firms (id, name, state_code, status) values ($1, 'Firm B', '24', 'active')",
    [FIRM_B],
  );
  const members: [string, string, string, string][] = [
    [FIRM_A, OWNER_A, "owner", "active"],
    [FIRM_A, STAFF_A, "staff", "active"],
    [FIRM_A, LEFT_A, "staff", "deactivated"],
    [FIRM_B, OWNER_B, "owner", "active"],
  ];
  for (const row of members)
    await db.query(
      "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, $4)",
      row,
    );
  await db.query(
    "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'GST team'), ($2, 'branch', 'Surat')",
    [FIRM_A, FIRM_B],
  );
  await db.query(
    "insert into public.activity_log (firm_id, actor_id, action) values ($1, $2, 'client.created'), ($3, $4, 'client.created')",
    [FIRM_A, OWNER_A, FIRM_B, OWNER_B],
  );
}

const ids = (rows: { id?: string; firm_id?: string }[]) =>
  rows.map((row) => row.id ?? row.firm_id).sort();

describe("one firm never sees another", () => {
  it("shows a person only their own firm's rows, in every table", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      expect(ids((await db.query("select id from public.firms")).rows)).toEqual([FIRM_A]);
      expect(ids((await db.query("select firm_id from public.groups")).rows)).toEqual([FIRM_A]);
      const people = await db.query("select distinct firm_id from public.firm_members");
      expect(ids(people.rows)).toEqual([FIRM_A]);
      const log = await db.query("select distinct firm_id from public.activity_log");
      expect(ids(log.rows)).toEqual([FIRM_A]);
    }));

  it("cannot change another firm, even by its id", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      const renamed = await attempt(db, "update public.firms set name = 'Taken' where id = $1", [FIRM_B]);
      expect(renamed).toMatchObject({ ok: true, count: 0 });
      const joined = await attempt(
        db,
        "insert into public.firm_members (firm_id, user_id, role) values ($1, $2, 'staff')",
        [FIRM_B, NEW_PERSON],
      );
      expect(joined.ok).toBe(false);
      const grouped = await attempt(
        db,
        "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'x')",
        [FIRM_B],
      );
      expect(grouped.ok).toBe(false);
    }));

  it("shows nothing to someone who has left the firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, LEFT_A);
      expect((await db.query("select id from public.firms")).rowCount).toBe(0);
      expect((await db.query("select firm_id from public.firm_members")).rowCount).toBe(0);
    }));

  it("shows nothing until the second sign in step has passed", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A, "aal1");
      for (const table of ["firms", "groups", "firm_members", "activity_log"])
        expect((await db.query(`select 1 from public.${table}`)).rowCount).toBe(0);
      expect(
        await attempt(db, "update public.firms set name = 'x' where id = $1", [FIRM_A]),
      ).toMatchObject({ ok: true, count: 0 });
    }));

  it("shows nothing at all to a visitor who is not signed in", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, null);
      for (const table of ["firms", "groups", "firm_members", "activity_log"])
        expect((await attempt(db, `select 1 from public.${table}`)).ok).toBe(false);
    }));
});

describe("what each role may change", () => {
  it("lets the owner rename the firm but not change its status or GSTIN", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      expect(
        await attempt(db, "update public.firms set name = 'Firm A and Co' where id = $1", [FIRM_A]),
      ).toMatchObject({ ok: true, count: 1 });
      expect(
        (await attempt(db, "update public.firms set status = 'active' where id = $1", [FIRM_A])).ok,
      ).toBe(false);
      expect(
        (await attempt(db, "update public.firms set gstin = null where id = $1", [FIRM_A])).ok,
      ).toBe(false);
    }));

  it("does not let staff change the firm or its groups", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF_A);
      expect(
        await attempt(db, "update public.firms set name = 'Mine' where id = $1", [FIRM_A]),
      ).toMatchObject({ ok: true, count: 0 });
      expect(
        (await attempt(db, "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'x')", [FIRM_A])).ok,
      ).toBe(false);
    }));

});

describe("the activity log is append only", () => {
  it("is read by the owner only", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF_A);
      expect((await db.query("select 1 from public.activity_log")).rowCount).toBe(0);
    }));

  it("cannot be written, changed or removed by anyone signed in", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER_A);
      const write = await attempt(
        db,
        "insert into public.activity_log (firm_id, action) values ($1, 'x')",
        [FIRM_A],
      );
      expect(write.ok).toBe(false);
      expect((await attempt(db, "update public.activity_log set action = 'x'")).ok).toBe(false);
      expect((await attempt(db, "delete from public.activity_log")).ok).toBe(false);
    }));

  it("refuses changes even from the server and the database owner", () =>
    rollback(db, async () => {
      await seed();
      await db.query("set local role service_role");
      expect(
        (await attempt(db, "insert into public.activity_log (firm_id, action) values ($1, 'x')", [FIRM_A])).ok,
      ).toBe(true);
      expect((await attempt(db, "update public.activity_log set action = 'y'")).ok).toBe(false);
      await asOwner(db);
      expect((await attempt(db, "update public.activity_log set action = 'y'")).ok).toBe(false);
      expect((await attempt(db, "delete from public.activity_log")).ok).toBe(false);
      expect((await attempt(db, "truncate public.activity_log")).ok).toBe(false);
    }));

  it("lets only the purge, marked for its own transaction, remove rows", () =>
    rollback(db, async () => {
      await seed();
      await db.query("select set_config('app.log_purge', 'on', true)");
      expect(
        await attempt(db, "delete from public.activity_log where firm_id = $1 and action = 'client.created'", [FIRM_B]),
      ).toMatchObject({ ok: true, count: 1 });
    }));
});

describe("nothing is stored twice", () => {
  it("reads a firm's state from its GSTIN, and stores it only when there is none", () =>
    rollback(db, async () => {
      await seed();
      const states = await db.query(
        "select id, public.firm_state(f) as state from public.firms f where id = any($1) order by name",
        [[FIRM_A, FIRM_B]],
      );
      expect(states.rows.map((row) => row.state)).toEqual(["27", "24"]);
      const both = await attempt(
        db,
        "insert into public.firms (name, gstin, state_code) values ('C', '24ABCDE1234F1Z5', '24')",
      );
      expect(both.ok).toBe(false);
    }));
});

// Every table and every function a signed in person may call, read from the catalog, so this
// grows with each new one (PLAN.md 8.5, 11). Each of two firms gets a row in every firm table;
// nobody in firm A, whatever their role, nor a visitor, may read, change, remove or copy firm
// B's rows, point firm A's rows at them, or get them from a function.
const SCOPE: Record<string, string> = { firms: "id" }; // every other firm table: firm_id
// Tables that belong to no firm, and why.
const NOT_FIRM: Record<string, string> = {
  compliance_types: "the due date catalog every firm reads",
  templates: "the government form catalog every firm reads",
  orelu_admins: "Orelu's own admins, server only",
  admin_passkeys: "Orelu's own admins, server only",
  passkeys: "a person's own passkeys, used for every firm they are in, server only",
  platform_settings: "Orelu's own settings, server only",
  push_subscriptions: "a person's phones, server only",
  incidents: "Orelu's outage notes for the status page, server only",
  official_files: "official government files kept by their hash, server only",
  guarantee_claims: "keyed hashes for the money-back guarantee once per firm, no firm's data, server only",
};
const ROLES = ["owner", "partner", "manager", "staff", "front_desk"] as const;
// Definer functions a visitor who is not signed in may call, and why.
const VISITOR_CALLS: Record<string, string> = {
  service_status: "the public status page: how late each part's work is, and Orelu's incidents; no firm's data",
};

// A firm with one of each row: a new firm table needs a line here.
const ROWS = ["client", "registration", "contact", "task", "mail", "drive", "email", "document", "share", "request", "dataset", "device"] as const;
async function seedEvery(tag: string) {
  const ids = Object.fromEntries(["firm", "team", "branch", "clientGroup", "ledger", ...ROWS].map((key) => [key, randomUUID()])) as Record<"firm" | "team" | "branch" | "clientGroup" | "ledger" | (typeof ROWS)[number], string>;
  const people = Object.fromEntries(ROLES.map((role) => [role, randomUUID()])) as Record<(typeof ROLES)[number], string>;
  const name = `Invented Firm ${tag} ${ids.firm.slice(0, 8)}`;
  const run = (sql: string, params: unknown[]) => db.query(sql, [ids.firm, ...params]);
  await asOwner(db);
  await db.query("insert into auth.users (id, email) select unnest($1::uuid[]), unnest($2::text[])", [Object.values(people), ROLES.map((role) => `${role}-${ids.firm}@isolation.test`)]);
  await run("insert into public.firms (id, name, state_code, status) values ($1, $2, '24', 'active')", [name]);
  await run("insert into public.groups (id, firm_id, kind, name) values ($2, $1, 'team', 'Team'), ($3, $1, 'branch', 'Branch'), ($4, $1, 'client_group', 'Group')", [ids.team, ids.branch, ids.clientGroup]);
  await run("insert into public.firm_members (firm_id, user_id, role, status, team_id) select $1, unnest($2::uuid[]), unnest($3::text[]), 'active', $4", [Object.values(people), ROLES, ids.team]);
  await run("insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, group_id, branch_id) values ($2, $1, 'Invented Client', 'business', 'sealed', $2::uuid::text, $3, $4)", [ids.client, ids.clientGroup, ids.branch]);
  await run("insert into public.client_registrations (id, firm_id, client_id, kind, number_enc, number_bidx, state_code) values ($2, $1, $3, 'gstin', 'sealed', $2::uuid::text, '24')", [ids.registration, ids.client]);
  await run("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [ids.client, people.staff]);
  await run("insert into public.contacts (id, firm_id, name_enc, email_enc, email_bidx) values ($2, $1, 'sealed', 'sealed', $2::uuid::text)", [ids.contact]);
  await run("insert into public.contact_clients (firm_id, contact_id, client_id) values ($1, $2, $3)", [ids.contact, ids.client]);
  await run("insert into public.tasks (id, firm_id, client_id, kind, due_on) values ($2, $1, $3, 'notice', current_date)", [ids.task, ids.client]);
  await run("insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc) values ($2, $1, 'mail', 'imap', 'sealed', 'sealed'), ($3, $1, 'drive', 'local', 'sealed', 'sealed')", [ids.mail, ids.drive]);
  await run("insert into public.email_events (id, firm_id, account_id, provider_message_id, sender_bidx, received_at, client_id, contact_id) values ($2, $1, $3, $2::uuid::text, 'sealed', now(), $4, $5)", [ids.email, ids.mail, ids.client, ids.contact]);
  await run("insert into public.documents (id, firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256, email_event_id, registration_id) values ($2, $1, $3, 'gst', 'Invoice', 'file', 'invoice.pdf', 1, $2::uuid::text, $4, $5)", [ids.document, ids.client, ids.email, ids.registration]);
  await run("insert into public.shares (id, firm_id, document_id, contact_id, email_event_id, status) values ($2, $1, $3, $4, $5, 'waiting')", [ids.share, ids.document, ids.contact, ids.email]);
  await run(`insert into public.gst_matches (firm_id, register_id, statement_id, counts, result_enc) values ($1, $2, $2, '{"matched": 0, "missing": 0, "extra": 0, "differ": 0}', 'sealed')`, [ids.document]);
  await run("insert into public.requests (id, firm_id, kind, client_id, entity_type, entity_id, status, details) values ($2, $1, 'documents', $3, 'client', $2, 'pending', '{}')", [ids.request, ids.client]);
  await run(`insert into public.datasets (id, firm_id, client_id, form_code, period_key, data) values ($2, $1, $3, 'GSTR1', '2026-09', '{"lines":[{}]}')`, [ids.dataset, ids.client]);
  await run("insert into public.devices (id, firm_id, token_hash, name) values ($2, $1, $3, 'Front desk PC')", [ids.device, createHash("sha256").update(ids.device).digest("hex")]);
  await run("insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'client.added', 'client', $3)", [people.owner, ids.client]);
  await run("insert into public.firm_keys (firm_id, wrapped_key) values ($1, 'sealed')", []);
  await run("insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'reminders', 'client', $2, $2::uuid::text)", [ids.client]);
  await run("insert into public.usage_ledger (firm_id, due_on, ref) values ($1, current_date, $2)", [ids.ledger]);
  await run("insert into public.subscriptions (firm_id, cycle, plan) values ($1, 'monthly', '{}')", []);
  await run("insert into public.payments (firm_id, kind, amount_paise) values ($1, 'plan', 100)", []);
  return { ...ids, name, people };
}

// The firm tables, with the column that names their firm.
async function firmTables() {
  const { rows } = await db.query(`select c.relname name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and (c.relname = 'firms' or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'firm_id' and not a.attisdropped))
    order by 1`);
  return rows.map((row) => ({ name: row.name as string, scope: SCOPE[row.name] ?? "firm_id" }));
}

// What the current role may do to a table, column by column.
async function rights(table: string) {
  const { rows } = await db.query(`select coalesce(array_agg(attname::text) filter (where has_column_privilege(attrelid, attnum, 'INSERT') and attidentity <> 'a'), '{}') insert,
      coalesce(array_agg(attname::text) filter (where has_column_privilege(attrelid, attnum, 'UPDATE')), '{}') update,
      has_table_privilege(attrelid, 'DELETE') delete
    from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = '' group by attrelid`, [`public.${table}`]);
  return rows[0] as { insert: string[]; update: string[]; delete: boolean };
}

// The refusals that come before a row is written: no right, a policy, or a trigger's own check.
const refused = (result: Awaited<ReturnType<typeof attempt>>) => !result.ok && ["42501", "P0001"].includes(result.code ?? "");

// Every definer function a signed in person may call, with firm B's ids where it takes any;
// `about` marks calls about firm B, which must answer no.
const CALLS: [name: string, sql: string, params: string[], about: boolean][] = [
  ["accept_invite", "select public.accept_invite($1) r", ["firm"], true],
  ["access_check", "select public.access_check($1, $2, null, null, null) r", ["firm", "staff"], true],
  ["activity_feed", "select * from public.activity_feed($1, now() - interval '1 year', false)", ["firm"], true],
  ["add_clients", `select public.add_clients($1, '[{"name": "Taken", "kind": "business"}]') r`, ["firm"], true],
  ["admin_accounts", "select * from public.admin_accounts()", [], false],
  ["admin_add_extension", "select public.admin_add_extension('GSTR1', '2026-09', current_date, 'https://example.test') r", [], true],
  ["admin_billing", "select public.admin_billing() r", [], false],
  ["admin_pilot", "select public.admin_pilot($1) r", ["firm"], true],
  ["admin_set_tax", "select public.admin_set_tax('{}') r", [], true],
  ["admin_add_template","select public.admin_add_template('gst_offline_tool', '2026-10-26T03:00:00.000Z', 'GSTR1.xlsx', current_date) r", [], true],
  ["admin_ask_support", "select public.admin_ask_support($1) r", ["firm"], true],
  ["admin_email_incident", "select public.admin_email_incident(gen_random_uuid()) r", [], true],
  ["admin_end_template", "select public.admin_end_template('GSTR1', '2.2', current_date, 'https://cbic-gst.gov.in/x.pdf') r", [], true],
  ["admin_failed_jobs", "select * from public.admin_failed_jobs()", [], false],
  ["admin_firm", "select public.admin_firm($1) r", ["firm"], true],
  ["admin_firms", "select * from public.admin_firms()", [], false],
  ["admin_incidents", "select * from public.admin_incidents()", [], false],
  ["admin_note_update", "select public.admin_note_update('0123456789abcdef', current_date) r", [], true],
  ["admin_office", "select * from public.admin_office(30)", [], false],
  ["admin_people", "select * from public.admin_people()", [], false],
  ["admin_post_incident", "select public.admin_post_incident('Taken', '{app}', 'slow') r", [], true],
  ["admin_reach", "select * from public.admin_reach('{GSTR1}')", [], false],
  ["admin_remove_passkeys", "select public.admin_remove_passkeys($1) r", ["owner"], true],
  ["admin_retry_job", "select public.admin_retry_job($1) r", ["job"], true],
  ["admin_review_change", "select public.admin_review_change('forms', now()::text) r", [], true],
  ["admin_set_office", "select public.admin_set_office(2, 7) r", [], true],
  ["admin_support_view", "select public.admin_support_view($1) r", ["firm"], true],
  ["admin_update_incident", "select public.admin_update_incident(gen_random_uuid(), 'x', true) r", [], true],
  ["admin_verify_rule", "select public.admin_verify_rule('GSTR1', '2026-09', 'https://example.test', 'x') r", [], true],
  ["admin_watch", "select public.admin_watch() r", [], false],
  ["answer_support", "select public.answer_support($1, 'approve') r", ["firm"], true],
  ["assigned_clients", "select * from public.assigned_clients()", [], false],
  ["can_access_client", "select public.can_access_client($1, $2) r", ["firm", "client"], true],
  ["can_review_office", "select public.can_review_office($1) r", ["firm"], true],
  ["change_role", "select public.change_role($1, $2, 'manager') r", ["firm", "staff"], true],
  ["client_activity", "select * from public.client_activity($1)", ["client"], true],
  ["clients_with_right", "select * from public.clients_with_right('download')", [], false],
  ["close_firm", "select public.close_firm($1, $2) r", ["firm", "name"], true],
  ["closed_firms", "select * from public.closed_firms()", [], false],
  ["connect_drive", "select public.connect_drive($1, gen_random_uuid(), 'local', 'x', 'x', '{}', 'folder', 'v1') r", ["firm"], true],
  ["end_other_sessions", "select public.end_other_sessions() r", [], false],
  ["firm_export", "select public.firm_export($1) r", ["firm"], true],
  ["firm_people", "select * from public.firm_people($1)", ["firm"], true],
  ["firm_usage", "select * from public.firm_usage($1, current_date)", ["firm"], true],
  ["due_fills", "select * from public.due_fills($1)", ["firm"], true],
  ["queue_fills", "select * from public.queue_fills($1, gen_random_uuid())", ["firm"], true],
  ["stop_fills", "select public.stop_fills($1, gen_random_uuid(), 0) r", ["firm"], true],
  ["gov_updates", "select public.gov_updates($1) r", ["firm"], true],
  ["dismiss_gov_update", "select public.dismiss_gov_update($1, '0123456789abcdef') r", ["firm"], true],
  ["invite_member", "select public.invite_member($1, $2, 'staff') r", ["firm", "outsider"], true],
  ["is_orelu_admin", "select public.is_orelu_admin() r", [], true],
  ["member_role", "select public.member_role($1) r", ["firm"], true],
  ["my_firms", "select * from public.my_firms()", [], false],
  ["my_invites", "select * from public.my_invites()", [], false],
  ["office_allows", "select public.office_allows('{}', 'staff') r", [], false],
  ["open_firms", "select * from public.open_firms()", [], false],
  ["remove_member", "select public.remove_member($1, $2) r", ["firm", "staff"], true],
  ["restore_member", "select public.restore_member($1, $2) r", ["firm", "staff"], true],
  ["review_firms", "select * from public.review_firms()", [], false],
  ["service_status", "select public.service_status() r", [], false],
  ["session_live", "select public.session_live() r", [], false],
];

describe("every table and function, from the catalog", () => {
  it("has row level security on, a policy where signed in people reach it, and a place in the check across firms", () =>
    rollback(db, async () => {
      const b = await seedEvery("B");
      const { rows } = await db.query(`select c.relname name, c.relkind kind, c.relrowsecurity rls,
          exists (select 1 from pg_policy p where p.polrelid = c.oid) policy,
          coalesce(c.reloptions::text like '%security_invoker=true%', false) invoker,
          exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'firm_id' and not a.attisdropped) firm,
          has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege('anon', c.oid, 'select,insert,update,references') visitor,
          has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references') reached,
          has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') or has_any_column_privilege('authenticated', c.oid, 'insert,update') writes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'graphql_public') and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition order by 1`);
      const problems: string[] = [];
      for (const t of rows) {
        const table = t.kind === "r" || t.kind === "p";
        if (table && !t.rls) problems.push(`${t.name}: row level security is off`);
        if (!table && t.reached && !t.invoker) problems.push(`${t.name}: a view signed in people reach without security_invoker`);
        if (t.visitor) problems.push(`${t.name}: a visitor who is not signed in can reach it`);
        if (table && t.reached && !t.policy) problems.push(`${t.name}: signed in people reach it, but no policy says what they see`);
        if (t.name in NOT_FIRM && t.writes) problems.push(`${t.name}: belongs to no firm, yet signed in people can change it`);
        if (!t.firm && t.name !== "firms" && !(t.name in NOT_FIRM)) problems.push(`${t.name}: not checked across firms; give it firm_id, or list it in NOT_FIRM with the reason`);
        if (table && (t.firm || t.name === "firms")) {
          const seeded = await db.query(`select count(*)::int n from public.${t.name} where ${SCOPE[t.name] ?? "firm_id"} = $1`, [b.firm]);
          if (!seeded.rows[0].n) problems.push(`${t.name}: add a row for it to seedEvery, so the check across firms covers it`);
        }
      }
      // Secrets stay with the server (PLAN.md 8.4): nobody signed in, nor a visitor, reads a
      // credential, a password, a wrapped key or a token's or code's hash.
      const secrets = await db.query(`select c.relname || '.' || a.attname name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
          and a.attname ~ '(credential|password|secret|wrapped_key|token_hash|code_hash|private_key)'
          and (has_column_privilege('authenticated', c.oid, a.attnum, 'select') or has_column_privilege('anon', c.oid, a.attnum, 'select'))`);
      for (const column of secrets.rows) problems.push(`${column.name}: a secret signed in people can read`);
      // Tenant consistent keys (PLAN.md 11): a key from one firm row to another names the firm.
      const loose = await db.query(`select t.relname || '.' || c.conname name from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace and r.relnamespace = 'public'::regnamespace and r.relname <> 'firms'
          and exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'firm_id') and exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = 'firm_id')
          and not exists (select 1 from unnest(c.conkey, c.confkey) k(mine, theirs) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.mine
            join pg_attribute f on f.attrelid = c.confrelid and f.attnum = k.theirs where a.attname = 'firm_id' and f.attname = 'firm_id')`);
      for (const key of loose.rows) problems.push(`${key.name}: a key between firm rows without firm_id, so a row could point at another firm's`);
      const schemas = await db.query("select nspname from pg_namespace where nspname not in ('public', 'graphql_public', 'graphql', 'extensions', 'auth', 'storage', 'net', 'supabase_functions', 'information_schema', 'pg_catalog') and (has_schema_privilege('anon', oid, 'usage') or has_schema_privilege('authenticated', oid, 'usage'))");
      for (const s of schemas.rows) problems.push(`schema ${s.nspname}: reachable by people, but not checked here`);
      expect(problems).toEqual([]);
    }));

  it("lists every definer function a signed in person may call, and a visitor calls none", async () => {
    const { rows } = await db.query(`select p.proname name, has_function_privilege('anon', p.oid, 'execute') visitor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
      order by 1`);
    expect(rows.filter((row) => row.visitor && !(row.name in VISITOR_CALLS)).map((row) => row.name)).toEqual([]);
    expect(rows.map((row) => row.name)).toEqual(CALLS.map(([name]) => name).sort());
  });

  it("shows, changes, removes, copies and links nothing of firm B for anyone in firm A, or a visitor", () =>
    rollback(db, async () => {
      const a = await seedEvery("A");
      const b = await seedEvery("B");
      const tables = await firmTables();
      const rowOf = async (table: string, scope: string, firm: string) =>
        (await db.query(`select to_jsonb(t) r from public.${table} t where ${scope} = $1 limit 1`, [firm])).rows[0]?.r as Record<string, unknown>;
      const rowsA: Record<string, Record<string, unknown>> = {};
      const rowsB: Record<string, Record<string, unknown>> = {};
      for (const { name, scope } of tables) [rowsA[name], rowsB[name]] = [await rowOf(name, scope, a.firm), await rowOf(name, scope, b.firm)];
      // Foreign keys between firm tables, and the unique columns a copied row must not repeat.
      const { rows: keys } = await db.query(`select t.relname "table", r.relname ref,
          array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) cols,
          array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) refcols
        from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace and r.relnamespace = 'public'::regnamespace`);
      const { rows: uniques } = await db.query(`select t.relname "table", a.attname::text col, a.atttypid::regtype::text type
        from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype in ('p', 'u') and c.connamespace = 'public'::regnamespace and a.attname <> 'firm_id'`);
      const { rows: [{ id: job }] } = await db.query("select id::text from public.jobs where firm_id = $1 limit 1", [b.firm]);
      const values: Record<string, string> = { firm: b.firm, client: b.client, name: b.name, owner: b.people.owner, staff: b.people.staff, job, outsider: randomUUID() };
      const secretsOf = (firm: typeof b) => [firm.firm, firm.name, ...Object.values(firm.people), ...ROWS.map((key) => firm[key])];
      const secrets = secretsOf(b);
      const fingerprint = async () => {
        await asOwner(db);
        const parts: string[] = [];
        for (const { name, scope } of tables)
          parts.push((await db.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from public.${name} t where ${scope} = $1`, [b.firm])).rows[0].h);
        parts.push((await db.query("select md5(coalesce(string_agg(u::text, '|' order by u::text), '')) h from auth.users u where id = any($1)", [Object.values(b.people)])).rows[0].h);
        return parts.join(" ");
      };
      const before = await fingerprint();
      const problems: string[] = [];
      for (const [role, person] of [...ROLES.map((role) => [role, a.people[role]] as const), ["visitor", null] as const]) {
        await actAs(db, person);
        for (const { name, scope } of tables) {
          const may = await rights(name);
          const seen = await attempt(db, `select count(*)::int n from public.${name} where ${scope} = $1`, [b.firm]);
          if (seen.ok && seen.rows[0].n) problems.push(`${role} sees firm B's ${name}`);
          if (role === "owner" && may.insert.length + may.update.length + Number(may.delete) > 0) {
            const own = await attempt(db, `select count(*)::int n from public.${name} where ${scope} = $1`, [a.firm]);
            if (!own.ok || !own.rows[0].n) problems.push(`the owner sees none of their own ${name}, so this check proves nothing there`);
          }
          if (may.update.length) {
            const changed = await attempt(db, `update public.${name} set ${may.update.map((col) => `${col} = ${col}`).join(", ")} where ${scope} = $1`, [b.firm]);
            if (changed.ok ? changed.count : !refused(changed)) problems.push(`${role} changes firm B's ${name} (${changed.ok ? "changed" : changed.code})`);
          }
          if (may.delete) {
            const removed = await attempt(db, `delete from public.${name} where ${scope} = $1`, [b.firm]);
            if (removed.ok ? removed.count : !refused(removed)) problems.push(`${role} removes firm B's ${name} (${removed.ok ? "removed" : removed.code})`);
          }
          const insert = (row: Record<string, unknown>) => {
            const cols = may.insert.filter((col) => row[col] !== null && row[col] !== undefined);
            return attempt(db, `insert into public.${name} (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_record(null::public.${name}, $1)`, [row]);
          };
          if (may.insert.length) {
            const copied = await insert(rowsB[name]);
            if (!refused(copied)) problems.push(`${role} adds a row to firm B's ${name} (${copied.ok ? "added" : copied.code})`);
          }
          if (may.update.includes(scope)) {
            const moved = await attempt(db, `update public.${name} set ${scope} = $1 where ${scope} = $2`, [b.firm, a.firm]);
            if (moved.ok && moved.count) problems.push(`${role} moves firm A's ${name} to firm B`);
          }
          // Pointing firm A's rows at firm B's: tenant consistent keys refuse it (PLAN.md 11).
          for (const key of keys.filter((key) => key.table === name && rowsB[key.ref])) {
            const cols = (key.cols as string[]).filter((col) => col !== "firm_id");
            if (!cols.length) continue;
            const theirs = Object.fromEntries(cols.map((col) => [col, rowsB[key.ref][key.refcols[key.cols.indexOf(col)]]]));
            if (cols.every((col) => may.update.includes(col))) {
              const linked = await attempt(db, `update public.${name} set ${cols.map((col, at) => `${col} = $${at + 2}`).join(", ")} where ${scope} = $1`, [a.firm, ...Object.values(theirs)]);
              if (linked.ok && linked.count) problems.push(`${role} points firm A's ${name} at firm B's ${key.ref}`);
            }
            if (cols.every((col) => may.insert.includes(col))) {
              const fresh = Object.fromEntries(uniques.filter((u) => u.table === name && !cols.includes(u.col)).map((u) => [u.col, u.type === "uuid" ? randomUUID() : `fresh-${randomUUID()}`]));
              const added = await insert({ ...rowsA[name], ...fresh, ...theirs });
              if (added.ok || added.code === "23505") problems.push(`${role} adds a row to firm A's ${name} that points at firm B's ${key.ref} (${added.ok ? "added" : added.code})`);
            }
          }
        }
        for (const [fn, sql, params, about] of CALLS) {
          const called = await attempt(db, sql, params.map((key) => values[key]));
          if (!called.ok) continue;
          const text = JSON.stringify(called.rows);
          if ((role === "visitor" ? [...secrets, ...secretsOf(a)] : secrets).some((secret) => text.includes(secret))) problems.push(`${role}: ${fn} hands over a firm's data`);
          if (about && /":(true\b|[1-9])/.test(text)) problems.push(`${role}: ${fn} says yes for firm B (${text})`);
        }
      }
      expect(problems).toEqual([]);
      expect(await fingerprint()).toBe(before);
    }));
});
