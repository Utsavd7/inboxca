import {randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {actAs,asOwner,connect,rollback} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

// Fill all (20261102000000_bulk_fill.sql): a firm with an owner, a manager, two staff and a
// partner from another firm, and three GST clients with returns due soon. The manager and the
// first staff member look after the first client. All names and numbers are invented.
async function seed() {
  const firm=randomUUID(),owner=randomUUID(),manager=randomUUID(),staff=randomUUID(),other=randomUUID(),outsider=randomUUID(),elsewhere=randomUUID();
  for(const person of [owner,manager,staff,other,outsider]) await db.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Fill All Test Firm','24','active'),($2,'Fill All Other Firm','24','active')",[firm,elsewhere]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'manager','active'),($1,$4,'staff','active'),($1,$5,'staff','active'),($6,$7,'partner','active')",[firm,owner,manager,staff,other,elsewhere,outsider]);
  const clients:{client:string;registration:string;task:string;draft:string}[]=[];
  for(const [n,due] of [[1,-2],[2,6],[3,9]]) {
    const client=randomUUID(),registration=randomUUID(),task=randomUUID(),draft=randomUUID();
    await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,$3,'business')",[client,firm,`Invented Fill Client ${n}`]);
    await db.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,$3,'gstin','invented encrypted number',$4)",[registration,firm,client,randomUUID()]);
    await db.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values ($1,$2,$3,$4,'GSTR1_M','2026-09',(now() at time zone 'Asia/Kolkata')::date+$5::int)",[task,firm,client,registration,due]);
    await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values ($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,body(["confirmed","pending"],owner)]);
    clients.push({client,registration,task,draft});
  }
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'manager'),($1,$2,$4,'staff')",[firm,clients[0].client,manager,staff]);
  // What InboxCA queued by itself as the figures came in: the test starts with none.
  await db.query("delete from public.jobs where firm_id=$1",[firm]);
  return {firm,owner,manager,staff,other,outsider,clients};
}
const lines=[randomUUID(),randomUUID()];
const body=(states:string[],by:string,value="invented encrypted figure")=>({lines:lines.map((id,n)=>({id,field:`b2b.r2.c${n}`,value_enc:`${value} ${n}`,state:states[n],...(states[n]!=="pending" && {by,at:new Date().toISOString()})})),checks:[]});
const as=async<T>(person:string,sql:string,params:unknown[])=>{await actAs(db,person);try {return (await db.query(sql,params)).rows as T[];} finally {await asOwner(db);}};
const due=(firm:string,person:string)=>as<{task:string;ready:boolean;filling:boolean;stage:string;open:number}>(person,"select task,ready,filling,stage,open from public.due_fills($1)",[firm]);
const queue=async(firm:string,person:string,batch=randomUUID())=>({batch,...(await as<{queued:number;clients:number;first_job:string|null}>(person,"select * from public.queue_fills($1,$2)",[firm,batch]))[0]});
const stop=async(firm:string,person:string,batch:string,job:string)=>(await as<{stopped:number}>(person,"select public.stop_fills($1,$2,$3) stopped",[firm,batch,job]))[0].stopped;
const jobs=async(firm:string)=>(await db.query("select entity_id,state,run_at>now() later from public.jobs where firm_id=$1 and kind='fill_return' order by id",[firm])).rows;

