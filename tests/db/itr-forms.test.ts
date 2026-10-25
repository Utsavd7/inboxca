import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,rollback} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

it("uses a PAN and assessment year, keeps corrections checked, and closes only the matching ITR work",()=>rollback(db,async()=>{
  const firm=randomUUID(),person=randomUUID(),client=randomUUID(),pan=randomUUID(),gst=randomUUID(),draft=randomUUID(),line=randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)",[person,`${person}@invented.test`]);
  await db.query("insert into public.firms(id,name,state_code,status) values($1,'Invented ITR Firm','24','active')",[firm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'owner','active')",[firm,person]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented ITR Client','individual')",[client,firm]);
  for(const [id,kind] of [[pan,"pan"],[gst,"gstin"]]) await db.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values($1,$2,$3,$4,'invented encrypted number',$5)",[id,firm,client,kind,randomUUID()]);
  const body={target:{form:"ITR1",version:"1.1"},lines:[{id:line,field:"itr.salary.gross",value_enc:"invented encrypted salary",source:{entered_by:person,entered_at:new Date().toISOString()},state:"pending",by:person,at:new Date().toISOString()}],checks:[]};
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[draft,firm,client,body]);
  const reserve=async(revision:number,registration=pan,form="ITR1",period="2026")=>(await db.query("select public.reserve_form($1,$2,$3,$4,$5,'1.1',$6,$7,'Invented - ITR-1 - AY 2026-27','json') saved",[firm,client,registration,form,period,JSON.stringify([{id:draft,revision}]),person])).rows[0].saved;
  expect(await reserve(1)).toBeNull();
  body.lines[0].state="confirmed";await db.query("update public.datasets set revision=2,data=$2 where id=$1",[draft,body]);
  expect(await reserve(2,gst)).toBeNull();expect(await reserve(2,pan,"ITR4")).toBeNull();
  expect(await reserve(2,pan,"ITR1","2026-03")).toBeNull();expect(await reserve(2,pan,"ITR1","2025")).toBeNull();
  const first=await reserve(2);expect(first.name).toContain("v1.json");expect((await reserve(2)).id).toBe(first.id);
  const finish=async(target:string)=>(await db.query("select public.finish_form($1,$2,$3,$4,$5,100,null) saved",[target,firm,person,`invented-${target}`,"a".repeat(64)])).rows[0].saved; // ggignore: invented file checksum.
  expect(await finish(first.id)).toBe(true);
  expect((await db.query("select work_type,document_type,period_key from public.documents where id=$1",[first.id])).rows[0]).toEqual({work_type:"income_tax",document_type:"ITR-1",period_key:"2026"});
  body.lines[0].value_enc="invented changed encrypted salary";body.lines[0].state="pending";
  await db.query("update public.datasets set revision=3,data=$2 where id=$1",[draft,body]);
  expect((await db.query("select public.form_ready($1) ready",[first.id])).rows[0].ready).toBe(false);
  expect(await reserve(3)).toBeNull();
  body.lines[0].state="confirmed";await db.query("update public.datasets set revision=4,data=$2 where id=$1",[draft,body]);
  const second=await reserve(4);expect(second.name).toContain("v2.json");expect(await finish(second.id)).toBe(true);
  const acknowledgement=randomUUID(),task=randomUUID(),otherTask=randomUUID();
  await db.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values($1,$2,$3,$4,'ITR_NA','2026-03','2026-07-31'),($5,$2,$3,$4,'ADV_TAX','2026-03','2026-03-15')",[task,firm,client,pan,otherTask]);
  await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values($1,'reminder','task',$2,$3)",[firm,task,randomUUID()]);
  await db.query("insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'income_tax','ITR-V','2026','Invented ITR-V.pdf',100,$4,'invented-ack')",[acknowledgement,firm,client,"b".repeat(64)]); // ggignore: invented acknowledgement checksum.
  expect((await db.query("select details->>'paper' paper from public.requests where kind='form_confirmation' and entity_id=$1",[second.id])).rows).toEqual([{paper:acknowledgement}]);
  expect((await db.query("select public.file_prepared_form($1,$2,'INVENTED-ACK',$3) saved",[second.id,person,acknowledgement])).rows[0].saved).toBe(true);
  expect((await db.query("select status from public.tasks where id=$1",[task])).rows[0].status).toBe("filed");
  expect((await db.query("select status from public.tasks where id=$1",[otherTask])).rows[0].status).toBe("upcoming");
  expect((await db.query("select state from public.jobs where entity_id=$1",[task])).rows[0].state).toBe("cancelled");
  expect((await db.query("select state from public.jobs where kind='form_ack' and entity_id=$1",[second.id])).rows[0].state).toBe("pending");
  const edited=randomUUID(),editedDraft=randomUUID(),checksum="c".repeat(64); // ggignore: invented checksum for an edited ITR.
  await db.query("insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id) values($1,$2,$3,'income_tax','ITR-1','2026','Edited.json',100,$4,'invented-edited')",[edited,firm,client,checksum]);
  const entered={...body,lines:[{...body.lines[0],state:"pending",source:{document:edited,sha256:checksum,page:1,path:"/ITR/ITR1/PersonalInfo/PAN"}}]};
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[editedDraft,firm,client,entered]);
  const attached=(await db.query("select public.add_edited_form($1,$2,$3,'1.1',$4,'Invented - ITR-1 - AY 2026-27') saved",[edited,editedDraft,pan,person])).rows[0].saved;
  expect(attached.name).toContain("v3.json");expect((await db.query("select public.form_ready($1) ready",[edited])).rows[0].ready).toBe(false);
  entered.lines[0].state="confirmed";await db.query("update public.datasets set revision=2,data=$2 where id=$1",[editedDraft,entered]);
  expect((await db.query("select public.form_ready($1) ready",[edited])).rows[0].ready).toBe(true);
  // ITR-2 and ITR-3 use the same path with their own pinned versions; ITR-5 has no form yet.
  const three=randomUUID();
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'ITR','2026',$4)",[three,firm,client,{...body,target:{form:"ITR3",version:"1.1"},lines:[{...body.lines[0],state:"confirmed"}]}]);
  const prepare=async(form:string,version:string)=>(await db.query("select public.reserve_form($1,$2,$3,$4,'2026',$5,$6,$7,'Invented - return - AY 2026-27','json') saved",[firm,client,pan,form,version,JSON.stringify([{id:three,revision:1}]),person])).rows[0].saved;
  expect(await prepare("ITR2","1.2")).toBeNull();expect(await prepare("ITR5","1.1")).toBeNull();
  const itr3=await prepare("ITR3","1.1");expect(itr3.name).toContain("v1.json");
  expect((await db.query("select document_type from public.documents where id=$1",[itr3.id])).rows[0].document_type).toBe("ITR-3");
}));
