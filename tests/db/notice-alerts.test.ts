import type { Client } from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";
const FIRM = "00000000-0000-4000-8000-000000000cc0", OWNER = "00000000-0000-4000-8000-000000000cc1", STAFF = "00000000-0000-4000-8000-000000000cc2", CLIENT = "00000000-0000-4000-8000-000000000cc3";
// India's date, as the app's due dates are; the database's own current_date is UTC's, a day
// behind for five and a half hours after India's midnight.
const TODAY = "(now() at time zone 'Asia/Kolkata')::date";
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });
async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@notice.test'),($2,'staff@notice.test')", [OWNER, STAFF]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Notice Test Firm','24','active')", [FIRM]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active')", [FIRM, OWNER, STAFF]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Client','individual')", [CLIENT, FIRM]);
  return (await db.query(`insert into public.tasks(firm_id,client_id,kind,due_on) values ($1,$2,'notice',${TODAY}+2) returning id`, [FIRM, CLIENT])).rows[0].id as string;
}

// M5 notices: each near, due and overdue review or confirmed date is told once, even after job cleanup.
it("queues and claims each notice stage once, and drops stale and closed jobs", () => rollback(db, async () => {
  const id = await seed();
  for (const prefix of ["review", "action"]) for (const [offset, suffix] of [[2,"near"],[0,"due"],[-1,"late"]] as const) {
    const stage = `${prefix}_${suffix}`;
    await db.query("update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date+$2::int, details=details || $3 where id=$1", [id, offset, prefix === "action" ? { action_date: "2026-10-20" } : {}]);
    await db.query("select private.queue_notice_alerts()");
    await db.query("select private.queue_notice_alerts()");
    expect((await db.query("select count(*)::int n from public.jobs where idempotency_key=$1", [`notice_alert:${id}:${stage}`])).rows[0].n).toBe(1);
    expect((await db.query("select public.claim_notice_alert($1,$2) claimed", [id, stage])).rows[0].claimed).toMatchObject({ firm_id: FIRM, client_id: CLIENT });
    expect((await db.query("select public.claim_notice_alert($1,$2) claimed", [id, stage])).rows[0].claimed).toBeNull();
    await db.query("delete from public.jobs where firm_id=$1", [FIRM]);
    await db.query("select private.queue_notice_alerts()");
    expect((await db.query("select count(*)::int n from public.jobs where firm_id=$1 and kind='notice_alert'", [FIRM])).rows[0].n).toBe(0);
  }
  await db.query("update public.tasks set details='{}',status='replied' where id=$1", [id]);
  expect(Object.keys((await db.query("select details->'notice_alerts' stages from public.tasks where id=$1", [id])).rows[0].stages)).toHaveLength(6);
  expect((await db.query("select public.claim_notice_alert($1,'review_late') claimed", [id])).rows[0].claimed).toBeNull();
}));

it("shows Home alerts only to the owner, partners and the assigned people or team", () => rollback(db, async () => {
  const id = await seed();
  await db.query("insert into public.firms(id,name,state_code,status) values ('00000000-0000-4000-8000-000000000cc8','Another Firm','24','active')");
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000cc8',$1,'partner','active')", [OWNER]);
  await db.query("insert into public.clients(firm_id,name,kind) values ('00000000-0000-4000-8000-000000000cc8','Other client','individual')");
  await db.query(`insert into public.tasks(firm_id,client_id,kind,due_on) select firm_id,id,'notice',${TODAY} from public.clients where firm_id='00000000-0000-4000-8000-000000000cc8'`);
  await actAs(db, OWNER);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([{ id }]);
  expect((await attempt(db,"select public.claim_notice_alert($1,'review_near')",[id])).ok).toBe(false);
  await actAs(db, STAFF);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([]);
  await asOwner(db);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')", [FIRM,CLIENT,STAFF]);
  await actAs(db, STAFF);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([{ id }]);
  await asOwner(db);
  await db.query("delete from public.client_assignments where client_id=$1", [CLIENT]);
  const team = (await db.query("insert into public.groups(firm_id,kind,name) values ($1,'team','Notice team') returning id", [FIRM])).rows[0].id;
  await db.query("update public.firm_members set team_id=$3 where firm_id=$1 and user_id=$2", [FIRM,STAFF,team]);
  await db.query("insert into public.client_assignments(firm_id,client_id,team_id,role) values ($1,$2,$3,'staff')", [FIRM,CLIENT,team]);
  await actAs(db,STAFF);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([{ id }]);
  await asOwner(db);
  await db.query("delete from public.client_assignments where client_id=$1", [CLIENT]);
  await db.query("update public.firm_members set role='partner' where firm_id=$1 and user_id=$2", [FIRM,STAFF]);
  await actAs(db,STAFF);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([{ id }]);
  await actAs(db,"00000000-0000-4000-8000-000000000cc9");
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([]);
  await asOwner(db);
  await db.query("update public.tasks set status='closed' where id=$1",[id]);
  await actAs(db,OWNER);
  expect((await db.query("select id from public.notice_alerts($1)", [FIRM])).rows).toEqual([]);
}));
