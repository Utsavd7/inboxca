import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,rollback,actAs,attempt} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

// Form No. 140: the TAN's details stay in the firm and with those who manage clients; a statement
// is prepared only from its TAN's checked figures, as a text file; filing it closes the quarter's
// TDS return on that TAN.
it("keeps TDS statement details and statements to the firm, its TAN and its checked figures",()=>rollback(db,async()=>{
  const firm=randomUUID(),other=randomUUID(),owner=randomUUID(),staff=randomUUID(),outsider=randomUUID(),client=randomUUID(),tan=randomUUID(),gstin=randomUUID(),draft=randomUUID();
  for(const person of [owner,staff,outsider]) await db.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'TDS Test Firm','24','active'),($2,'Other TDS Firm','24','active')",[firm,other]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active'),($4,$5,'owner','active')",[firm,owner,staff,other,outsider]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented TDS Client','business')",[client,firm]);
  await db.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,$3,'tan','invented encrypted TAN',$4),($5,$2,$3,'gstin','invented encrypted GSTIN',$6)",[tan,firm,client,randomUUID(),gstin,randomUUID()]);
  const details=async(person:string)=>{await actAs(db,person);const result=await attempt(db,"update public.client_registrations set details_enc='invented sealed details' where id=$1",[tan]);await db.query("reset role");return result.ok ? result.count : -1;};
  expect(await details(staff)).toBe(0);expect(await details(outsider)).toBe(0);
  await actAs(db,outsider);expect((await db.query("select details_enc from public.client_registrations where id=$1",[tan])).rows).toEqual([]);await db.query("reset role");
  expect(await details(owner)).toBe(1);
  expect((await db.query("select action,details from public.activity_log where firm_id=$1 and action='registration.changed'",[firm])).rows).toEqual([{action:"registration.changed",details:{changed:["details_enc"]}}]);
  await actAs(db,staff);expect((await db.query("select details_enc from public.client_registrations where id=$1",[tan])).rows).toEqual([{details_enc:"invented sealed details"}]);await db.query("reset role");
  // A statement's figures name their TAN; the file is text, on that TAN only.
  const line={id:randomUUID(),field:"tds.p2.amount",value_enc:"invented encrypted figure",state:"confirmed",by:owner,at:new Date().toISOString()};
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'TDS140','2026-09',$4)",[draft,firm,client,{lines:[line],checks:[],registration:tan}]);
  const sources=JSON.stringify([{id:draft,revision:1}]);
  const reserve=async(registration:string,extension:string,period="2026-09")=>(await db.query("select public.reserve_form($1,$2,$3,'TDS140',$6,'1.2',$4,$5,'Invented - Form No. 140 - Jul to Sep 2026',$7) saved",[firm,client,registration,sources,owner,period,extension])).rows[0].saved;
  expect(await reserve(gstin,"txt")).toBeNull();expect(await reserve(tan,"xlsx")).toBeNull();expect(await reserve(tan,"txt","2026-08")).toBeNull();
  const saved=await reserve(tan,"txt");expect(saved.name).toBe("Invented - Form No. 140 - Jul to Sep 2026 - v1.txt");
  expect((await db.query("select work_type,document_type,prepared->>'form' form from public.documents where id=$1",[saved.id])).rows[0]).toEqual({work_type:"income_tax",document_type:"Form No. 140",form:"TDS140"});
  // GST returns keep their own files: a GSTR-1 never takes a text file.
  expect((await db.query("select public.reserve_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,$5,'Invented','txt') saved",[firm,client,gstin,sources,owner])).rows[0].saved).toBeNull();
  // Figures read for another TAN cannot make this one's statement.
  await db.query("update public.datasets set data=jsonb_set(data,'{registration}',to_jsonb($2::text)) where id=$1",[draft,randomUUID()]);
  expect(await reserve(tan,"txt")).toBeNull();
  await db.query("update public.datasets set data=jsonb_set(data,'{registration}',to_jsonb($2::text)) where id=$1",[draft,tan]);
  const task=randomUUID();
  await db.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values ($1,$2,$3,$4,'TDS_RET','2026-09','2026-10-31')",[task,firm,client,tan]);
  const stage=async()=>(await db.query("select stage from public.return_stages($1,$2)",[firm,[task]])).rows[0].stage;
  expect(await stage()).toBe("checked");
  expect((await db.query("select public.finish_form($1,$2,$3,'invented-file',$4,100,null) saved",[saved.id,firm,owner,"a".repeat(64)])).rows[0].saved).toBe(true); // ggignore: invented checksum.
  expect(await stage()).toBe("approved");
  expect((await db.query("select public.file_prepared_form($1,$2,'invented token 123',null) saved",[saved.id,owner])).rows[0].saved).toBe(true);
  expect((await db.query("select status,details->>'ack' ack from public.tasks where id=$1",[task])).rows[0]).toEqual({status:"filed",ack:"invented token 123"});
}));
