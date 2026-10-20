// ggignore: GreenMail uses this public password only on the local test server.
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({encrypt:async()=>"invented encrypted link",decrypt:async(firm:string,place:string)=>place.endsWith("/credentials") ? JSON.stringify({password:"secret"}) : place.endsWith("/address") ? "office@firm.test" : `worker-${firm}@invented.test`})}));
import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {localSupabase} from "../local-env";
import {supabaseAdmin} from "@/src/lib/supabase";
import {bulkSend} from "@/src/jobs/bulk-send";
import type {Job} from "@/src/jobs/runner";
import {connect} from "./db";
it("runs a bulk list through the database and local mailbox, skipping a missing address",async()=>{
  const local=localSupabase(),db=await connect(),firm=randomUUID(),request=randomUUID();
  vi.stubEnv("SUPABASE_URL",local.url);vi.stubEnv("SUPABASE_SECRET_KEY",local.secretKey);
  try {
    await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Bulk Worker Test Firm','24','active')",[firm]);
    const client=(await db.query("insert into public.clients(firm_id,name,kind) values ($1,'Invented Worker Client','individual') returning id",[firm])).rows[0].id;
    await db.query("insert into public.requests(id,firm_id,kind,entity_type,entity_id,details) values ($1,$2,'bulk_send','bulk_send',$1,$3)",[request,firm,{by:randomUUID(),type:"ITR-V",period:"2025",day:"2026-10-20",clients:[{id:client,share:randomUUID()}]}]);
    const admin=supabaseAdmin();
    expect((await admin.from("requests").select("id,firm_id,status,details,firms(name,settings)").eq("id",request).maybeSingle()).error).toBeNull();
    expect(await bulkSend({entity_id:request} as Job,{markSending:async()=>{}})).toEqual({done:true});
    expect((await db.query("select status,details#>>'{clients,0,reason}' reason from public.requests where id=$1",[request])).rows).toEqual([{status:"done",reason:"no_email"}]);
    await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,'mail','imap','invented encrypted address','invented encrypted credentials',$2)",[firm,{imap:{host:"127.0.0.1",port:3143},smtp:{host:"127.0.0.1",port:3025}}]);
    await db.query("update public.clients set email_enc='invented encrypted email',email_bidx='invented index' where id=$1",[client]);
    await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,status,drive_file_id,name,size,sha256) values ($1,$2,'income_tax','ITR-V','2025','filed','invented.pdf','Invented ITR-V',1,'invented')",[firm,client]);
    await db.query("update public.requests set status='pending',details=jsonb_set(details,'{clients,0}',(details#>'{clients,0}')-'state'-'reason') where id=$1",[request]);
    expect(await bulkSend({entity_id:request} as Job,{markSending:async()=>{}})).toEqual({done:true});
    expect((await db.query("select status,details#>>'{clients,0,state}' sent from public.requests where id=$1",[request])).rows).toEqual([{status:"done",sent:"sent"}]);

  } finally {
    await db.query("begin");await db.query("select set_config('app.log_purge','on',true)");await db.query("delete from public.firms where id=$1",[firm]);await db.query("commit");await db.end();vi.unstubAllEnvs();
  }
});
