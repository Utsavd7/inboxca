import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Firm control over due dates and returns (20261109100000_firm_control.sql): only the owner
// confirms a due date, only against a rule with an official link that Orelu has not checked,
// and only for their own firm; the AGM date makes a company's ROC tasks for whoever manages
// the client; who is behind and who signed a return off show only to those who may see them.
let db: Client;
const firmA = "00000000-0000-4000-8000-0000000000f1", firmB = "00000000-0000-4000-8000-0000000000f2";
const ownerA = "00000000-0000-4000-8000-0000000000a1", staffA = "00000000-0000-4000-8000-0000000000a2", ownerB = "00000000-0000-4000-8000-0000000000b1";
const linked = "ZZ_FC_LINK", unlinked = "ZZ_FC_NOLINK", checked = "ZZ_FC_DONE";

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner-a@firm-control.test'),($2,'staff-a@firm-control.test'),($3,'owner-b@firm-control.test')", [ownerA, staffA, ownerB]);
  // Firm A's staff see only the clients assigned to them.
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Firm Control Test A','24','active','{\"client_visibility\":\"restricted\"}'),($2,'Firm Control Test B','27','active','{}')", [firmA, firmB]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active'),($4,$5,'owner','active')", [firmA, ownerA, staffA, firmB, ownerB]);
  await db.query("insert into public.compliance_types(code,name,frequency,due_rule,source_url,verified_on,approved_by) values ($1,'Invented linked return','monthly','{\"for\":\"pan\",\"after\":1,\"day\":11}','https://example.test/notification',null,null),($2,'Invented unlinked return','monthly','{\"for\":\"pan\",\"after\":1,\"day\":11}',null,null,null),($3,'Invented checked return','monthly','{\"for\":\"pan\",\"after\":1,\"day\":11}','https://example.test/notification',current_date,'CA Test')", [linked, unlinked, checked]);
  const company = (await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Company Ltd','company') returning id", [firmA])).rows[0].id;
  const other = (await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Other Client','business') returning id", [firmA])).rows[0].id;
  const registration = (await db.query("insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx,services) values ($1,$2,'cin','invented','invented-bidx','{AOC4,MGT7}') returning id", [firmA, company])).rows[0].id;
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')", [firmA, other, staffA]);
  return { company, other, registration };
}

it("lets only the owner confirm a linked, unchecked rule, once, for their firm alone, and logs it", () =>
  rollback(db, async () => {
    await seed();
    const confirm = (firm: string, code: string) => db.query("select public.confirm_due_date($1,$2) ok", [firm, code]).then((result) => result.rows[0].ok);
    await actAs(db, staffA);
    expect(await confirm(firmA, linked)).toBe(false);
    await actAs(db, ownerA);
    expect(await confirm(firmB, linked)).toBe(false);
    expect(await confirm(firmA, unlinked)).toBe(false);
    expect(await confirm(firmA, checked)).toBe(false);
    expect(await confirm(firmA, linked)).toBe(true);
    expect(await confirm(firmA, linked)).toBe(false);
    expect((await db.query("select code, source_url from public.firm_due_dates")).rows).toEqual([{ code: linked, source_url: "https://example.test/notification" }]);
    // The other firm sees nothing of it, and its own owner must confirm for themselves.
    await actAs(db, ownerB);
    expect((await db.query("select code from public.firm_due_dates")).rows).toEqual([]);
    expect(await confirm(firmB, linked)).toBe(true);
    await asOwner(db);
    expect((await db.query("select firm_id, confirmed_by from public.firm_due_dates order by firm_id")).rows).toEqual([{ firm_id: firmA, confirmed_by: ownerA }, { firm_id: firmB, confirmed_by: ownerB }]);
    expect((await db.query("select actor_id, details from public.activity_log where action = 'due_date.confirmed' and firm_id = $1", [firmA])).rows).toEqual([{ actor_id: ownerA, details: { code: linked, source_url: "https://example.test/notification" } }]);
    // Orelu's own check wins: the rule table is untouched by a firm's confirmation.
    expect((await db.query("select verified_on from public.compliance_types where code = $1", [linked])).rows[0].verified_on).toBeNull();
  }));

it("makes a company's AGM based returns from the AGM date, for those who manage the client, never before the year ends", () =>
  rollback(db, async () => {
    const { registration } = await seed();
    const record = (agm: string, year = "2026-03") => db.query("select public.record_agm($1,$2,$3,$4) made", [firmA, registration, year, agm]).then((result) => result.rows[0].made);
    await actAs(db, staffA);
    expect(await record("2026-09-29")).toBe(0);
    await actAs(db, ownerA);
    expect(await record("2025-09-29")).toBe(0);
    expect(await record("2026-09-29")).toBe(2);
    expect((await db.query("select code, period_key, to_char(due_on,'YYYY-MM-DD') due_on, details->>'agm' agm from public.tasks where registration_id = $1 order by code", [registration])).rows)
      .toEqual([{ code: "AOC4", period_key: "2026-03", due_on: "2026-10-29", agm: "2026-09-29" }, { code: "MGT7", period_key: "2026-03", due_on: "2026-11-28", agm: "2026-09-29" }]);
    // A corrected AGM date moves the dates not filed, and leaves a filed one alone.
    await asOwner(db);
    await db.query("update public.tasks set status = 'filed', details = details || '{\"filed_on\":\"2026-10-20\"}' where registration_id = $1 and code = 'AOC4'", [registration]);
    await actAs(db, ownerA);
    expect(await record("2026-09-30")).toBe(1);
    expect((await db.query("select code, to_char(due_on,'YYYY-MM-DD') due_on from public.tasks where registration_id = $1 order by code", [registration])).rows).toEqual([{ code: "AOC4", due_on: "2026-10-29" }, { code: "MGT7", due_on: "2026-11-29" }]);
    // The nightly calendar makes nothing for an AGM rule on its own.
    await asOwner(db);
    await db.query("delete from public.tasks where registration_id = $1", [registration]);
    await db.query("select private.plan_tasks($1)", [registration]);
    expect((await db.query("select count(*)::int n from public.tasks where registration_id = $1", [registration])).rows[0].n).toBe(0);
    // A One Person Company holds no AGM: its AOC-4 is dated 180 days from the year end, 27
    // September (s.137(1) third proviso), in place of the AGM based one.
    expect((await attempt(db, "update public.client_registrations set services = '{AOC4,AOC4_OPC}' where id = $1", [registration])).ok).toBe(false);
    await db.query("update public.client_registrations set services = '{AOC4_OPC,MGT7}' where id = $1", [registration]);
    await db.query("delete from public.tasks where registration_id = $1", [registration]);
    await db.query("select private.plan_tasks_for($1, null, '2026-04-01')", [registration]);
    expect((await db.query("select code, period_key, to_char(due_on,'YYYY-MM-DD') due_on from public.tasks where registration_id = $1 order by code", [registration])).rows).toEqual([{ code: "AOC4_OPC", period_key: "2026-03", due_on: "2026-09-27" }]);
  }));

it("shows who is behind and who signed a return off only to those who may see the clients", () =>
  rollback(db, async () => {
    const { company, other } = await seed();
    await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-09',current_date - 1),($1,$2,'GSTR1_M','2026-10',current_date + 10),($1,$3,'GSTR1_M','2026-10',current_date + 10)", [firmA, other, company]);
    const doc = (await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,drive_file_id,name,size,sha256,prepared) values ($1,$2,'gst','Prepared return','2026-09','invented.xlsx','Invented GSTR-1',1,'invented','{\"form\":\"GSTR1\",\"status\":\"approved\"}') returning id", [firmA, company])).rows[0].id;
    await db.query("insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id) values ($1,$2,'form.prepared','document',$3),($1,$2,'form.approved','document',$3)", [firmA, ownerA, doc]);
    await actAs(db, staffA);
    expect((await db.query("select * from public.people_load($1)", [firmA])).rows).toEqual([]);
    expect((await db.query("select * from public.form_signoffs($1,$2)", [firmA, [doc]])).rows).toEqual([]);
    await actAs(db, ownerA);
    expect((await db.query("select user_id, open, late, asks from public.people_load($1) order by user_id", [firmA])).rows).toEqual([{ user_id: ownerA, open: 0, late: 0, asks: 0 }, { user_id: staffA, open: 2, late: 1, asks: 0 }]);
    expect((await db.query("select action, actor_id from public.form_signoffs($1,$2) order by action", [firmA, [doc]])).rows).toEqual([{ action: "form.approved", actor_id: ownerA }, { action: "form.prepared", actor_id: ownerA }]);
    await actAs(db, ownerB);
    expect((await db.query("select * from public.form_signoffs($1,$2)", [firmA, [doc]])).rows).toEqual([]);
    expect((await attempt(db, "select * from public.people_load($1)", [firmA])).rows).toEqual([]);
  }));

it("dates the next DIR-3 KYC Web three financial years after the last, by 30 June, only once the year is given", () =>
  rollback(db, async () => {
    const { other } = await seed();
    await asOwner(db);
    const pan = (await db.query("insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx,services) values ($1,$2,'pan','invented-pan','invented-pan-bidx','{DIR3KYC}') returning id", [firmA, other])).rows[0].id;
    // Rule 12A as substituted by G.S.R. 943(E): nothing is planned until the last KYC's year is known.
    await db.query("select private.plan_tasks($1)", [pan]);
    expect((await db.query("select count(*)::int n from public.tasks where registration_id = $1", [pan])).rows[0].n).toBe(0);
    const record = (year: string) => db.query("select public.record_kyc($1,$2,$3) made", [firmA, pan, year]).then((result) => result.rows[0].made);
    await actAs(db, staffA);
    expect(await record("2024-03")).toBe(0);
    await actAs(db, ownerA);
    expect(await record("2024-04")).toBe(0);
    expect(await record("2024-03")).toBe(1);
    expect((await db.query("select code, period_key, to_char(due_on,'YYYY-MM-DD') due_on, details->>'last_kyc' last_kyc from public.tasks where registration_id = $1", [pan])).rows)
      .toEqual([{ code: "DIR3KYC", period_key: "2027-03", due_on: "2027-06-30", last_kyc: "2024-03" }]);
    // A corrected year replaces the task not yet started.
    expect(await record("2025-03")).toBe(1);
    expect((await db.query("select period_key, to_char(due_on,'YYYY-MM-DD') due_on from public.tasks where registration_id = $1", [pan])).rows).toEqual([{ period_key: "2028-03", due_on: "2028-06-30" }]);
  }));
