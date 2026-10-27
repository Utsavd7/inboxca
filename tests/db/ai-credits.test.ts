import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeOpenAi } from "../fake-openai";
import { connect } from "./db";

// AI credits (PLAN.md 5.18, D26, D29) against a fake OpenAI on this machine, with a key made for
// the run: every call reserved before it is made and settled to what the provider reported, the
// pauses at 90% and 100% with nothing called, top-ups and rollover, the runaway guards, and a
// cache that never answers one firm with another's. The app's own code runs through local
// Supabase; each firm is made here and removed.
const env = Object.fromEntries((existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const ready = !!env.SUPABASE_URL && !!env.SUPABASE_SECRET_KEY;
const key = randomBytes(24).toString("base64url");
Object.assign(process.env, { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY, OPENAI_API_KEY: key });
delete process.env.AI_AGENT_MODEL;
delete process.env.AI_GLOBAL_DAILY_CAP_USD;
delete process.env.SYSTEM_MAIL_URL;

const { askAi, aiCredits } = await import("@/src/lib/ai");
const { todayInIndia } = await import("@/src/lib/calendar");
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
// The 15th of the India month `months` ago.
const ago = (months: number) => `(date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '${months} months' + interval '14 days') at time zone 'Asia/Kolkata'`;
// The keys of the firm's jobs, without the firm.
const jobKeys = async (firm: string) => (await rows("select split_part(idempotency_key, ':' || $1::text, 1) job from public.jobs where firm_id = $1::uuid order by 1", [firm])).map((row) => row.job);
const adminAlerts = async () => ((await rows("select value from public.platform_settings where key = 'billing'"))[0]?.value.alerts ?? []) as { kind: string; ref: string }[];

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
  // The admins' alerts this run raised.
  await db.query("update public.platform_settings set value = jsonb_set(value, '{alerts}', coalesce((select jsonb_agg(a) from jsonb_array_elements(value -> 'alerts') a where a ->> 'kind' <> 'ai_global_cap' and not split_part(a ->> 'ref', ':', 1) = any($1)), '[]')) where key = 'billing'", [made]);
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
    expect(await aiCredits(firm)).toEqual({ available: monthly, used: first.credits + most, topups: [] });
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
    expect(await jobKeys(firm)).toEqual(["usage_alert:ai_80"]);

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
    expect(await aiCredits(firm)).toEqual({ available: monthly, used: monthly - 3, topups: [] });
    expect(await jobKeys(firm)).toEqual(["ai_topup", "usage_alert:ai_100", "usage_alert:ai_80"]);
  });

  it("spends the month's own credits, then what rolled over (one month's at most), then top-ups oldest first, each good for 12 months", async () => {
    const firm = await newFirm("rollover");
    await db.query("update public.firms set created_at = now() - interval '15 months' where id = $1", [firm]);
    await db.query(`insert into public.payments (firm_id, kind, amount_paise, status, created_at) values ($1, 'topup', 100, 'done', ${ago(13)}), ($1, 'topup', 100, 'done', ${ago(2)}), ($1, 'topup', 100, 'done', now()), ($1, 'topup', 100, 'failed', now())`, [firm]);
    // Two months ago: its own credits and as many rolled over (none used the month before), and
    // 100 more from the oldest top-up, which ended on the 15th of last month.
    await spend(firm, 2 * monthly + 100, ago(2));
    // Last month nothing rolled over, and 50 past its own came from the second top-up.
    await spend(firm, monthly + 50, `${ago(1)} + interval '1 day'`);
    // This month: 30 past its own, again from the second; the newest is untouched.
    await spend(firm, monthly + 30);
    const credits = (await aiCredits(firm))!;
    expect(credits).toMatchObject({ available: monthly + 30 + (block - 80) + block, used: monthly + 30 });
    expect(credits.topups.map((topup) => topup.left)).toEqual([block - 80, block]);
    expect(Date.parse(credits.topups[1].until) - Date.now()).toBeGreaterThan(364 * 86_400_000);
    // With nothing used last month, its own credits roll over: twice the allowance at most.
    await db.query(`delete from public.ai_ledger where firm_id = $1 and at > ${ago(2)}`, [firm]);
    expect(await aiCredits(firm)).toMatchObject({ available: 2 * monthly + 2 * block, used: 0 });
  });

  it("pauses automatic AI for the rest of the India day once a firm used more than 20% of its monthly credits today, and tells the owner and Orelu's admins", async () => {
    const firm = await newFirm("day");
    await spend(firm, Math.floor(0.2 * monthly) + 1);
    fake.answer("ok", 100, 50);
    const calls = fake.calls.length;
    expect(await askAi(firm, "auto_draft", "Draft.", "day automatic")).toBeNull();
    expect(fake.calls.length).toBe(calls);
    const today = todayInIndia();
    expect(await jobKeys(firm)).toContain("usage_alert:ai_day");
    expect(await adminAlerts()).toContainEqual(expect.objectContaining({ kind: "ai_day_cap", ref: `${firm}:${today}` }));
    // A person's own press still works within credits.
    expect(await askAi(firm, "email_draft", "Draft.", "day by hand")).toBe("ok");
  });

  it("pauses every firm's automatic AI once the day's settled cost across firms reaches AI_GLOBAL_DAILY_CAP_USD, and is off when unset", async () => {
    const firm = await newFirm("global");
    const [{ cost }] = await rows("select coalesce(sum(cost), 0)::float8 cost from public.ai_ledger where at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'");
    await db.query("insert into public.ai_ledger (firm_id, reason, credits, cost, hash) values ($1, 'auto_draft', 1, 1, $2)", [firm, randomUUID()]);
    process.env.AI_GLOBAL_DAILY_CAP_USD = String((cost + 0.5) / figures.usdInr);
    fake.answer("ok", 100, 50);
    const calls = fake.calls.length;
    expect(await askAi(firm, "auto_draft", "Draft.", "global automatic")).toBeNull();
    expect(fake.calls.length).toBe(calls);
    expect(await adminAlerts()).toContainEqual(expect.objectContaining({ kind: "ai_global_cap", ref: todayInIndia() }));
    expect(await askAi(firm, "email_draft", "Draft.", "global by hand")).toBe("ok");
    delete process.env.AI_GLOBAL_DAILY_CAP_USD;
    expect(await askAi(firm, "auto_draft", "Draft.", "global unset")).toBe("ok");
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
