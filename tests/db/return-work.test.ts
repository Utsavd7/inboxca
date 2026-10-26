import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,rollback,actAs} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

// A firm with an owner, a manager, two staff and one GST client the manager and a staff member
// look after, with a GSTR-1 due in a few days. All names and numbers are invented.
async function seed(due=3,client=db) {
  const firm=randomUUID(),owner=randomUUID(),manager=randomUUID(),staff=randomUUID(),other=randomUUID(),customer=randomUUID(),registration=randomUUID(),task=randomUUID();
  for(const person of [owner,manager,staff,other]) await client.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await client.query("insert into public.firms(id,name,state_code,status) values ($1,'Return Work Test Firm','24','active')",[firm]);
  await client.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'manager','active'),($1,$4,'staff','active'),($1,$5,'staff','active')",[firm,owner,manager,staff,other]);
  await client.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Return Client','business')",[customer,firm]);
  await client.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,$3,'gstin','invented encrypted number',$4)",[registration,firm,customer,randomUUID()]);
  await client.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'manager'),($1,$2,$4,'staff')",[firm,customer,manager,staff]);
  await client.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values ($1,$2,$3,$4,'GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+$5::int)",[task,firm,customer,registration,due]);
  const draft=randomUUID(),lines=[randomUUID(),randomUUID()];
  const body=(states:string[],value="invented encrypted figure",by=owner)=>({lines:lines.map((id,n)=>({id,field:`b2b.r2.c${n}`,value_enc:`${value} ${n}`,state:states[n],...(states[n]!=="pending" && {by,at:new Date().toISOString()})})),checks:[]});
  const fill=async(revision:number,on=client)=>(await on.query("select public.fill_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,null,'Invented - GSTR-1 - Sep 2026','xlsx') saved",[firm,customer,registration,JSON.stringify([{id:draft,revision}])])).rows[0].saved;
  const finish=async(id:string)=>(await client.query("select public.finish_form($1,$2,$3,$4,$5,100,null) saved",[id,firm,owner,`invented-file-${id}`,"a".repeat(64)])).rows[0].saved; // ggignore: invented checksum.
  return {firm,owner,manager,staff,other,client:customer,registration,task,draft,body,fill,finish};
}
const stage=async(firm:string,task:string)=>(await db.query("select stage,open,missing from public.return_stages($1,array[$2::uuid])",[firm,task])).rows[0];
const jobs=async(task:string)=>(await db.query("select count(*)::int n from public.jobs where kind='fill_return' and entity_id=$1",[task])).rows[0].n;
const drafts=async(firm:string)=>(await db.query("select id,name,prepared->>'status' status,prepared->'filled' filled from public.documents where firm_id=$1 and prepared is not null order by (prepared->>'version')::int",[firm])).rows;
const pins=async(firm:string,person:string)=>{await actAs(db,person);const {rows}=await db.query("select kind from public.return_pins($1)",[firm]);await db.query("reset role");return rows.map(row=>row.kind);};

it("fills a return from figures not checked yet, keeps one draft, and lets nothing out until every figure is checked",()=>rollback(db,async()=>{
  const {firm,owner,manager,client,registration,task,draft,body,fill,finish}=await seed(10);
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body(["confirmed","pending"])]);
  expect(await stage(firm,task)).toEqual({stage:"figures",open:1,missing:null});
  // Outside the firm's days before the due date nothing is filled by itself.
  expect(await jobs(task)).toBe(0);
  const first=await fill(1);expect(first.name).toBe("Invented - GSTR-1 - Sep 2026 - v1 (to check).xlsx");
  expect((await fill(1)).id).toBe(first.id);expect(await finish(first.id)).toBe(true);
  expect((await drafts(firm))[0]).toMatchObject({status:"draft",filled:true});expect((await stage(firm,task)).stage).toBe("filled");
  // Not ready, so it is never approved, downloaded or filed.
  expect((await db.query("select public.form_ready($1) ready",[first.id])).rows[0].ready).toBe(false);
  expect((await db.query("select public.decide_form($1,$2,'approved','{}') saved",[first.id,manager])).rows[0].saved).toBe(false);
  expect((await db.query("select public.file_prepared_form($1,$2,'INVENTEDACK1',null) saved",[first.id,owner])).rows[0].saved).toBe(false);
  // A check alone keeps the same fill; filling again opens it.
  await db.query("update public.datasets set revision=2,data=$2 where id=$1",[draft,body(["confirmed","rejected"])]);
  expect((await stage(firm,task)).stage).toBe("filled");expect(await jobs(task)).toBe(0);
  expect(await fill(2)).toBeNull();
  await db.query("update public.datasets set revision=3,data=$2 where id=$1",[draft,body(["confirmed","confirmed"])]);
  // Every figure checked: InboxCA makes the checked version, the same work Prepare makes.
  expect((await stage(firm,task)).stage).toBe("checked");expect(await jobs(task)).toBe(1);
  const checked=await fill(3);expect(checked.name).toBe("Invented - GSTR-1 - Sep 2026 - v2.xlsx");
  expect((await db.query("select public.reserve_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,$5,'Invented - GSTR-1 - Sep 2026','xlsx') saved",[firm,client,registration,JSON.stringify([{id:draft,revision:3}]),owner])).rows[0].saved.id).toBe(checked.id);
  expect(await finish(checked.id)).toBe(true);expect((await stage(firm,task)).stage).toBe("approved");
  // A changed figure: the approval goes, and the return is filled again as the next version.
  await db.query("update public.datasets set revision=4,data=$2 where id=$1",[draft,body(["pending","pending"],"invented corrected figure")]);
  expect((await stage(firm,task)).stage).toBe("figures");expect(await jobs(task)).toBe(2);
  expect((await fill(4)).name).toBe("Invented - GSTR-1 - Sep 2026 - v3 (to check).xlsx");
  expect((await drafts(firm)).map(row=>row.status)).toEqual(["draft","draft","draft"]);
  // A filed return is never filled again.
  await db.query("update public.tasks set status='filed',details=jsonb_build_object('filed_on','2026-10-11') where id=$1",[task]);
  expect(await fill(4)).toBeNull();expect((await stage(firm,task)).stage).toBe("filed");
}));

