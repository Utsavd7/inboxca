import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";
let db: Client;
const FIRM="00000000-0000-4000-8000-000000000cd0", OWNER="00000000-0000-4000-8000-000000000cd1", PARTNER="00000000-0000-4000-8000-000000000cd2", STAFF="00000000-0000-4000-8000-000000000cd3";
beforeAll(async () => { db=await connect(); });
afterAll(async () => { await db.end(); });
async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@late.test'),($2,'partner@late.test'),($3,'staff@late.test')",[OWNER,PARTNER,STAFF]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Late Test Firm','24','active')",[FIRM]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'partner','active'),($1,$4,'staff','active')",[FIRM,OWNER,PARTNER,STAFF]);
  const client=(await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Textiles','individual') returning id",[FIRM])).rows[0].id;
  const id=(await db.query("insert into public.tasks(firm_id,client_id,kind,due_on) values ($1,$2,'compliance',(now() at time zone 'Asia/Kolkata')::date-3) returning id",[FIRM,client])).rows[0].id;
  return {id,client};
}
it("alerts the assigned partner, falling back to the owner, once even after cleanup and stale edits", () => rollback(db,async () => {
  const {id,client}=await seed();
  await db.query("select private.queue_return_alerts()");
  await db.query("select private.queue_return_alerts()");
  expect((await db.query("select count(*)::int n from public.jobs where entity_id=$1 and kind='return_alert'",[id])).rows[0].n).toBe(1);
  await actAs(db,OWNER);
  expect((await db.query("select id from public.late_returns($1)",[FIRM])).rows).toEqual([{id}]);
  expect((await attempt(db,"select public.claim_return_alert($1)",[id])).ok).toBe(false);
  await asOwner(db);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'partner_in_charge')",[FIRM,client,PARTNER]);
  await actAs(db,OWNER);
  expect((await db.query("select id from public.late_returns($1)",[FIRM])).rows).toEqual([]);
  await actAs(db,PARTNER);
  expect((await db.query("select id from public.late_returns($1)",[FIRM])).rows).toEqual([{id}]);
  await actAs(db,STAFF);
  expect((await db.query("select id from public.late_returns($1)",[FIRM])).rows).toEqual([]);
  await asOwner(db);
  expect((await db.query("select public.claim_return_alert($1) people",[id])).rows[0].people).toEqual([PARTNER]);
  expect((await db.query("select public.claim_return_alert($1) people",[id])).rows[0].people).toBeNull();
  await db.query("delete from public.jobs where entity_id=$1",[id]);
  await db.query("update public.tasks set details='{}' where id=$1",[id]);
  await db.query("select private.queue_return_alerts()");
  expect((await db.query("select count(*)::int n from public.jobs where entity_id=$1",[id])).rows[0].n).toBe(0);
}));
// M5 acceptance: a filed return is no longer eligible for pending reminders or alerts.
it("drops a pending alert when filed and falls back from an inactive partner", () => rollback(db,async () => {
  const {id,client}=await seed();
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'partner_in_charge')",[FIRM,client,PARTNER]);
  await db.query("update public.firm_members set status='deactivated' where firm_id=$1 and user_id=$2",[FIRM,PARTNER]);
  expect((await db.query("select public.claim_return_alert($1) people",[id])).rows[0].people).toEqual([OWNER]);
  await db.query("update public.tasks set status='filed',details=details || jsonb_build_object('filed_on',current_date) where id=$1",[id]);
  expect((await db.query("select public.claim_return_alert($1) people",[id])).rows[0].people).toBeNull();
  await actAs(db,OWNER);
  expect((await db.query("select id from public.late_returns($1)",[FIRM])).rows).toEqual([]);
}));