it("lets the owner fill the whole firm, a manager their team's clients, and anyone else only with the right",()=>rollback(db,async()=>{
  const {firm,owner,manager,staff,other,outsider,clients}=await seed();
  // 2 days late and due in 6 days; the one due in 9 days is outside the 7.
  expect((await due(firm,owner)).map(row=>row.task)).toEqual([clients[0].task,clients[1].task]);
  expect((await due(firm,owner)).every(row=>row.ready && !row.filling && row.stage==="figures" && row.open===1)).toBe(true);
  expect((await due(firm,manager)).map(row=>row.task)).toEqual([clients[0].task]);
  for(const person of [staff,other,outsider]) {
    expect(await due(firm,person)).toEqual([]);
    expect(await queue(firm,person)).toMatchObject({queued:0,first_job:null});
  }
  // An approved permission request for the client, or the right from Settings: their own clients only.
  await db.query("insert into public.requests(id,firm_id,client_id,kind,entity_type,entity_id,reason_code,status,expires_at,details) values ($4,$1,$2,'permission','permission',$4,'edit_figures','approved',now()+interval '1 hour',jsonb_build_object('by',$3::text))",[firm,clients[0].client,staff,randomUUID()]);
  expect((await due(firm,staff)).map(row=>row.task)).toEqual([clients[0].task]);
  await db.query("update public.firms set settings=jsonb_build_object('permissions',jsonb_build_object('employee',jsonb_build_object('edit_figures',true))) where id=$1",[firm]);
  expect(await due(firm,other)).toEqual([]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')",[firm,clients[1].client,other]);
  expect((await due(firm,other)).map(row=>row.task)).toEqual([clients[1].task]);
  // The manager's press queues their team's return only, 20 seconds from now, and logs it once.
  const asked=await queue(firm,manager);
  expect(asked).toMatchObject({queued:1,clients:1});
  expect(await jobs(firm)).toEqual([{entity_id:clients[0].task,state:"pending",later:true}]);
  const {rows:log}=await db.query("select actor_id,entity_type,details from public.activity_log where firm_id=$1 and action='fills.asked'",[firm]);
  expect(log).toEqual([{actor_id:manager,entity_type:"firm",details:{returns:1,clients:1,batch:asked.batch}}]);
}));

it("never fills a return twice, never one that is filed, filled or not ready",()=>rollback(db,async()=>{
  const {firm,owner,manager,clients}=await seed();
  const first=await queue(firm,owner);expect(first).toMatchObject({queued:2,clients:2});
  // Pressed again, or after the morning run: the returns being filled are left out.
  expect((await due(firm,owner)).every(row=>row.filling)).toBe(true);
  expect(await queue(firm,owner)).toMatchObject({queued:0});
  expect(await jobs(firm)).toHaveLength(2);
  await db.query("update public.jobs set state='done' where firm_id=$1",[firm]);
  // Filled already: a draft made from these figures. Filed: never listed.
  const filled=await db.query("select public.fill_form($1,$2,$3,'GSTR1','2026-09','2.2',$4,null,'Invented - GSTR-1 - Sep 2026','xlsx') saved",[firm,clients[0].client,clients[0].registration,JSON.stringify([{id:clients[0].draft,revision:1}])]);
  expect(filled.rows[0].saved.id).toBeTruthy();
  await db.query("update public.documents set size=100,drive_file_id='invented-file',sha256=$2 where id=$1",[filled.rows[0].saved.id,"a".repeat(64)]); // ggignore: invented checksum.
  await db.query("update public.tasks set status='filed',details=jsonb_build_object('filed_on','2026-10-11') where id=$1",[clients[1].task]);
  expect(await due(firm,owner)).toMatchObject([{task:clients[0].task,stage:"filled",ready:false,filling:false}]);
  expect(await queue(firm,owner)).toMatchObject({queued:0});
  // A figure marked wrong holds the return back until it is corrected.
  await db.query("update public.tasks set status='upcoming',details='{}' where id=$1",[clients[1].task]);
  await db.query("update public.datasets set revision=2,data=$2 where id=$1",[clients[1].draft,body(["confirmed","rejected"],owner)]);
  await db.query("delete from public.jobs where firm_id=$1 and state='pending'",[firm]);
  expect((await due(firm,owner)).find(row=>row.task===clients[1].task)).toMatchObject({stage:"figures",ready:false});
  // A figure changed after the fill: the return is filled again, as its next version.
  await db.query("update public.datasets set revision=2,data=$2 where id=$1",[clients[0].draft,body(["confirmed","pending"],owner,"invented corrected figure")]);
  await db.query("delete from public.jobs where firm_id=$1 and state='pending'",[firm]);
  expect((await due(firm,owner)).find(row=>row.task===clients[0].task)).toMatchObject({stage:"figures",ready:true,filling:false});
  expect(await queue(firm,manager)).toMatchObject({queued:1});
}));

it("stops the whole batch on Undo, only for the person who asked and only before any of it starts",()=>rollback(db,async()=>{
  const {firm,owner,manager}=await seed();
  const asked=await queue(firm,owner);
  expect(await stop(firm,manager,asked.batch,asked.first_job!)).toBe(0);
  await db.query("update public.jobs set state='claimed' where id=$1",[asked.first_job]);
  expect(await stop(firm,owner,asked.batch,asked.first_job!)).toBe(0);
  expect((await jobs(firm)).map(row=>row.state)).toEqual(["claimed","pending"]);
  await db.query("update public.jobs set state='pending' where id=$1",[asked.first_job]);
  expect(await stop(firm,owner,asked.batch,asked.first_job!)).toBe(2);
  expect((await jobs(firm)).map(row=>row.state)).toEqual(["cancelled","cancelled"]);
  expect((await db.query("select details->>'returns' n from public.activity_log where firm_id=$1 and action='fills.stopped'",[firm])).rows).toEqual([{n:"2"}]);
  // Stopped returns can be asked for again.
  expect(await queue(firm,owner)).toMatchObject({queued:2});
}));

it("gives a manager their team's people's clients, unless the firm shows staff only their own",()=>rollback(db,async()=>{
  const {firm,manager,other,clients}=await seed();
  const team=randomUUID();
  await db.query("insert into public.groups(id,firm_id,kind,name) values ($1,$2,'team','Invented team')",[team,firm]);
  await db.query("update public.firm_members set team_id=$2 where firm_id=$1 and user_id=any($3)",[firm,team,[manager,other]]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')",[firm,clients[1].client,other]);
  expect((await due(firm,manager)).map(row=>row.task)).toEqual([clients[0].task,clients[1].task]);
  await db.query("update public.firms set settings=jsonb_build_object('client_visibility','restricted') where id=$1",[firm]);
  expect((await due(firm,manager)).map(row=>row.task)).toEqual([clients[0].task]);
  expect(await queue(firm,manager)).toMatchObject({queued:1,clients:1});
}));
