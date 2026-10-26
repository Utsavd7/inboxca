import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// The client register. Numbers arrive already encrypted by the app; here they are stand-ins.
const FIRM = "00000000-0000-4000-8000-0000000004a0";
const OTHER = "00000000-0000-4000-8000-0000000004b0";
const OWNER = "00000000-0000-4000-8000-0000000004a1";
const STAFF = "00000000-0000-4000-8000-0000000004a2";
const OUTSIDER = "00000000-0000-4000-8000-0000000004b1";
const CLIENT = "00000000-0000-4000-8000-0000000004c1";
const pan = (index: string) => [{ kind: "pan", number_enc: "sealed", number_bidx: index, state_code: null }];

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const id of [OWNER, STAFF, OUTSIDER])
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@clients.test`]);
  await db.query(
    "insert into public.firms (id, name, state_code, status) values ($1, 'Client Firm', '27', 'active'), ($2, 'Other', '24', 'active')",
    [FIRM, OTHER],
  );
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($4, $5, 'owner', 'active')",
    [FIRM, OWNER, STAFF, OTHER, OUTSIDER],
  );
}
const add = async (firm: string, client: string, registrations: object[]) =>
  (
    await db.query("select public.add_clients($1, $2) as added", [
      firm,
      JSON.stringify([{ id: client, name: "Patel Textiles", kind: "business", registrations }]),
    ])
  ).rows[0].added === 1;

describe("the client register", () => {
  it("lets the owner add a client with its numbers, logged; staff only view", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, STAFF);
      expect(await add(FIRM, CLIENT, pan("i1"))).toBe(false);
      await actAs(db, OWNER);
      expect(await add(FIRM, CLIENT, pan("i1"))).toBe(true);
      await actAs(db, STAFF);
      expect((await db.query("select name from public.clients")).rows).toEqual([{ name: "Patel Textiles" }]);
      expect((await db.query("select kind from public.client_registrations")).rows).toEqual([{ kind: "pan" }]);
      expect((await attempt(db, "insert into public.clients (firm_id, name, kind) values ($1, 'x', 'individual')", [FIRM])).ok).toBe(false);
      await asOwner(db);
      const log = await db.query("select actor_id from public.activity_log where firm_id = $1 and action = 'client.added'", [FIRM]);
      expect(log.rows).toEqual([{ actor_id: OWNER }]);
    }));

  it("keeps each firm's clients to itself, and adds nothing to another firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      expect(await add(OTHER, "00000000-0000-4000-8000-0000000004c2", pan("i2"))).toBe(false);
      await actAs(db, OUTSIDER);
      expect((await db.query("select 1 from public.clients")).rowCount).toBe(0);
      expect((await db.query("select 1 from public.client_registrations")).rowCount).toBe(0);
    }));

  it("refuses the same number twice in one firm", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("same"));
      const again = await attempt(db, "select public.add_clients($1, $2)", [
        FIRM,
        JSON.stringify([{ id: "00000000-0000-4000-8000-0000000004c3", name: "Copy", kind: "individual", registrations: pan("same") }]),
      ]);
      expect(again).toMatchObject({ ok: false });
    }));

  it("lets the owner change, number and archive a client, logs each change, and keeps staff to viewing", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      await actAs(db, STAFF);
      expect(await attempt(db, "update public.clients set name = 'Changed'")).toMatchObject({ ok: true, count: 0 });
      expect((await attempt(db, "delete from public.client_registrations")).count ?? 0).toBe(0);
      await actAs(db, OWNER);
      await db.query("update public.clients set name = 'Patel Textiles Pvt', archived_at = now() where id = $1", [CLIENT]);
      await db.query(
        "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, 'tan', 'sealed', 't1')",
        [FIRM, CLIENT],
      );
      await db.query("delete from public.client_registrations where kind = 'pan'");
      await asOwner(db);
      const log = await db.query(
        "select action, details from public.activity_log where firm_id = $1 and action <> 'client.added' order by action",
        [FIRM],
      );
      expect(log.rows).toEqual([
        { action: "client.changed", details: { changed: ["name", "archived_at"] } },
        { action: "registration.added", details: { kind: "pan" } },
        { action: "registration.added", details: { kind: "tan" } },
        { action: "registration.removed", details: { kind: "pan" } },
      ]);
    }));

  it("keeps a number with filed returns, removes one without, and still deletes a client whole", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, [...pan("k1"), { kind: "gstin", number_enc: "sealed", number_bidx: "k2", state_code: "27" }]);
      await asOwner(db);
      const numbers = Object.fromEntries((await db.query("select kind, id from public.client_registrations where client_id = $1", [CLIENT])).rows.map((row) => [row.kind, row.id]));
      await db.query(
        "insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on, status, details) values ($1, $2, $3, 'ITR_NA', '2025-03', '2025-07-31', 'filed', '{\"filed_on\": \"2025-07-20\"}'), ($1, $2, $4, 'GSTR3B_M', '2026-09', '2026-10-20', 'upcoming', '{}')",
        [FIRM, CLIENT, numbers.pan, numbers.gstin],
      );
      await actAs(db, OWNER);
      expect((await db.query("delete from public.client_registrations where id = $1", [numbers.pan])).rowCount).toBe(0);
      expect((await db.query("delete from public.client_registrations where id = $1", [numbers.gstin])).rowCount).toBe(1);
      await asOwner(db);
      expect((await db.query("select code, status from public.tasks where client_id = $1", [CLIENT])).rows).toEqual([{ code: "ITR_NA", status: "filed" }]);
      await db.query("delete from public.clients where id = $1", [CLIENT]);
      expect((await db.query("select 1 from public.tasks where client_id = $1", [CLIENT])).rowCount).toBe(0);
    }));

  it("in restricted mode shows staff only their assigned clients; the owner still sees all", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      await add(FIRM, "00000000-0000-4000-8000-0000000004c4", pan("i4"));
      const seen = async (person: string) => {
        await actAs(db, person);
        return [(await db.query("select 1 from public.clients")).rowCount, (await db.query("select 1 from public.client_registrations")).rowCount];
      };
      expect(await seen(STAFF)).toEqual([2, 2]); // open, the default

      await actAs(db, OWNER);
      await db.query("update public.firms set settings = settings || '{\"client_visibility\": \"restricted\"}' where id = $1", [FIRM]);
      expect(await seen(STAFF)).toEqual([0, 0]);
      expect(await seen(OWNER)).toEqual([2, 2]);

      await actAs(db, STAFF);
      const self = "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')";
      expect((await attempt(db, self, [FIRM, CLIENT, STAFF])).ok).toBe(false);
      await actAs(db, OWNER);
      await db.query(self, [FIRM, CLIENT, STAFF]);
      expect(await seen(STAFF)).toEqual([1, 1]);
    }));

  it("in restricted mode shows a client assigned to a team to everyone in that team", () =>
    rollback(db, async () => {
      await seed();
      const TEAM = "00000000-0000-4000-8000-0000000004d0";
      await db.query("insert into public.groups (id, firm_id, kind, name) values ($1, $2, 'team', 'GST team')", [TEAM, FIRM]);
      await db.query("update public.firms set settings = '{\"client_visibility\": \"restricted\"}' where id = $1", [FIRM]);
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      await db.query("insert into public.client_assignments (firm_id, client_id, team_id, role) values ($1, $2, $3, 'staff')", [FIRM, CLIENT, TEAM]);
      await db.query("update public.firm_members set team_id = $1 where user_id = $2", [TEAM, STAFF]);
      await actAs(db, STAFF);
      expect((await db.query("select 1 from public.clients")).rowCount).toBe(1);
      await actAs(db, OWNER);
      await db.query("update public.firm_members set team_id = null where user_id = $1", [STAFF]);
      await actAs(db, STAFF);
      expect((await db.query("select 1 from public.clients")).rowCount).toBe(0);
      await asOwner(db);
      const log = await db.query("select action from public.activity_log where firm_id = $1 and action like 'member.%'", [FIRM]);
      expect(log.rowCount).toBe(2);
    }));

  it("lets managers make client groups (not teams), and ungroups clients when a group goes", () =>
    rollback(db, async () => {
      await seed();
      await db.query("update public.firm_members set role = 'manager' where user_id = $1", [STAFF]);
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      await actAs(db, STAFF);
      const make = (kind: string) => attempt(db, "insert into public.groups (firm_id, kind, name) values ($1, $2, 'Patel family') returning id", [FIRM, kind]);
      expect((await make("team")).ok).toBe(false);
      expect((await make("branch")).ok).toBe(false);
      const group = await make("client_group");
      expect(group.ok).toBe(true);
      const id = group.ok ? group.rows[0].id : null;
      await db.query("update public.clients set group_id = $1 where id = $2", [id, CLIENT]);
      await actAs(db, OWNER);
      await db.query("delete from public.groups where id = $1", [id]);
      expect((await db.query("select group_id from public.clients where id = $1", [CLIENT])).rows).toEqual([{ group_id: null }]);
    }));

  it("clears a branch from its people and clients when the branch goes", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      const branch = (await db.query("insert into public.groups (firm_id, kind, name) values ($1, 'branch', 'Surat') returning id", [FIRM])).rows[0].id;
      await db.query("update public.clients set branch_id = $1 where id = $2", [branch, CLIENT]);
      await db.query("update public.firm_members set branch_id = $1 where user_id = $2", [branch, STAFF]);
      await db.query("delete from public.groups where id = $1", [branch]);
      expect((await db.query("select branch_id from public.clients where id = $1", [CLIENT])).rows).toEqual([{ branch_id: null }]);
      expect((await db.query("select branch_id from public.firm_members where user_id = $1", [STAFF])).rows).toEqual([{ branch_id: null }]);
    }));

  it("links one contact to several clients, refuses a second contact with the same email, and follows client visibility", () =>
    rollback(db, async () => {
      await seed();
      const OTHER_CLIENT = "00000000-0000-4000-8000-0000000004c5";
      const CONTACT = "00000000-0000-4000-8000-0000000004e1";
      await actAs(db, OWNER);
      await add(FIRM, CLIENT, pan("i1"));
      await add(FIRM, OTHER_CLIENT, pan("i5"));
      const contact = (id: string) =>
        attempt(db, "insert into public.contacts (id, firm_id, name_enc, email_enc, email_bidx) values ($1, $2, 'n', 'e', 'same')", [id, FIRM]);
      expect((await contact(CONTACT)).ok).toBe(true);
      expect((await contact("00000000-0000-4000-8000-0000000004e2")).ok).toBe(false);
      for (const client of [CLIENT, OTHER_CLIENT])
        await db.query("insert into public.contact_clients (firm_id, contact_id, client_id, can_receive_documents) values ($1, $2, $3, true)", [FIRM, CONTACT, client]);

      await actAs(db, STAFF);
      expect((await contact("00000000-0000-4000-8000-0000000004e3")).ok).toBe(false);
      expect((await db.query("select 1 from public.contact_clients")).rowCount).toBe(2);
      await actAs(db, OWNER);
      await db.query("update public.firms set settings = '{\"client_visibility\": \"restricted\"}' where id = $1", [FIRM]);
      await db.query("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [FIRM, CLIENT, STAFF]);
      await actAs(db, STAFF);
      expect((await db.query("select client_id from public.contact_clients")).rows).toEqual([{ client_id: CLIENT }]);
    }));
});

// M1 acceptance: client activity follows the same firm and assignment boundaries.
it("shows only a visible client's recent activity, without private log details",()=>rollback(db,async()=>{
  await seed();
  await actAs(db,OWNER);await add(FIRM,CLIENT,pan("activity"));
  await asOwner(db);
  const task=(await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-09',current_date) returning id",[FIRM,CLIENT])).rows[0].id;
  await db.query("update public.tasks set status='in_progress' where id=$1",[task]);
  await db.query("insert into public.activity_log(firm_id,action,entity_type,entity_id,details) values ($1,'other.private','client',$2,'{\"private\":\"never returned\"}')",[OTHER,CLIENT]);
  await actAs(db,STAFF);
  const open=await db.query("select * from public.client_activity($1)",[CLIENT]);
  expect(open.fields.map((field)=>field.name)).toEqual(["at","action","actor_id","document_id","renamed_from","renamed_to"]);
  expect(open.rows.map((row)=>row.action)).toEqual(expect.arrayContaining(["client.added","task.changed"]));
  expect(open.rows.some((row)=>row.action==="other.private")).toBe(false);
  // A rename names the file's old and new name, and the document, so it can be put back.
  await asOwner(db);
  const document=(await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,drive_file_id,name,size,sha256) values ($1,$2,'other','Document','a','Client - Document.pdf',1,'x') returning id",[FIRM,CLIENT])).rows[0].id;
  await db.query("select public.rename_document($1,$2,'gst','Purchase bills','2026-09','filed','Client - Purchase bills - Sep 2026.pdf','b')",[document,OWNER]);
  await actAs(db,STAFF);
  expect((await db.query("select document_id,renamed_from,renamed_to from public.client_activity($1) where action='document.renamed'",[CLIENT])).rows).toEqual([{document_id:document,renamed_from:"Client - Document.pdf",renamed_to:"Client - Purchase bills - Sep 2026.pdf"}]);
  expect((await db.query("select count(*)::int n from public.client_activity($1) where action<>'document.renamed' and coalesce(document_id::text,renamed_from,renamed_to) is not null",[CLIENT])).rows[0].n).toBe(0);
  await actAs(db,OWNER);
  await db.query("update public.firms set settings='{\"client_visibility\":\"restricted\"}' where id=$1",[FIRM]);
  await actAs(db,STAFF);
  expect((await db.query("select * from public.client_activity($1)",[CLIENT])).rows).toEqual([]);
  await actAs(db,OWNER);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')",[FIRM,CLIENT,STAFF]);
  await actAs(db,STAFF);
  expect((await db.query("select * from public.client_activity($1)",[CLIENT])).rowCount).toBeGreaterThan(0);
  await asOwner(db);
  await db.query("insert into public.activity_log(firm_id,action,entity_type,entity_id,at) select $1,'client.changed','client',$2,now()+n*interval '1 second' from generate_series(1,60) n",[FIRM,CLIENT]);
  await actAs(db,OWNER);
  const recent=(await db.query("select * from public.client_activity($1)",[CLIENT])).rows;
  expect(recent).toHaveLength(50);expect(recent[0].at>recent[49].at).toBe(true);
  await actAs(db,OUTSIDER);expect((await db.query("select * from public.client_activity($1)",[CLIENT])).rows).toEqual([]);
  await actAs(db,null);expect((await attempt(db,"select * from public.client_activity($1)",[CLIENT])).ok).toBe(false);
}));