it("fills by itself from the firm's days before the due date, and the morning run finds the rest",()=>rollback(db,async()=>{
  const {firm,client,task,draft,body}=await seed(4);
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body(["pending","pending"])]);
  expect(await jobs(task)).toBe(1);
  await db.query("delete from public.jobs where kind='fill_return' and entity_id=$1",[task]);
  await db.query("select private.queue_due_fills()");expect(await jobs(task)).toBe(1);
  await db.query("select private.queue_due_fills()");expect(await jobs(task)).toBe(1);
}));

it("pins what holds a return up to its people from the firm's days before due, and a checked draft to its approver",()=>rollback(db,async()=>{
  const {firm,owner,manager,staff,other,client,registration,task,draft,body,fill,finish}=await seed(4);
  for(const person of [owner,manager,staff]) expect(await pins(firm,person)).toEqual(["missing"]);
  expect(await pins(firm,other)).toEqual([]);
  await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body(["confirmed","pending"])]);
  expect(await pins(firm,staff)).toEqual(["fill"]);
  expect(await finish((await fill(1)).id)).toBe(true);expect(await pins(firm,staff)).toEqual(["check"]);
  // Outside the window nothing is pinned, until the firm pins earlier.
  await db.query("update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date+8 where id=$1",[task]);
  expect(await pins(firm,staff)).toEqual([]);
  await db.query("update public.firms set settings=jsonb_build_object('pin_days',10) where id=$1",[firm]);
  expect(await pins(firm,staff)).toEqual(["check"]);
  // Second approval on: the checked draft goes to the manager, not to the owner who checked it.
  await db.query("update public.firms set settings=jsonb_build_object('second_form_approval',true) where id=$1",[firm]);
  await db.query("update public.datasets set revision=2,data=$2 where id=$1",[draft,body(["confirmed","confirmed"])]);
  const {rows:[{saved}]}=await db.query("select public.reserve_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,$5,'Invented - GSTR-1 - Sep 2026','xlsx') saved",[firm,client,registration,JSON.stringify([{id:draft,revision:2}]),owner]);
  expect(await finish(saved.id)).toBe(true);
  expect(await pins(firm,manager)).toEqual(["approve"]);
  expect(await pins(firm,owner)).toEqual([]);expect(await pins(firm,staff)).toEqual([]);
  expect((await db.query("select public.decide_form($1,$2,'approved','{}') saved",[saved.id,manager])).rows[0].saved).toBe(true);
  for(const person of [owner,manager,staff]) expect(await pins(firm,person)).toEqual(["approved"]);
  expect(await pins(firm,other)).toEqual([]);
  expect((await db.query("select public.file_prepared_form($1,$2,'INVENTEDACK1',null) saved",[saved.id,staff])).rows[0].saved).toBe(true);
  for(const person of [owner,manager,staff]) expect(await pins(firm,person)).toEqual([]);
}));

// Two people press Fill at once (or a person and the automatic fill): one draft.
it("makes one draft when two fills race",async()=>{
  const other=await connect();
  const {firm,owner,manager,staff,other:spare,client,draft,body,fill}=await seed(3);
  try {
    await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body(["pending","pending"])]);
    await db.query("begin");
    const first=await fill(1);
    const second=fill(1,other);
    await new Promise(resolve=>setTimeout(resolve,300));
    await db.query("commit");
    expect((await second).id).toBe(first.id);
    expect(await drafts(firm)).toHaveLength(1);
  } finally {
    await db.query("rollback").catch(()=>{});
    await other.end();
    await db.query("begin");await db.query("select set_config('app.log_purge','on',true)");
    await db.query("delete from public.firms where id=$1",[firm]);
    await db.query("delete from auth.users where id=any($1)",[[owner,manager,staff,spare]]);
    await db.query("commit");
  }
});
