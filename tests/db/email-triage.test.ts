import {randomBytes,randomUUID} from "node:crypto";
import fs from "node:fs";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import {expect,it,vi} from "vitest";
import samples from "../fixtures/samples/emails.json";
import {localSupabase} from "../local-env";
import {firmCrypto,localKek,supabaseKeyStore} from "@/src/lib/crypto";
import {supabaseAdmin} from "@/src/lib/supabase";
import {checkMailbox} from "@/src/lib/mailbox";
import {handlers} from "@/src/jobs/handlers";
import {mailPoll} from "@/src/jobs/mail-poll";
import type {Job} from "@/src/jobs/runner";
import {connect} from "./db";
const state=vi.hoisted(()=>({crypto:undefined as ReturnType<typeof import("@/src/lib/crypto").firmCrypto>|undefined}));
vi.mock("@/src/lib/crypto",async(importOriginal)=>({...await importOriginal<object>(),serverCrypto:()=>state.crypto!}));
const text=(value:unknown)=>{
  if (typeof value==="string") return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString();
  try{return JSON.stringify(value) ?? "";}catch{return String(value);}
};

// M3 acceptance: real mailbox transport, all seven labels, and no saved email text.
it("triages 50 invented emails and keeps their subjects and bodies out of saved records",async()=>{
  const local=localSupabase(),db=await connect(),firm=randomUUID(),account=randomUUID(),client=randomUUID(),run=randomUUID();
  const dir=await mkdtemp(path.join(tmpdir(),"inboxca-mail-privacy-"));
  vi.stubEnv("SUPABASE_URL",local.url);vi.stubEnv("SUPABASE_SECRET_KEY",local.secretKey);vi.stubEnv("DRIVE_LOCAL_DIR",dir);
  const pack=[...new Set(samples.map((sample)=>sample.label))].flatMap((label)=>samples.filter((sample)=>sample.label===label).slice(0,7)).concat(samples.filter((sample)=>sample.label==="other").slice(7,8));
  expect(pack).toHaveLength(50);
  const markers=Array.from({length:51},(_,n)=>[`SUBJECT_ONLY_${run}_${n}`,`BODY_ONLY_${run}_${n}`]).flat();
  const contains=(value:unknown)=>markers.some((marker)=>text(value).includes(marker));
  const originalFetch=globalThis.fetch;
  let leaked=false,correct=0,low=0;
  const smtp=nodemailer.createTransport({host:"127.0.0.1",port:3025,secure:false,ignoreTLS:true,pool:true,maxConnections:3});
  try {
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
      const url=typeof input==="string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).origin!==new URL(local.url).origin) throw new Error("Unexpected external request");
      const body=init?.body ?? (input instanceof Request ? await input.clone().text() : null);
      leaked ||= contains(body instanceof Blob ? await body.text() : body);
      return originalFetch(input,init);
    });
    const admin=supabaseAdmin();
    state.crypto=firmCrypto(localKek(randomBytes(32)),supabaseKeyStore(admin));
    await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Triage Test Firm','24','active')",[firm]);
    const email=`triage-${run}@invented.test`,crypto=state.crypto;
    await db.query("insert into public.clients(id,firm_id,name,kind,email_enc,email_bidx) values ($1,$2,'Invented Triage Client','individual',$3,$4)",[client,firm,await crypto.encrypt(firm,`clients/${client}/email`,email),await crypto.blindIndex(firm,"email",email)]);
    const settings={imap:{host:"127.0.0.1",port:3143},smtp:{host:"127.0.0.1",port:3025}};
    // A mailbox of this run's own, so the poll reads only these emails. GreenMail makes a
    // mailbox for every address it receives mail for, its password the address.
    const office=`triage-office-${run}@invented.test`,password=office;
    await smtp.sendMail({from:"setup@invented.test",to:office,subject:"Invented test setup",text:"Makes the test mailbox"});
    const checked=await checkMailbox(office,password,settings);
    expect("cursor" in checked).toBe(true);
    await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,settings,sync_cursor) values ($1,$2,'mail','imap',$3,$4,$5,$6)",[account,firm,await crypto.encrypt(firm,`accounts/${account}/address`,office),await crypto.encrypt(firm,`accounts/${account}/credentials`,JSON.stringify({password})),settings,"cursor" in checked ? checked.cursor : ""]);
    // The firm's drive is the local test folder, so filing really writes files.
    const drive=randomUUID();
    await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values ($1,$2,'drive','local',$3,$4)",[drive,firm,await crypto.encrypt(firm,`accounts/${drive}/address`,"Local test drive"),await crypto.encrypt(firm,`accounts/${drive}/credentials`,"{}")]);
    await Promise.all(pack.map((sample,n)=>smtp.sendMail({from:email,to:office,messageId:`<triage-${run}-${n}@inboxca.test>`,subject:`${sample.subject} ${markers[n*2]}`,text:`${sample.text}\n${markers[n*2+1]}`,attachments:sample.attachments.map((filename)=>({filename,content:"Invented attachment"}))})));
    await smtp.sendMail({from:`unknown-${run}@invented.test`,to:office,messageId:`<triage-${run}-50@inboxca.test>`,subject:markers[100],text:markers[101]});
    const encrypted=vi.spyOn(crypto,"encrypt"),written=vi.spyOn(fs.promises,"writeFile"),synced=vi.spyOn(fs,"writeFileSync");
    const logs=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error"),vi.spyOn(process.stdout,"write")];
    expect(await mailPoll({entity_id:account} as Job,{markSending:async()=>{}})).toEqual({done:true});
    const rows=(await db.query("select provider_message_id,label from public.email_events where firm_id=$1",[firm])).rows;
    expect(rows).toHaveLength(50);
    correct=rows.filter((row)=>row.label===pack[Number(row.provider_message_id.match(/-(\d+)@/)[1])].label).length;
    expect(correct/50).toBeGreaterThanOrEqual(0.9);
    low=rows.filter((row)=>row.label==="other").length;
    expect((await db.query("select count(*)::int n from public.requests r join public.email_events e on e.id=r.entity_id where r.firm_id=$1 and r.kind='team_reply' and e.label='other'",[firm])).rows[0].n).toBe(low);
    // The jobs the poll queued open each email again in memory (filing, notices, records
    // replies); what they keep must hold no subject or body text either.
    const queued=(await db.query("select * from public.jobs where firm_id=$1 and state='pending' and kind<>'mail_poll' order by id",[firm])).rows as Job[];
    expect(new Set(queued.map((job)=>job.kind))).toEqual(new Set(["file_mail","notice_from_mail","records_reply","ai_draft"]));
    for (const job of queued) expect(await handlers[job.kind](job,{markSending:async()=>{}})).toEqual({done:true});
    expect((await db.query("select (select count(*)::int from public.documents where firm_id=$1) documents,(select count(*)::int from public.tasks where firm_id=$1 and kind='notice') notices",[firm])).rows[0]).toEqual({documents:22,notices:7});
    const files=(await readdir(dir,{recursive:true,withFileTypes:true})).filter((entry)=>entry.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(contains(file.name) || contains(await readFile(path.join(file.parentPath,file.name)))).toBe(false);
    expect(contains((await db.query("select to_jsonb(f) data from public.firms f where id=$1",[firm])).rows[0].data)).toBe(false);
    const tables=(await db.query("select table_name from information_schema.columns where table_schema='public' and column_name='firm_id'")).rows;
    for (const {table_name:name} of tables) {
      const quoted='"'+String(name).replaceAll('"','""')+'"';
      const data=(await db.query(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') data from public.${quoted} r where firm_id=$1`,[firm])).rows[0].data;
      expect(contains(data)).toBe(false);
    }
    expect(leaked).toBe(false);
    expect(encrypted.mock.calls.some((args)=>contains(args[2]))).toBe(false);
    expect([...written.mock.calls,...synced.mock.calls].some((args)=>contains(args[1]))).toBe(false);
    expect(logs.some((spy)=>spy.mock.calls.some((args)=>args.some(contains)))).toBe(false);
  } finally {
    smtp.close();vi.restoreAllMocks();vi.unstubAllEnvs();
    await db.query("begin");await db.query("select set_config('app.log_purge','on',true)");await db.query("delete from public.firms where id=$1",[firm]);await db.query("commit");await db.end();await rm(dir,{recursive:true,force:true});
  }
  console.info(`Triage: ${correct}/50 correct; ${low}/${low} unclear emails sent to the team; no subject or body markers saved.`);
},120_000);
