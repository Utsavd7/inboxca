// The firm's mailbox is a fake that keeps what it was asked to send; addresses "decrypt" to
// invented ones by their place.
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string; messageId?: string; inReplyTo?: string }[]);
vi.mock("@/src/lib/crypto", () => ({ serverCrypto: () => ({ decrypt: async (_firm: string, place: string) => `${place.split("/")[0]}-${place.split("/")[1]}@invented.test` }) }));
vi.mock("@/src/lib/firm-mail", () => ({
  firmMailer: async () => ({ waitUntil: null, sentAlready: async () => false, send: async (to: string, subject: string, text: string, messageId?: string, inReplyTo?: string) => { sent.push({ to, subject, text, messageId, inReplyTo }); return true; } }),
}));
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { localSupabase } from "../local-env";
import { answerMail } from "@/src/jobs/answer-mail";
import type { Job } from "@/src/jobs/runner";
import { connect } from "./db";
import type { Client } from "pg";

// Inbox, answered B and C: InboxCA's answers by rules, through the database. Each kind follows
// the firm's choice (Ask me first holds it, Auto waits for its Undo then sends, Off leaves it for
// the team); only confirmed records are used, only the client's own address or an allowed contact
// gets it, an email a person already answers gets nothing, and every answer that went is logged.
const local = localSupabase();
const firm = randomUUID(), client = randomUUID(), contact = randomUUID(), account = randomUUID();
const code = `TA${randomBytes(4).toString("hex").toUpperCase()}`;
let db: Client;
const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const run = (id: string) => answerMail({ entity_id: id } as Job, { markSending: async () => {} });
const email = async (label: string, delivery: object = {}, from: string | null = null) =>
  (await db.query("insert into public.email_events(firm_id,account_id,provider_message_id,sender_bidx,client_id,contact_id,received_at,label,decision_source,delivery) values ($1,$2,$3,'x',$4,$5,now(),$6,'rule',$7) returning id", [firm, account, `<answer-test-${randomUUID()}@invented.test>`, client, from, label, delivery])).rows[0].id as string;
const state = async (id: string) => (await db.query("select e.delivery, o.outcomes, r.reason_code from public.email_events e join public.email_outcomes o on o.id = e.id left join public.requests r on r.kind = 'team_reply' and r.entity_id = e.id where e.id = $1", [id])).rows[0];

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  vi.stubEnv("APP_BASE_URL", "https://app.invented.test");
  db = await connect();
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Answers Test Firm','24','active',$2)", [firm, { answers: { filed: "ask", due: "auto", papers: "off" } }]);
  await db.query("insert into public.clients(id,firm_id,name,kind,email_enc,email_bidx) values ($1,$2,'Invented Answers Client','business','sealed','x')", [client, firm]);
  await db.query("insert into public.contacts(id,firm_id,name_enc,email_enc,email_bidx) values ($1,$2,'sealed','sealed','y')", [contact, firm]);
  await db.query("insert into public.contact_clients(firm_id,contact_id,client_id,can_receive_documents) values ($1,$2,$3,false)", [firm, contact, client]);
  await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,status) values ($1,$2,'mail','imap','x','x','connected')", [account, firm]);
  // A GSTR-1 marked filed with its acknowledgement, and an invented return whose date a CA checked.
  await db.query("insert into public.compliance_types(code,name,frequency,due_rule,source_url,verified_on,approved_by) values ($1,'Invented checked return','monthly','{\"for\":\"pan\"}','https://example.test/notification',current_date,'test')", [code]);
  await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on,status,details) values ($1,$2,'GSTR1_M','2026-09',$3,'filed',$4),($1,$2,$5,'2026-10',$6,'upcoming','{}')", [firm, client, day(-10), { filed_on: day(-12), ack: "AA2409269999999" }, code, day(5)]);
});
afterAll(async () => {
  await db.query("begin");
  await db.query("select set_config('app.log_purge','on',true)");
  await db.query("delete from public.firms where id=$1", [firm]);
  await db.query("commit");
  await db.query("delete from public.compliance_types where code=$1", [code]);
  await db.end();
  vi.unstubAllEnvs();
});

it("holds an Ask me first answer for a person, built from the filed return and its acknowledgement", async () => {
  const id = await email("ask_filed", { asked: { form: "GST" } });
  expect((await state(id)).outcomes).toEqual(["unanswered"]);
  expect(await run(id)).toEqual({ done: true });
  expect(await state(id)).toMatchObject({ delivery: { ack: "held" }, outcomes: ["draft"], reason_code: null });
  expect(sent).toEqual([]);
  // A second run, as after a retry, changes nothing.
  expect(await run(id)).toEqual({ done: true });
  expect((await state(id)).delivery.ack).toBe("held");
});

