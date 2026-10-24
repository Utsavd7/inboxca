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
// Today: late returns are one row a client for everyone who can see the client, and the week ahead by form.
it("groups late returns by client and counts the week's returns by form", () => rollback(db,async () => {
  const {client}=await seed();
  await db.query("insert into public.tasks(firm_id,client_id,kind,code,period_key,due_on,status,details) values ($1,$2,'compliance','GSTR1_M','2026-08',(now() at time zone 'Asia/Kolkata')::date-1,'upcoming','{}'),($1,$2,'compliance','GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+2,'upcoming','{}'),($1,$2,'compliance','GSTR3B_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+2,'filed',jsonb_build_object('filed_on',current_date))",[FIRM,client]);
  await actAs(db,OWNER);
  expect((await db.query("select client_id,client_name,returns,code from public.late_clients($1)",[FIRM])).rows).toEqual([{client_id:client,client_name:"Invented Textiles",returns:2,code:null}]);
  expect((await db.query("select code,clients,filed from public.due_soon($1) order by code",[FIRM])).rows).toEqual([{code:"GSTR1_M",clients:1,filed:0},{code:"GSTR3B_M",clients:1,filed:1}]);
  await actAs(db,STAFF);
  expect((await db.query("select returns from public.late_clients($1)",[FIRM])).rows).toEqual([{returns:2}]);
  await asOwner(db);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'partner_in_charge')",[FIRM,client,PARTNER]);
  await db.query(`update public.firms set settings=settings || '{"client_visibility":"restricted"}' where id=$1`,[FIRM]);
  await actAs(db,OWNER);
  expect((await db.query("select returns from public.late_clients($1)",[FIRM])).rows).toEqual([{returns:2}]);
  await actAs(db,PARTNER);
  expect((await db.query("select returns from public.late_clients($1)",[FIRM])).rows).toEqual([{returns:2}]);
  await actAs(db,STAFF);
  expect((await db.query("select client_id from public.late_clients($1)",[FIRM])).rows).toEqual([]);
}));
// The Calendar's strip: returns still to file each day, for one form or all; archived clients left out.
it("counts the returns still to file on each day of the calendar strip", () => rollback(db,async () => {
  const {client}=await seed();
  const other=(await db.query("insert into public.clients(firm_id,name,kind,archived_at) values ($1,'Archived Mills','individual',now()) returning id",[FIRM])).rows[0].id;
  await db.query("insert into public.tasks(firm_id,client_id,kind,code,period_key,due_on,status,details) values ($1,$2,'compliance','GSTR1_M','2026-09','2030-01-11','upcoming','{}'),($1,$2,'compliance','GSTR3B_M','2026-09','2030-01-11','in_progress','{}'),($1,$2,'compliance','GSTR3B_M','2026-08','2030-01-20','filed',jsonb_build_object('filed_on',current_date)),($1,$3,'compliance','GSTR1_M','2026-09','2030-01-11','upcoming','{}')",[FIRM,client,other]);
  await actAs(db,OWNER);
  const days=(code:string|null)=>db.query("select to_char(due_on,'YYYY-MM-DD') due_on,returns from public.calendar_days($1,'2030-01-01','2030-01-31',$2)",[FIRM,code]).then((result)=>result.rows);
  expect(await days(null)).toEqual([{due_on:"2030-01-11",returns:2}]);
  expect(await days("GSTR1_M")).toEqual([{due_on:"2030-01-11",returns:1}]);
}));
