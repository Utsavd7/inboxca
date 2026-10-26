import {randomBytes,randomUUID} from "node:crypto";
import type {Client} from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {firmCrypto,localKek} from "@/src/lib/crypto";
import {matchPlace,purchaseMappingPlace} from "@/src/lib/purchase-register";
import {checkValues,pgKeyStore} from "../../scripts/encrypted-values.mts";
import {actAs,asOwner,attempt,connect,rollback} from "./db";
let db:Client;
beforeAll(async()=>{db=await connect();});afterAll(async()=>{await db.end();});

// A firm with an owner and two staff, one of whom looks after a GST client whose September
// purchase register was matched with its GSTR-2B, its GSTR-3B still to file. All invented.
async function seed() {
  const [firm,owner,staff,other,client,registration,register,statement,task]=Array.from({length:9},()=>randomUUID());
  await asOwner(db);
  for(const person of [owner,staff,other]) await db.query("insert into auth.users(id,email) values ($1,$2)",[person,`${person}@invented.test`]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'GST Match Test Firm','24','active')",[firm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active'),($1,$4,'staff','active')",[firm,owner,staff,other]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$2,'Invented Match Client','business')",[client,firm]);
  await db.query("insert into public.client_registrations(id,firm_id,client_id,kind,number_enc,number_bidx) values ($1,$2,$3,'gstin','invented encrypted number',$4)",[registration,firm,client,randomUUID()]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')",[firm,client,staff]);
  await db.query("insert into public.documents(id,firm_id,client_id,work_type,document_type,period_key,drive_file_id,name,size,sha256,registration_id) values ($1,$2,$3,'gst','Purchase bills','2026-09','file-1','register.csv',1,'a',$5),($4,$2,$3,'gst','GSTR-2B','2026-09','file-2','statement.json',1,'b',$5)",[register,firm,client,statement,registration]);
  await db.query("insert into public.tasks(id,firm_id,client_id,registration_id,code,period_key,due_on) values ($1,$2,$3,$4,'GSTR3B_M','2026-09','2026-10-20')",[task,firm,client,registration]);
  await db.query("insert into public.gst_matches(firm_id,register_id,statement_id,counts,result_enc) values ($1,$2,$3,'{\"matched\":12,\"missing\":3,\"extra\":0,\"differ\":1}','sealed')",[firm,register,statement]);
  return {firm,owner,staff,other,client,registration,register,statement,task};
}
const items=async(firm:string,person:string)=>{await actAs(db,person);const {rows}=await db.query("select register_id,client_id,client_name,period_key,due_on::text,counts from public.gst_match_items($1)",[firm]);await asOwner(db);return rows;};

it("puts a month with differences on the list of whoever looks after the client, until its GSTR-3B is filed",()=>rollback(db,async()=>{
  const {firm,owner,staff,other,client,register,statement,task}=await seed();
  expect(await items(firm,staff)).toEqual([{register_id:register,client_id:client,client_name:"Invented Match Client",period_key:"2026-09",due_on:"2026-10-20",counts:{matched:12,missing:3,extra:0,differ:1}}]);
  expect(await items(firm,owner)).toHaveLength(1);
  expect(await items(firm,other)).toEqual([]);
  // Everyone who sees the register sees its match; nobody signed in writes one.
  await actAs(db,other);
  expect((await db.query("select register_id from public.gst_matches")).rows).toEqual([{register_id:register}]);
  expect((await attempt(db,"update public.gst_matches set counts='{\"matched\":0,\"missing\":0,\"extra\":0,\"differ\":0}'")).ok).toBe(false);
  expect((await attempt(db,"insert into public.gst_matches(firm_id,register_id,statement_id,counts,result_enc) values ($1,$2,$2,'{}','x')",[firm,statement])).ok).toBe(false);
  await asOwner(db);
  // A newer GSTR-2B makes the match old; nothing to look at once every bill agrees.
  await db.query("update public.documents set status='earlier' where id=$1",[statement]);
  expect(await items(firm,staff)).toEqual([]);
  await db.query("update public.documents set status='filed' where id=$1",[statement]);
  await db.query("update public.gst_matches set counts='{\"matched\":16,\"missing\":0,\"extra\":0,\"differ\":0}' where firm_id=$1",[firm]);
  expect(await items(firm,staff)).toEqual([]);
  await db.query("update public.gst_matches set counts='{\"matched\":16,\"missing\":0,\"extra\":2,\"differ\":0}' where firm_id=$1",[firm]);
  expect(await items(firm,staff)).toHaveLength(1);
  await db.query("update public.tasks set status='filed',details=jsonb_build_object('filed_on','2026-10-19') where id=$1",[task]);
  expect(await items(firm,staff)).toEqual([]);
  // A match goes with its paper.
  await db.query("delete from public.documents where id=$1",[register]);
  expect((await db.query("select count(*)::int n from public.gst_matches where firm_id=$1",[firm])).rows[0].n).toBe(0);
  expect((await attempt(db,"insert into public.gst_matches(firm_id,register_id,statement_id,counts,result_enc) values ($1,$2,$2,'{\"matched\":0}','x')",[firm,statement])).ok).toBe(false);
}));

it("finds the quarter's GSTR-3B for a QRMP client's month",()=>rollback(db,async()=>{
  const {firm,staff,register,task}=await seed();
  await db.query("update public.documents set period_key='2026-08' where id=$1",[register]);
  expect(await items(firm,staff)).toEqual([]);
  await db.query("update public.tasks set code='GSTR3B_Q',due_on='2026-10-22' where id=$1",[task]);
  expect((await items(firm,staff)).map((row)=>[row.period_key,row.due_on])).toEqual([["2026-08","2026-10-22"]]);
}));

it("seals the lists and the remembered columns where the key rotation finds them",()=>rollback(db,async()=>{
  const {firm,client,register}=await seed();
  const crypto=firmCrypto(localKek(randomBytes(32)),pgKeyStore(db,true));
  await db.query("update public.gst_matches set result_enc=$2 where register_id=$1",[register,await crypto.encrypt(firm,matchPlace(register),"{}")]);
  await db.query("update public.clients set purchase_mapping_enc=$2 where id=$1",[client,await crypto.encrypt(firm,purchaseMappingPlace(client),"[]")]);
  const counts=await checkValues(db,crypto,[firm]);
  expect(counts["gst_matches.result"]).toMatchObject({values:1,opened:1});
  expect(counts["clients.purchase_mapping"]).toMatchObject({values:1,opened:1});
}));
