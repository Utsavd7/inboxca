// The firm's mailbox is read live by a fake that knows each email by its Message-ID, and the
// firm's mailer only records what it is asked to send.
const thread = vi.hoisted(() => new Map<string, { subject: string; text: string; from: string }>());
const sent = vi.hoisted(() => [] as string[]);
vi.mock("@/src/lib/mail-live", () => ({
  mailLive: async (_firm: string, _op: string, ask: { messageId: string }) => {
    const mail = thread.get(ask.messageId);
    return mail ? { messages: [{ box: "inbox", messageId: ask.messageId, from: mail.from, to: ["office@invented.test"], date: new Date().toISOString(), subject: mail.subject, snippet: "", inReplyTo: "", references: [], text: mail.text, attachments: [] }] } : { error: "unreachable" };
  },
}));
vi.mock("@/src/lib/firm-mail", () => ({ firmMailer: async () => ({ waitUntil: null, sentAlready: async () => false, send: async (to: string) => (sent.push(to), true) }) }));
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fakeOpenAi } from "../fake-openai";
import { localSupabase } from "../local-env";
import { aiDraft } from "@/src/jobs/ai-draft";
import type { Job } from "@/src/jobs/runner";
import { clientTools } from "@/src/lib/ai-reply";
import { serverCrypto } from "@/src/lib/crypto";
import { limitKey } from "@/src/lib/rate-limit";
import { supabaseAdmin } from "@/src/lib/supabase";
import { connect } from "./db";