it("waits 5 minutes for an Undo, then sends an Auto answer to the client's own address and logs it", async () => {
  const id = await email("ask_due");
  const first = await run(id);
  expect(first).toMatchObject({ retry: "undo_window" });
  const at = (first as { at: Date }).at.getTime();
  expect(at - Date.now()).toBeGreaterThan(4.9 * 60_000);
  expect(await state(id)).toMatchObject({ delivery: { ack: "queued", at: new Date(at).toISOString() }, outcomes: ["queued"] });
  expect(await run(id)).toEqual({ done: true });
  expect(sent.at(-1)).toMatchObject({ to: `clients-${client}@invented.test`, subject: "What is due", messageId: `<received-${id}@app.invented.test>` });
  expect(sent.at(-1)!.text).toContain(`- Invented checked return for Oct 2026: due on `);
  expect(await state(id)).toMatchObject({ delivery: { ack: "sent" }, outcomes: ["answered"] });
  expect((await db.query("select action, actor_id, details from public.activity_log where entity_id=$1", [id])).rows).toEqual([{ action: "email.answered", actor_id: null, details: { template: "due.en.1" } }]);
});

it("leaves the question in Needs reply when the kind is Off, or the sender may not receive papers, or the records do not answer it", async () => {
  const off = await email("ask_papers");
  expect(await run(off)).toEqual({ done: true });
  expect(await state(off)).toMatchObject({ outcomes: ["reply"], reason_code: "ask_papers" });
  const stranger = await email("ask_filed", {}, contact);
  expect(await run(stranger)).toEqual({ done: true });
  expect(await state(stranger)).toMatchObject({ outcomes: ["reply"], reason_code: "answer_not_allowed" });
  // October's GSTR-1 is asked for and is not filed: a person says so.
  await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-10',$3)", [firm, client, day(-1)]);
  const open = await email("ask_filed", { asked: { form: "GSTR1", period: "2026-10" } });
  expect(await run(open)).toEqual({ done: true });
  expect(await state(open)).toMatchObject({ outcomes: ["reply"], reason_code: "status_not_filed" });
  // A date nobody checked is never given to a client.
  await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR3B_M','2026-10',$3)", [firm, client, day(8)]);
  const unchecked = await email("ask_due");
  expect(await run(unchecked)).toEqual({ done: true });
  expect(await state(unchecked)).toMatchObject({ outcomes: ["reply"], reason_code: "due_unchecked" });
  expect(sent).toHaveLength(1);
});

it("sends a papers receipt by the firm's choice, never when a person answers the email, and a notice receipt without advice", async () => {
  const data = await email("data_gst");
  expect(await run(data)).toEqual({ done: true });
  // Nothing was saved from it, so there is nothing to say.
  expect((await state(data)).delivery).toEqual({});
  await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,status,drive_file_id,name,size,sha256,email_event_id) values ($1,$2,'gst','Purchase bills','2026-09','filed','x','Bills.pdf',1,'a',$3),($1,$2,'other','Document','','to_check','y','Scan.pdf',1,'b',$3)", [firm, client, data]);
  expect(await run(data)).toEqual({ done: true });
  expect(await state(data)).toMatchObject({ delivery: { ack: "held" }, outcomes: ["draft", "check", "filed"] });
  const asked = await email("data_gst");
  await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,period_key,status,drive_file_id,name,size,sha256,email_event_id) values ($1,$2,'gst','Sales bills','2026-09','filed','z','Sales.pdf',1,'c',$3)", [firm, client, asked]);
  await db.query("insert into public.requests(firm_id,kind,client_id,entity_type,entity_id,reason_code) values ($1,'team_reply',$2,'email',$3,'no_rule')", [firm, client, asked]);
  expect(await run(asked)).toEqual({ done: true });
  expect((await state(asked)).delivery).toEqual({});
  const notice = await email("notice_received");
  await db.query("update public.firms set settings = jsonb_set(settings, '{answers,notice}', '\"auto\"') where id = $1", [firm]);
  expect(await run(notice)).toMatchObject({ retry: "undo_window" });
  expect(await run(notice)).toEqual({ done: true });
  expect(sent.at(-1)).toMatchObject({ subject: "We received your notice", text: "Dear Invented Answers Client,\n\nWe received your notice. Your CA will look at it.\n\nAnswers Test Firm" });
  expect(await state(notice)).toMatchObject({ outcomes: ["answered"] });
});
