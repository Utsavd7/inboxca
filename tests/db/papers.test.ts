// The firm's mailbox and the clients' mailboxes are this run's own on GreenMail, which makes one
// for every address it receives mail for, its password the address.
const office = vi.hoisted(() => `papers-office-${crypto.randomUUID()}@invented.test`);
vi.mock("@/src/lib/crypto", () => ({
  serverCrypto: () => ({
    encrypt: async (_firm: string, _place: string, text: string) => `sealed:${text}`,
    decrypt: async (_firm: string, place: string, value: string) => (place.endsWith("/credentials") ? JSON.stringify({ password: office }) : place.endsWith("/address") ? office : value.replace(/^sealed:/, "")),
  }),
}));
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { localSupabase } from "../local-env";
import { clientReplied, receiveAsked } from "@/src/lib/checklists";
import { todayInIndia } from "@/src/lib/calendar";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendReminders } from "@/src/jobs/reminders";
import { papersWorkItems } from "@/src/lib/work/papers";
import type { Job } from "@/src/jobs/runner";
import { actAs, asOwner, connect } from "./db";

// Papers from clients, end to end against the database (user, 26 Oct 2026): InboxCA asks for a
// return's papers itself, once a client, period and work, only for what is not in; after two
// follow ups with nothing back the people who look after the client are asked to call; a paper
// from the client starts the count again; every paper in tells them to check the figures.
const tag = randomUUID().slice(0, 6).toUpperCase();
const firm = randomUUID();
const people = { owner: randomUUID(), staff: randomUUID(), manager: randomUUID(), other: randomUUID() };
const team = randomUUID();
const codes = [`GSTR1T${tag}`, `GSTR3T${tag}`];
const mailbox = (name: string) => `papers-${name}-${tag.toLowerCase()}@invented.test`;
const client = { asked: randomUUID(), paused: randomUUID(), noEmail: randomUUID(), later: randomUUID(), manual: randomUUID(), tds: randomUUID() };
const today = todayInIndia();
let db: Client;
const run = () => sendReminders({ entity_id: firm, entity_type: "firm" } as Job, { markSending: async () => {} });
const asks = async (id: string) => (await db.query("select id, entity_type, status, details from public.requests where client_id = $1 and kind = 'documents' order by entity_type", [id])).rows;
const items = async (as: string) => {
  await db.query("begin");
  try {
    await actAs(db, as);
    return (await db.query("select kind, client_id from public.paper_items($1)", [firm])).rows;
  } finally {
    await db.query("rollback");
  }
};
async function mail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  await imap.connect();
  try {
    const texts: string[] = [];
    if ((await imap.mailboxOpen("INBOX")).exists) for await (const message of imap.fetch("1:*", { source: true })) texts.push((await simpleParser(message.source!)).text ?? "");
    return texts.filter((text) => !text.includes("Makes the test mailbox"));
  } finally {
    await imap.logout();
  }
}

