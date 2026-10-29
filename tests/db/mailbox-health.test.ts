import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {actAs,asOwner,attempt,connect,rollback} from "./db";
let db:Client;
const firm="00000000-0000-4000-8000-000000000cf0",person="00000000-0000-4000-8000-000000000cf1";
beforeAll(async()=>{db=await connect();});
afterAll(async()=>{await db.end();});
async function seed(){
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@mail-health.test')",[person]);
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Mail Health Test Firm','24','active','{\"mail_limit\":2}')",[firm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active')",[firm,person]);
  return (await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc) values ($1,'mail','imap','invented encrypted address','old encrypted credentials') returning id",[firm])).rows[0].id;
}
it("stops after repeated login failures, tells the owner once and ignores an old attempt after reconnect",()=>rollback(db,async()=>{
  const id=await seed();
  for(const n of [1,2,3,4]) expect((await db.query("select public.mail_health($1,'read',true,'old encrypted credentials') n",[id])).rows[0].n).toBe(n);
  expect((await db.query("select status from public.connected_accounts where id=$1",[id])).rows[0].status).toBe("needs_reconnect");
  expect((await db.query("select count(*)::int n from public.jobs where kind='mailbox_reconnect' and entity_id=$1",[id])).rows[0].n).toBe(1);
  await db.query("update public.connected_accounts set status='connected',credentials_enc='new encrypted credentials',settings='{}' where id=$1",[id]);
  expect((await db.query("select public.mail_health($1,'read',true,'old encrypted credentials') n",[id])).rows[0].n).toBe(0);
  expect((await db.query("select status from public.connected_accounts where id=$1",[id])).rows[0].status).toBe("connected");
  await db.query("select public.mail_health($1,'send',true,'new encrypted credentials')",[id]);
  await db.query("select public.mail_health($1,'read',false,'new encrypted credentials')",[id]);
  expect((await db.query("select settings#>>'{mail_failures,send}' n from public.connected_accounts where id=$1",[id])).rows[0].n).toBe("1");
  await actAs(db,person);
  expect((await attempt(db,"select public.mail_health($1,'read',true,'new encrypted credentials')",[id])).ok).toBe(false);
  expect((await attempt(db,"select public.reserve_mail_send($1)",[id])).ok).toBe(false);
}));
it("shares one rolling 24 hour limit and spaces starts, without resetting it at midnight",()=>rollback(db,async()=>{
  const id=await seed();
  const a=(await db.query("select public.reserve_mail_send($1) slot",[id])).rows[0].slot;
  const b=(await db.query("select public.reserve_mail_send($1) slot",[id])).rows[0].slot;
  const blocked=(await db.query("select public.reserve_mail_send($1) slot",[id])).rows[0].slot;
  expect(a.ready).toBe(true);expect(b.ready).toBe(true);
  expect(Date.parse(b.at)-Date.parse(a.at)).toBeGreaterThanOrEqual(1000);
  expect(blocked.ready).toBe(false);
  expect(Date.parse(blocked.at)-Date.parse(a.at)).toBeGreaterThanOrEqual(24*3600_000);
  await db.query("update public.connected_accounts set settings=jsonb_build_object('mail_sends',jsonb_build_array(now()-interval '25 hours')) where id=$1",[id]);
  expect((await db.query("select public.reserve_mail_send($1) slot",[id])).rows[0].slot.ready).toBe(true);
}));
it("keeps a message's id from its slot until its send fails, never for a send that waits",()=>rollback(db,async()=>{
  const id=await seed();
  for (const message of ["<a@mail-health.test>","<b@mail-health.test>","<c@mail-health.test>"]) await db.query("select public.reserve_mail_send($1,$2)",[id,message]);
  await db.query("select public.forget_mail_send($1,'<a@mail-health.test>')",[id]);
  const {settings}=(await db.query("select settings from public.connected_accounts where id=$1",[id])).rows[0];
  expect(Object.keys(settings.mail_ids)).toEqual(["<b@mail-health.test>"]);
  expect(settings.mail_sends).toHaveLength(2);
}));
