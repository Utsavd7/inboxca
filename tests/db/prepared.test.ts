import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,rollback,actAs,attempt} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

it("keeps versions, approvals and one-use filing downloads tied to the checked work",()=>rollback(db,async()=>{
  const firm=randomUUID(),other=randomUUID(),owner=randomUUID(),manager=randomUUID(),outsider=randomUUID(),client=randomUUID(),registration=randomUUID(),draft=randomUUID(),line=randomUUID();
  for(const person of [owner,manager,outsider]) await db.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Prepared Test Firm','24','active'),($2,'Other Prepared Firm','24','active')",[firm,other]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'manager','active'),($4,$5,'owner','active')",[firm,owner,manager,other,outsider]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Prepared Client','business')",[client,firm]);
  await db.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,$3,'gstin','invented encrypted number',$4)",[registration,firm,client,randomUUID()]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'manager')",[firm,client,manager]);
  const body={lines:[{id:line,field:"amount",value_enc:"invented encrypted figure",state:"confirmed",by:owner,at:new Date().toISOString()}],checks:[]};
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body]);
  const sources=(revision:number)=>JSON.stringify([{id:draft,revision}]);
  const reserve=async(revision:number)=>(await db.query("select public.reserve_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,$5,'Invented - GSTR-1 - Sep 2026','xlsx') saved",[firm,client,registration,sources(revision),owner])).rows[0].saved;
  const first=await reserve(1);expect(first.ready).toBe(false);expect(first.name).toContain("v1.xlsx");expect((await reserve(1)).id).toBe(first.id);
  await actAs(db,outsider);expect((await db.query("select id from public.documents where prepared is not null")).rows).toEqual([]);
  await actAs(db,manager);expect((await db.query("select id from public.documents where prepared is not null")).rows).toEqual([{id:first.id}]);
  expect((await attempt(db,"update public.documents set prepared='{}' where id=$1",[first.id])).ok).toBe(false);
  expect((await attempt(db,"select public.finish_form($1,$2,$3,'invented-file',$4,100,null)",[first.id,firm,manager,"a".repeat(64)])).ok).toBe(false); // ggignore: invented checksum.
  await db.query("reset role");
  const finish=async(id:string)=>(await db.query("select public.finish_form($1,$2,$3,$4,$5,100,null) saved",[id,firm,owner,`invented-file-${id}`,"a".repeat(64)])).rows[0].saved; // ggignore: invented checksum.
  expect(await finish(first.id)).toBe(true);expect((await db.query("select public.form_ready($1) ready",[first.id])).rows[0].ready).toBe(true);
  await db.query("update public.documents set share_policy='auto' where id=$1",[first.id]);expect((await db.query("select share_policy from public.documents where id=$1",[first.id])).rows[0].share_policy).toBe("internal");
  const ticket=randomUUID(),hash="b".repeat(64); // ggignore: invented one-use download hash.
  await db.query("insert into public.requests(id,firm_id,client_id,kind,entity_type,entity_id,expires_at,details) values($1,$2,$3,'filing_download','document',$4,now()+interval '1 minute',jsonb_build_object('by',$5::text,'token_hash',$6::text))",[ticket,firm,client,first.id,manager,hash]);
  const take=async(person:string)=>(await db.query("select public.take_form_download($1,$2,$3) id",[ticket,person,hash])).rows[0].id;
  expect(await take(owner)).toBeNull();expect(await take(manager)).toBe(first.id);expect(await take(manager)).toBeNull();
  await db.query("update public.datasets set revision=2,data=jsonb_set(data,'{lines,0,state}','\"pending\"') where id=$1",[draft]);
  expect((await db.query("select prepared->>'status' status from public.documents where id=$1",[first.id])).rows[0].status).toBe("draft");
  expect((await db.query("select public.form_ready($1) ready",[first.id])).rows[0].ready).toBe(false);expect(await reserve(2)).toBeNull();
  await db.query("update public.datasets set revision=3,data=jsonb_set(data,'{lines,0,state}','\"confirmed\"') where id=$1",[draft]);
  const second=await reserve(3);expect(second.name).toContain("v2.xlsx");expect(await finish(second.id)).toBe(true);
  expect((await db.query("select public.form_ready($1) ready",[first.id])).rows[0].ready).toBe(false);
  await db.query("update public.firms set settings=jsonb_build_object('second_form_approval',true) where id=$1",[firm]);
  expect((await db.query("select public.form_ready($1) ready",[second.id])).rows[0].ready).toBe(false);
  expect((await db.query("select prepared->>'status' status from public.documents where id=$1",[second.id])).rows[0].status).toBe("draft");
  await db.query("update public.firms set settings='{}' where id=$1",[firm]);
  expect((await db.query("select public.form_ready($1) ready",[second.id])).rows[0].ready).toBe(true);
  await db.query("update public.firms set settings=jsonb_build_object('second_form_approval',true) where id=$1",[firm]);
  const approve=async(person:string)=>(await db.query("select public.decide_form($1,$2,'approved','{}') saved",[second.id,person])).rows[0].saved;
  expect(await approve(owner)).toBe(false);expect(await approve(outsider)).toBe(false);expect(await approve(manager)).toBe(true);
  expect((await attempt(db,"update public.documents set name='Different.xlsx' where id=$1",[second.id])).ok).toBe(false);
  const paper=randomUUID();
  await db.query("insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values ($1,$2,$3,'gst','Acknowledgement','2026-09','Invented acknowledgement.pdf',100,$4,'invented-ack')",[paper,firm,client,"c".repeat(64)]); // ggignore: invented checksum.
  expect((await db.query("select details->>'paper' paper from public.requests where kind='form_confirmation' and entity_id=$1",[second.id])).rows).toEqual([{paper}]);
  const task=randomUUID(),job=randomUUID();
  await db.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values ($1,$2,$3,$4,'GSTR1_M','2026-09','2026-10-11')",[task,firm,client,registration]);
  await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values($1,'test','task',$2,$3)",[firm,task,job]);
  expect((await db.query("select public.file_prepared_form($1,$2,'',$3) saved",[second.id,manager,paper])).rows[0].saved).toBe(true);
  expect((await db.query("select status,details->>'ack' ack from public.tasks where id=$1",[task])).rows[0]).toEqual({status:"filed",ack:""});
  expect((await db.query("select state from public.jobs where entity_id=$1",[task])).rows[0].state).toBe("cancelled");
  expect((await db.query("select share_policy from public.documents where id=$1",[second.id])).rows[0].share_policy).toBeNull();
  expect((await db.query("select state from public.jobs where kind='form_ack' and entity_id=$1",[second.id])).rows[0].state).toBe("pending");
  expect((await db.query("select status from public.requests where kind='form_confirmation' and entity_id=$1",[second.id])).rows[0].status).toBe("done");
  // Uploaded changes start unchecked. Confirming the same values binds only this file.
  const edited=randomUUID(),editedDraft=randomUUID(),editedLine=randomUUID(),checksum="d".repeat(64); // ggignore: invented checksum.
  await db.query("insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,share_policy) values ($1,$2,$3,'gst','GSTR-1','2026-09','Edited.xlsx',100,$4,'invented-edited','internal')",[edited,firm,client,checksum]);
  const editedBody={lines:[{id:editedLine,field:"b2b.r5.c11",value_enc:"invented encrypted edited value",state:"pending",source:{document:edited,sha256:checksum,page:1,sheet:2,cell:"L5"}}],checks:[]};
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[editedDraft,firm,client,editedBody]);
  const attached=(await db.query("select public.add_edited_form($1,$2,$3,'2.2',$4,'Invented - GSTR-1 - Sep 2026') saved",[edited,editedDraft,registration,owner])).rows[0].saved;
  expect(attached.name).toContain("v3.xlsx");expect((await db.query("select public.form_ready($1) ready",[edited])).rows[0].ready).toBe(false);
  editedBody.lines[0]={...editedBody.lines[0],state:"confirmed",by:owner,at:new Date().toISOString()} as typeof editedBody.lines[number];
  await db.query("update public.datasets set revision=2,data=$2 where id=$1",[editedDraft,editedBody]);
  expect((await db.query("select public.decide_form($1,$2,'approved','{}') saved",[edited,manager])).rows[0].saved).toBe(true);
  expect((await db.query("select public.form_ready($1) ready",[edited])).rows[0].ready).toBe(true);
  // A newly checked value cannot approve the earlier uploaded bytes.
  editedBody.lines[0].value_enc="invented DIFFERENT encrypted value";
  await db.query("update public.datasets set revision=3,data=$2 where id=$1",[editedDraft,editedBody]);
  expect((await db.query("select public.form_ready($1) ready",[edited])).rows[0].ready).toBe(false);
  expect((await db.query("select public.decide_form($1,$2,'approved','{}') saved",[edited,manager])).rows[0].saved).toBe(false);
}));