beforeAll(async () => {
  db = await connect();
  const local = localSupabase();
  vi.stubEnv("SUPABASE_URL", local.url);
  vi.stubEnv("SUPABASE_SECRET_KEY", local.secretKey);
  vi.stubEnv("APP_BASE_URL", "http://inboxca.test");
  vi.stubEnv("REMINDERS_ANY_HOUR", "1");
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  for (const address of [office, mailbox("asked"), mailbox("tds")]) await smtp.sendMail({ from: "setup@invented.test", to: address, subject: "Invented test setup", text: "Makes the test mailbox" });
  await asOwner(db);
  for (const [role, id] of Object.entries(people)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `papers-${role}-${tag.toLowerCase()}@invented.test`]);
  await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Papers Test Firm', '24', 'active', '{\"reminders\": true}')", [firm]);
  await db.query("insert into public.groups (id, firm_id, kind, name) values ($1, $2, 'team', 'Invented team')", [team, firm]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status, team_id) values ($1, $2, 'owner', 'active', null), ($1, $3, 'staff', 'active', $5), ($1, $4, 'manager', 'active', $5), ($1, $6, 'staff', 'active', null)", [firm, people.owner, people.staff, people.manager, team, people.other]);
  await db.query("insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc, settings) values ($1, 'mail', 'imap', 'invented', 'invented', $2)", [firm, { imap: { host: "127.0.0.1", port: 3143 }, smtp: { host: "127.0.0.1", port: 3025 } }]);
  for (const [name, id] of Object.entries(client))
    await db.query("insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, reminders_paused) values ($1, $2, $3, 'business', $4, $5, $6)", [id, firm, `Invented ${name} Traders`, name === "noEmail" ? null : `sealed:${mailbox(name)}`, name === "noEmail" ? null : `index-${id}`, name === "paused"]);
  await db.query("insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm, client.asked, people.staff]);
  // Two invented GST returns a CA confirmed: the month's first due in 5 days, its second in 12.
  for (const code of codes)
    await db.query("insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, $2, 'monthly', '{\"for\": \"gstin\"}', 'https://example.test/notification', current_date, 'test')", [code, `Invented ${code}`]);
  for (const id of [client.asked, client.paused, client.noEmail, client.manual])
    await db.query("insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', $3, '2026-10', $4::date + 5), ($1, $2, 'compliance', $5, '2026-10', $4::date + 12)", [firm, id, codes[0], today, codes[1]]);
  await db.query("insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', $3, '2026-11', $4::date + 20)", [firm, client.later, codes[0], today]);
  // A TDS client's statement for Oct to Dec, due in 10 days, on a date the firm confirmed.
  await db.query("insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'TDS_RET', '2026-12', $3::date + 10)", [firm, client.tds, today]);
  await db.query("insert into public.firm_due_dates (firm_id, code, confirmed_by, source_url) values ($1, 'TDS_RET', $2, 'https://example.test/notification')", [firm, people.owner]);
  // The client already sent its sales bills for the month; another was asked by a person.
  await db.query("insert into public.documents (firm_id, client_id, work_type, document_type, period_key, status, drive_file_id, name, size, sha256) values ($1, $2, 'gst', 'Sales bills', '2026-10', 'filed', 'invented', 'Invented sales bills', 1, 'invented')", [firm, client.asked]);
  await db.query("insert into public.requests (firm_id, kind, client_id, entity_type, entity_id, expires_at, details) values ($1, 'documents', $2, 'checklist', gen_random_uuid(), now() + interval '20 days', $3)", [firm, client.manual, { period: "2026-10", items: [{ type: "Sales bills", work: "gst", received: [] }] }]);
});
afterAll(async () => {
  await asOwner(db);
  await db.query("begin");
  await db.query("select set_config('app.log_purge', 'on', true)");
  await db.query("delete from public.firms where id = $1", [firm]);
  await db.query("delete from auth.users where id = any($1)", [Object.values(people)]);
  await db.query("delete from public.compliance_types where code = any($1)", [codes]);
  await db.query("commit");
  await db.end();
  vi.unstubAllEnvs();
});