// AI drafts for emails waiting in Needs reply (PLAN.md "Inbox, answered" G, 5.11), through the
// database, against a fake OpenAI: a draft is written only from the client's records, sealed
// with the firm's key, held for a person and never sent; it goes when the email is answered or
// 7 days old; the output checks throw away advice, invented figures, tax numbers and outside
// links; a paused AI, the firm's limit or a sender who may not see the records leave the email
// to the team with a reason; and one firm's tools never reach another firm's client.
const local = localSupabase();
const [firm, other, client, otherClient, contact, account, otherAccount] = Array.from({ length: 7 }, () => randomUUID());
const code = `TA${randomBytes(4).toString("hex").toUpperCase()}`;
const ack = `AA${Date.now()}`;
const clientAddress = `ai-${firm.slice(0, 8)}@invented.test`;
// An invented key made for this run; the fake takes only it.
const key = randomBytes(24).toString("base64url");
let db: Client;
let ai: Awaited<ReturnType<typeof fakeOpenAi>>;
const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const run = (request: string) => aiDraft({ entity_id: request } as Job, { markSending: async () => {} });
// A client email waiting for a person; the trigger queues its AI draft.
async function waiting(subject: string, text: string, from: string | null = null) {
  const messageId = `<ai-draft-${randomUUID()}@invented.test>`;
  thread.set(messageId, { subject, text, from: clientAddress });
  const [{ id: email }] = (await db.query("insert into public.email_events(firm_id,account_id,provider_message_id,sender_bidx,client_id,contact_id,received_at,label,reason_code) values ($1,$2,$3,'x',$4,$5,now(),'other','no_rule') returning id", [firm, account, messageId, client, from])).rows;
  const [{ id }] = (await db.query("insert into public.requests(firm_id,kind,client_id,entity_type,entity_id,reason_code) values ($1,'team_reply',$2,'email',$3,'no_rule') returning id", [firm, client, email])).rows;
  return { id: id as string, email: email as string };
}
const draftOf = async (request: string) => (await db.query("select status, draft_enc from public.requests where id = $1", [request])).rows[0] as { status: string; draft_enc: string | null };
const leftFor = async (email: string) => (await db.query("select details->>'reason' reason from public.activity_log where firm_id = $1 and action = 'email.ai_left' and entity_id = $2 order by at desc limit 1", [firm, email])).rows[0]?.reason;
const draft = (text: string) => JSON.stringify({ outcome: "draft", reply: text, papers: [] });

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  vi.stubEnv("APP_BASE_URL", "https://app.invented.test");
  vi.stubEnv("LOCAL_KEK", randomBytes(32).toString("base64"));
  vi.stubEnv("OPENAI_API_KEY", key);
  ai = await fakeOpenAi(key);
  vi.stubGlobal("fetch", ai.route);
  db = await connect();
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'AI Drafts Firm','24','active'),($2,'Other AI Firm','24','active')", [firm, other]);
  await db.query("insert into public.clients(id,firm_id,name,kind,email_enc,email_bidx) values ($1,$2,'Invented Drafts Client','business',$3,'x'),($4,$5,'Other Firm Client','business',null,'y')", [client, firm, await serverCrypto().encrypt(firm, `clients/${client}/email`, clientAddress), otherClient, other]);
  await db.query("insert into public.contacts(id,firm_id,name_enc,email_enc,email_bidx) values ($1,$2,'sealed','sealed','z')", [contact, firm]);
  await db.query("insert into public.contact_clients(firm_id,contact_id,client_id,can_receive_documents) values ($1,$2,$3,false)", [firm, contact, client]);
  await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc,status) values ($1,$2,'mail','imap','x','x','connected'),($3,$4,'mail','imap','x','x','connected')", [account, firm, otherAccount, other]);
  // The records: a GSTR-1 marked filed with its acknowledgement, and an invented return whose
  // due date a CA checked; the other firm's client has a filed return of its own.
  await db.query("insert into public.compliance_types(code,name,frequency,due_rule,source_url,verified_on,approved_by) values ($1,'Invented checked return','monthly','{\"for\":\"pan\"}','https://example.test/notification',current_date,'test')", [code]);
  await db.query("insert into public.tasks(firm_id,client_id,code,period_key,due_on,status,details) values ($1,$2,'GSTR1_M','2026-09',$3,'filed',$4),($1,$2,$5,'2026-10',$6,'upcoming','{}'),($7,$8,'GSTR1_M','2026-09',$3,'filed',$9)",
    [firm, client, day(-10), { filed_on: day(-12), ack }, code, day(5), other, otherClient, { filed_on: day(-12), ack: "OTHERFIRMACK" }]);
});
afterAll(async () => {
  await db.query("begin");
  await db.query("select set_config('app.log_purge','on',true)");
  await db.query("delete from public.firms where id = any($1)", [[firm, other]]);
  await db.query("commit");
  await db.query("delete from public.compliance_types where code=$1", [code]);
  await db.query("delete from private.rate_limits where key = $1", [limitKey("ai", firm)]);
  await db.end();
  await ai.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("writes a draft only from the client's records, seals it, holds it for a person and sends nothing; it goes when answered or 7 days old", async () => {
  const { id, email } = await waiting("Where things stand", "Sir, are my returns filed, and what is coming up next? The bank is asking.");
  expect((await db.query("select kind from public.jobs where idempotency_key = $1", [`ai_draft:${id}:${client}`])).rows).toEqual([{ kind: "ai_draft" }]);

  // With no AI key nothing is asked and nothing is kept.
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(await run(id)).toEqual({ done: true });
  vi.stubEnv("OPENAI_API_KEY", key);
  expect(ai.asked).toHaveLength(0);
  expect((await draftOf(id)).draft_enc).toBeNull();

  const text = `Dear Invented Drafts Client,\n\nYes, your GST return for September is filed, acknowledgement number ${ack}.\n\nRegards,\nAI Drafts Firm`;
  ai.replies.push(draft(text));
  expect(await run(id)).toEqual({ done: true });
  // The AI got the tools' results for this client only, and nothing is kept by the provider.
  const asked = ai.asked.at(-1)!;
  expect(asked).toMatchObject({ reason: "auto_draft", store: false });
  const input = JSON.parse(asked.input);
  expect(input.records.get_task_status).toEqual({ outcome: "found", lines: [expect.stringContaining(ack)] });
  expect(input.records.list_upcoming_deadlines).toEqual({ outcome: "found", lines: [expect.stringContaining("Invented checked return")] });
  expect(asked.input).not.toContain("OTHERFIRMACK");

  // Held, sealed with this firm's key, never sent.
  const held = await draftOf(id);
  expect(held.status).toBe("pending");
  expect(held.draft_enc).not.toContain("acknowledgement");
  expect(JSON.parse(await serverCrypto().decrypt(firm, `requests/${id}/draft`, held.draft_enc!))).toEqual({ text, papers: [] });
  await expect(serverCrypto().decrypt(other, `requests/${id}/draft`, held.draft_enc!)).rejects.toThrow();
  expect(sent).toEqual([]);
  expect((await db.query("select kind from public.jobs where firm_id = $1 and kind <> 'ai_draft'", [firm])).rows).toEqual([]);
  expect(await db.query("select action from public.activity_log where firm_id = $1 and entity_id = $2 and action like 'email.ai%'", [firm, email]).then(({ rows }) => rows)).toEqual([{ action: "email.ai_drafted" }]);
  // A second run, as after a retry, asks nothing more.
  expect(await run(id)).toEqual({ done: true });
  expect(ai.asked).toHaveLength(1);

  // Answered: the draft goes with the wait.
  await db.query("update public.requests set status = 'done' where id = $1", [id]);
  expect((await draftOf(id)).draft_enc).toBeNull();

  // An email 7 days old loses its draft; a newer one keeps it.
  const old = await waiting("Thanks", "Thank you for your help.");
  const fresh = await waiting("Thanks again", "Thank you once more.");
  for (const request of [old, fresh]) {
    ai.replies.push(draft("Dear Invented Drafts Client,\n\nThank you for your kind words. Our team will be in touch.\n\nRegards,\nAI Drafts Firm"));
    await run(request.id);
  }
  await db.query("update public.email_events set received_at = now() - interval '8 days' where id = $1", [old.email]);
  await db.query("select private.purge_ai_drafts()");
  expect((await draftOf(old.id)).draft_enc).toBeNull();
  expect((await draftOf(fresh.id)).draft_enc).not.toBeNull();
});

it("throws away a draft with advice, an invented figure, a tax number or an outside link, and leaves the email to the team with the reason", async () => {
  const { id, email } = await waiting("Question", "Should I invest in PPF? Also what do I owe?");
  const pan = ["ABCDE", "1234", "F"].join("");
  const cases: [string | null, string][] = [
    [draft("Dear Invented Drafts Client,\n\nWe recommend you claim a deduction under section 80C.\n\nRegards,\nAI Drafts Firm"), "advice"],
    [draft("Dear Invented Drafts Client,\n\nYour tax payable is Rs 12,500.\n\nRegards,\nAI Drafts Firm"), "figure"],
    [draft("Dear Invented Drafts Client,\n\nYou owe two lakh rupees.\n\nRegards,\nAI Drafts Firm"), "figure"],
    [draft(`Dear Invented Drafts Client,\n\nYour PAN ${pan} is on our records.\n\nRegards,\nAI Drafts Firm`), "identifier"],
    [draft("Dear Invented Drafts Client,\n\nPlease pay here: https://pay.invented.test/now\n\nRegards,\nAI Drafts Firm"), "link"],
    [JSON.stringify({ outcome: "handoff", reason: "fees" }), "fees"],
    // The provider fails or AI is paused for the firm (no answer): the team answers.
    [null, "paused"],
  ];
  for (const [answer, reason] of cases) {
    if (answer) ai.replies.push(answer);
    expect(await run(id)).toEqual({ done: true, reason });
    expect(await leftFor(email)).toBe(reason);
    expect((await draftOf(id)).draft_enc).toBeNull();
  }
  expect(sent).toEqual([]);
});

it("keeps to the firm's AI limit, and gives nothing to a sender who may not see the client's records", async () => {
  const asked = ai.asked.length;
  const contactMail = await waiting("Status", "Is it filed?", contact);
  expect(await run(contactMail.id)).toEqual({ done: true, reason: "not_allowed" });
  expect(await leftFor(contactMail.email)).toBe("not_allowed");

  await db.query("select public.rate_limit($1, 120, 3600) from generate_series(1, 120)", [limitKey("ai", firm)]);
  const busy = await waiting("Status", "Is it filed?");
  expect(await run(busy.id)).toEqual({ done: true, reason: "busy" });
  expect(ai.asked).toHaveLength(asked);
});

it("never lets one firm's tools reach another firm's client", async () => {
  const admin = supabaseAdmin();
  const reached = await clientTools(admin, firm, otherClient);
  expect(Object.values(reached).map((tool) => tool.outcome)).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);
  expect(JSON.stringify(reached)).not.toContain("OTHERFIRMACK");
  expect((await clientTools(admin, other, otherClient)).get_task_status).toEqual({ outcome: "found", lines: [expect.stringContaining("OTHERFIRMACK")] });
});
