import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import catalog from "../../reference/official/templates.json";
import {connect,rollback,actAs,attempt} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});
it("shares only the official catalog and refuses signed in changes or activation",()=>rollback(db,async()=>{
  const person=randomUUID();await db.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await actAs(db,person);
  // This branch's catalog rows exactly; rows other branches add to the shared database only
  // need to be official too.
  const {rows}=await db.query("select form_code,version,valid_from::text,valid_until::text,status,source,mappings from public.templates where form_code||' '||version=any($1) order by form_code,version",[catalog.map(row=>`${row.form_code} ${row.version}`)]);
  expect(rows).toEqual(catalog);
  const others=await db.query("select source->>'url' as url from public.templates");
  for(const {url} of others.rows) expect(new URL(url).hostname).toMatch(/(^|\.)(gst|incometax)\.gov\.in$/);
  expect((await attempt(db,"update public.templates set status='active',valid_from='2026-09-01' where form_code='GSTR3B'")).ok).toBe(false);
  expect((await attempt(db,"delete from public.templates where form_code='GSTR1'")).ok).toBe(false);
  await actAs(db,null);expect((await attempt(db,"select * from public.templates")).ok).toBe(false);
}));