it("asks a client once for the month's papers still missing, in the day's one email, and nobody else", async () => {
  expect(await run()).toEqual({ done: true });
  const [ask] = await asks(client.asked);
  expect(ask).toMatchObject({ entity_type: "period", status: "pending" });
  expect(ask.details).toMatchObject({ period: "2026-10", returns: codes, since: today, items: [{ type: "Purchase bills", work: "gst", received: [] }, { type: "Bank statement", work: "gst", received: [] }] });
  expect(ask.details.followups ?? []).toEqual([]);
  const [sent] = await mail(mailbox("asked"));
  expect(sent).toContain(`To prepare your Invented ${codes[0]} and Invented ${codes[1]} for Oct 2026, please send these documents: Purchase bills, Bank statement.`);
  expect(sent).toContain("Please reply to this email with the files attached, or email them to us.");
  expect(sent).not.toMatch(/https?:\/\//);
  expect((await db.query("select details from public.activity_log where entity_id = $1 and action = 'request.created'", [ask.id])).rows).toEqual([{ details: { auto: true } }]);
  // Paused, without an email, not yet in its 10 days, or already asked by a person: no request.
  for (const id of [client.paused, client.noEmail, client.later]) expect(await asks(id)).toEqual([]);
  expect((await asks(client.manual)).map((row) => row.entity_type)).toEqual(["checklist"]);
  // A second run the same day opens nothing new and sends nothing more.
  expect(await run()).toEqual({ done: true });
  expect(await asks(client.asked)).toHaveLength(1);
  expect(await mail(mailbox("asked"))).toHaveLength(1);
});

it("asks whoever looks after the client to call after two follow ups, until a call or a paper from the client", async () => {
  const [ask] = await asks(client.asked);
  const followed = { ...ask.details, followups: ["2026-01-05", "2026-01-08"] };
  await db.query("update public.requests set details = $2 where id = $1", [ask.id, followed]);
  const call = [{ kind: "call", client_id: client.asked }];
  expect(await items(people.staff)).toEqual(call);
  expect(await items(people.manager)).toEqual(call);
  expect(await items(people.owner)).toEqual(call);
  expect(await items(people.other)).toEqual([]);
  // Asked by phone after the last follow up: off the list until another goes unanswered.
  await db.query("update public.requests set details = $2 where id = $1", [ask.id, { ...followed, chased: "2026-01-09" }]);
  expect(await items(people.staff)).toEqual([]);
  await db.query("update public.requests set details = $2 where id = $1", [ask.id, { ...followed, chased: "2026-01-09", followups: [...followed.followups, "2026-01-12"] }]);
  expect(await items(people.staff)).toEqual(call);
  // A paper from the client counts as an answer: the follow ups count again from today.
  await clientReplied(supabaseAdmin(), client.asked);
  const [{ details }] = await asks(client.asked);
  expect([details.followups, details.since]).toEqual([[], today]);
  expect(await items(people.staff)).toEqual([]);
});

it("tells them to check the figures once every paper is in, and not after a paper is asked for again", async () => {
  const [ask] = await asks(client.asked);
  await receiveAsked(supabaseAdmin(), client.asked, "Purchase bills", "2026-10", randomUUID());
  expect((await asks(client.asked))[0].status).toBe("pending");
  await receiveAsked(supabaseAdmin(), client.asked, "Bank statement", "2026-10", randomUUID());
  expect((await asks(client.asked))[0].status).toBe("done");
  expect(await items(people.staff)).toEqual([{ kind: "papers_in", client_id: client.asked }]);
  expect(await items(people.other)).toEqual([]);
  await db.query("update public.requests set status = 'pending' where id = $1", [ask.id]);
  expect(await items(people.staff)).toEqual([]);
});

it("asks a TDS client for the quarter's TDS papers before its TDS return, lists them as missing close to the due date, and tells them to prepare the statement once in", async () => {
  const [ask] = await asks(client.tds);
  expect(ask.details).toMatchObject({ period: "2026-12", returns: ["TDS_RET"], items: ["TDS register", "Salary register", "TDS challans"].map((type) => ({ type, work: "tds", received: [] })) });
  const [sent] = await mail(mailbox("tds"));
  expect(sent).toContain("for Oct to Dec 2026, please send these documents: TDS register (payments and the tax deducted on them), Salary register (if tax was deducted from salaries), TDS challans (the tax deposited).");
  // Missing 10 days before the due date: a card for a firm that pins returns 10 days ahead, none at
  // the usual 5, and none for another firm.
  const cards = (firmId: string, days?: number) => papersWorkItems({ supabase: supabaseAdmin(), membership: { firmId, settings: { pin_days: days } }, userId: people.owner }).then((list) => list.map((item) => [item.key, item.title]));
  expect(await cards(firm, 10)).toEqual([[`tds_missing:${ask.id}`, "TDS Q3"]]);
  expect(await cards(firm)).toEqual([]);
  expect(await cards(randomUUID(), 10)).toEqual([]);
  for (const type of ["TDS challans", "TDS register", "Salary register"]) await receiveAsked(supabaseAdmin(), client.tds, type, "2026-12", randomUUID());
  expect((await asks(client.tds))[0].status).toBe("done");
  expect(await items(people.owner)).toContainEqual({ kind: "papers_in", client_id: client.tds });
  expect(await cards(firm, 10)).toEqual([]);
});
