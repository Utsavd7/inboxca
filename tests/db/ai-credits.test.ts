import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeOpenAi } from "../fake-openai";
import { connect } from "./db";

// AI credits (PLAN.md 5.18, D26, D29) against a fake OpenAI on this machine, with a key made for
// the run: every call reserved before it is made and settled to what the provider reported, the
// pauses at 90% and 100% with nothing called, top-ups and rollover, and a cache that never answers
// one firm with another's. The app's own code runs through local Supabase; each firm is made here
// and removed.
const env = Object.fromEntries((existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const ready = !!env.SUPABASE_URL && !!env.SUPABASE_SECRET_KEY;
const key = randomBytes(24).toString("base64url");
Object.assign(process.env, { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY, OPENAI_API_KEY: key });
delete process.env.AI_AGENT_MODEL;
delete process.env.SYSTEM_MAIL_URL;

const { askAi, aiCredits } = await import("@/src/lib/ai");
type Reason = Parameters<typeof askAi>[1];
const fake = fakeOpenAi(key);
const run = randomUUID().slice(0, 8);
const made: string[] = [];
let db: Client;
let figures: { rupeesPerCredit: number; usdInr: number; prices: Record<string, [number, number]>; reasons: Record<string, { credits: number }> };
let monthly = 0, block = 0;
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const newFirm = async (tag: string) => {
  const [{ id }] = await rows("insert into public.firms (name, state_code, status) values ($1, '27', 'active') returning id", [`AI Credits ${tag} ${run}`]);
  made.push(id);
  return id as string;
};
const spend = (firm: string, credits: number, at = "now()") => db.query(`insert into public.ai_ledger (firm_id, reason, credits, hash, at) values ($1, 'reply_draft', $2, $3, ${at})`, [firm, credits, randomUUID()]);
// The middle of last month, India time.
const LAST_MONTH = "(date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '15 days') at time zone 'Asia/Kolkata'";

beforeAll(async () => {
  if (!ready) return;
  db = await connect();
  const [{ value }] = await rows("select value from public.platform_settings where key = 'plan_formula'");
  ({ ai: figures } = value);
  // A firm with no paid plan has the smallest plan's credits.
  monthly = value.plans[0].aiCredits;
  block = value.aiBlock.credits;
  await fake.listen();
  process.env.OPENAI_TEST_URL = fake.url;
});
afterAll(async () => {
  if (!ready) return;
  for (const id of made) {
    await db.query("delete from public.payments where firm_id = $1", [id]);
    await db.query("with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where id = $1 and exists (select 1 from gone)", [id]);
  }
  await db.end();
  await fake.close();
});

describe.skipIf(!ready)("AI credits", () => {
  it("reserves a reason's most before the call, settles to what the provider reported and never above it, and charges nothing for a failed call", async () => {
    const firm = await newFirm("settle");
    const most = figures.reasons.email_draft.credits;
    let during: unknown[] = [];
    fake.during(async () => { during = await rows("select credits, cost from public.ai_ledger where firm_id = $1", [firm]); });
    fake.answer('{"text": "Dear client"}', 1000, 500);
    expect(await askAi(firm, "email_draft", "Draft an email.", "subject one")).toBe('{"text": "Dear client"}');
    expect(during).toEqual([{ credits: most, cost: null }]);
    fake.during(null);
    // gpt-5-mini's dollar prices a million tokens, in rupees, at ₹ a credit, rounded up.
    const [input, output] = figures.prices["gpt-5-mini"];
    const cost = ((1000 * input + 500 * output) / 1e6) * figures.usdInr;
    const [first] = await rows("select credits, cost::float8 cost from public.ai_ledger where firm_id = $1", [firm]);
    expect(first.credits).toBe(Math.ceil(cost / figures.rupeesPerCredit));
    expect(first.credits).toBeLessThan(most);
    expect(first.cost).toBeCloseTo(cost, 10);

    fake.answer("long", 1000, 1_000_000);
    await askAi(firm, "email_draft", "Draft an email.", "subject two");
    fake.answer(null);
    expect(await askAi(firm, "email_draft", "Draft an email.", "subject three")).toBeNull();
    expect((await rows("select credits from public.ai_ledger where firm_id = $1 order by id", [firm])).map((row) => row.credits)).toEqual([first.credits, most]);
    // Made this month: no rollover.
    expect(await aiCredits(firm)).toEqual({ available: monthly, used: first.credits + most });
  });

  it("calls nothing without a reservation: a reason with no figures, or AI off", async () => {
    const firm = await newFirm("none");
    const before = fake.calls.length;
    fake.answer("no", 10, 10);
    expect(await askAi(firm, "no_such_reason" as Reason, "Draft.", "x")).toBeNull();
    process.env.OPENAI_API_KEY = "";
    expect(await askAi(firm, "email_draft", "Draft.", "x")).toBeNull();
    process.env.OPENAI_API_KEY = key;
    expect(fake.calls.length).toBe(before);
    expect(await rows("select 1 from public.ai_ledger where firm_id = $1", [firm])).toEqual([]);
  });

  it("tells the owner at 80%, pauses automatic work at 90% and all AI at 100% with nothing called, and starts auto top-up", async () => {
    const firm = await newFirm("pause");
    await spend(firm, Math.ceil(0.8 * monthly));
    fake.answer("ok", 1000, 500);
    expect(await askAi(firm, "reply_draft", "Reply.", "eighty")).toBe("ok");
    const alerts = async () => (await rows("select split_part(idempotency_key, ':' || $1::text, 1) job from public.jobs where firm_id = $1::uuid order by 1", [firm])).map((row) => row.job);
    expect(await alerts()).toEqual(["usage_alert:ai_80"]);

    // 90%: automatic work (share 0.9) is refused what one reason by hand (share 1) still gets.
    const { used } = (await aiCredits(firm))!;
    const want = Math.floor(0.9 * monthly - used) + 1;
    const reserve = (share: number) => rows("select ticket, available, used from public.ai_reserve($1, $2, $3, 'extract', $4, $5, 'h')", [firm, monthly, block, want, share]);
    expect(await reserve(0.9)).toEqual([{ ticket: null, available: monthly, used }]);
    expect((await reserve(1))[0].ticket).not.toBeNull();

    // 100%: three credits left, and a reply takes up to six.
    await spend(firm, monthly - used - want - 3);
    const calls = fake.calls.length;
    expect(await askAi(firm, "reply_draft", "Reply.", "hundred")).toBeNull();
    expect(fake.calls.length).toBe(calls);
    expect(await aiCredits(firm)).toEqual({ available: monthly, used: monthly - 3 });
    expect(await alerts()).toEqual(["ai_topup", "usage_alert:ai_100", "usage_alert:ai_80"]);
  });

  it("adds this month's top-ups and rolls last month's unused credits over, up to one month's", async () => {
    const firm = await newFirm("rollover");
    await db.query("update public.firms set created_at = now() - interval '70 days' where id = $1", [firm]);
    await db.query(`insert into public.payments (firm_id, kind, amount_paise, status, created_at) values ($1, 'topup', 100, 'done', ${LAST_MONTH}), ($1, 'topup', 100, 'done', now()), ($1, 'topup', 100, 'failed', now())`, [firm]);
    // Last month had its plan and one top-up, and used all but 1,000 of them.
    await spend(firm, monthly + block - 1000, LAST_MONTH);
    expect(await aiCredits(firm)).toEqual({ available: monthly + block + 1000, used: 0 });
    // Unused, it rolls over only one month's worth.
    await db.query("delete from public.ai_ledger where firm_id = $1", [firm]);
    expect(await aiCredits(firm)).toEqual({ available: 2 * monthly + block, used: 0 });
  });

  it("answers a question asked again from its own firm's cache at no credit, and never from another firm's", async () => {
    const [mine, theirs] = [await newFirm("cache one"), await newFirm("cache two")];
    fake.answer("the same answer", 200, 100);
    const calls = fake.calls.length;
    expect(await askAi(mine, "email_draft", "Draft.", "same question")).toBe("the same answer");
    expect(await askAi(mine, "email_draft", "Draft.", "same question")).toBe("the same answer");
    expect(fake.calls.length).toBe(calls + 1);
    fake.answer("their own answer", 200, 100);
    expect(await askAi(theirs, "email_draft", "Draft.", "same question")).toBe("their own answer");
    expect(fake.calls.length).toBe(calls + 2);
    const ledger = await rows("select firm_id, credits, hash from public.ai_ledger where firm_id = any($1) order by id", [[mine, theirs]]);
    expect(ledger.map((row) => [row.firm_id, row.credits > 0])).toEqual([[mine, true], [mine, false], [theirs, true]]);
    // The same text hashes apart in two firms.
    expect(ledger[0].hash).toBe(ledger[1].hash);
    expect(ledger[2].hash).not.toBe(ledger[0].hash);
  });
});
