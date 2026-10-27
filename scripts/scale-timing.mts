// Times the local scale firm's page queries as its owner.
import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
const { default: pg } = await import("pg");
const { createClient } = await import("@supabase/supabase-js");
const { calendarViews, todayInIndia } = await import("../src/lib/calendar");

const OWNER = "scale-owner@inboxca.test";
const RUNS = 5;
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: OWNER });
if (linkError) throw linkError;
const { data: session, error: signInError } = await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
if (signInError || !session.user || !session.session) throw signInError ?? new Error("Scale owner sign in failed.");

const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();
const [factor] = (await db.query("select id, secret from auth.mfa_factors where user_id = $1 and status = 'verified'", [session.user.id])).rows;
if (!factor) throw new Error("Run scripts/scale-firm.mts first.");
const totp = (secret: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};
const { error: factorError } = await auth.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.secret) });
if (factorError) throw factorError;
const verified = (await auth.auth.getSession()).data.session;
if (!verified) throw new Error("Scale owner 2 step sign in failed.");
const owner = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  accessToken: async () => verified.access_token,
  auth: { persistSession: false, autoRefreshToken: false },
});
const [membership] = (
  await db.query(
    "select m.firm_id from public.firm_members m join public.firms f on f.id = m.firm_id where m.user_id = $1 and m.role = 'owner' and f.name = 'Scale Test Firm'",
    [session.user.id],
  )
).rows;
if (!membership) throw new Error("Run scripts/scale-firm.mts first.");
const { count: clientCount, error: countError } = await owner
  .from("clients")
  .select("id", { count: "exact", head: true })
  .eq("firm_id", membership.firm_id);
if (countError) throw countError;
if (clientCount !== 10_000) throw new Error(`Expected 10,000 scale clients, found ${clientCount ?? 0}.`);

const today = todayInIndia();
const window = calendarViews.month.window(today);
const shift = (days: number) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
const cards = () =>
  owner
    .from("tasks")
    .select("id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)", { count: "exact" })
    .eq("kind", "compliance")
    .is("clients.archived_at", null)
    .order("due_on")
    .limit(4);

const checks: [string, () => PromiseLike<{ error: unknown; data?: unknown } | unknown>][] = [
  ["Home task cards", () => Promise.all([
    cards().neq("status", "filed").lt("due_on", today),
    cards().eq("status", "upcoming").gte("due_on", today).lte("due_on", shift(7)),
    cards().eq("status", "in_progress"),
    cards().eq("status", "filed").gte("details->>filed_on", shift(-7)),
  ])],
  ["Calendar default view", () => owner
    .from("tasks")
    .select("id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)")
    .eq("kind", "compliance")
    .is("clients.archived_at", null)
    .order("due_on")
    .limit(500)
    .neq("status", "filed")
    .lte("due_on", window.to)
    .gte("due_on", window.from)],
  ["Clients list", () => owner
    .from("clients")
    .select("id, name, kind, group_id, branch_id")
    .eq("firm_id", membership.firm_id)
    .order("name")
    .limit(500)
    .is("archived_at", null)],
  ["firm_usage", () => owner.rpc("firm_usage", { target_firm: membership.firm_id })],
  ["Client search by name", () => owner
    .from("clients")
    .select("id, name, kind, group_id, branch_id")
    .eq("firm_id", membership.firm_id)
    .order("name")
    .limit(500)
    .is("archived_at", null)
    .ilike("name", "%Scale Client 05000%")],
];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log("Query timings, 5 runs each");
console.log("Query | Runs ms | Median ms");
for (const [name, run] of checks) {
  const times = [];
  for (let attempt = 0; attempt < RUNS; attempt++) {
    const started = performance.now();
    const result = await run();
    times.push(performance.now() - started);
    const errors = Array.isArray(result) ? result.map((item) => item.error).filter(Boolean) : "error" in (result as object) ? [(result as { error: unknown }).error].filter(Boolean) : [];
    if (errors.length) throw errors[0];
  }
  console.log(`${name} | ${times.map((value) => value.toFixed(1)).join(", ")} | ${median(times).toFixed(1)}`);
}

// Every signed in page, through the running app (npm run build, then next start), with the
// owner's session in the same cookies the app sets.
const { createServerClient } = await import("@supabase/ssr");
const jar = new Map<string, string>();
const ssr = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
  },
});
const { error: cookieError } = await ssr.auth.setSession(verified);
if (cookieError) throw cookieError;
const [client] = (await db.query("select id from public.clients where firm_id = $1 and name = 'Scale Client 05000'", [membership.firm_id])).rows;
const site = `http://localhost:${process.env.PORT ?? 3000}`;
const pages = [
  ["Home", "/app"], ["Clients", "/app/clients"], ["A client", `/app/clients/${client.id}`], ["Inbox", "/app/inbox"],
  ["Calendar", "/app/calendar"], ["Notices", "/app/notices"], ["People", "/app/people"], ["Settings", "/app/settings"],
];
console.log(`\nPage timings at ${site}, ${RUNS} runs each after one warm up`);
console.log("Page | Runs ms | Median ms");
for (const [name, path] of pages) {
  const times = [];
  for (let attempt = 0; attempt <= RUNS; attempt++) {
    const started = performance.now();
    const response = await fetch(site + path, { headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") }, redirect: "manual" });
    await response.text();
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    if (attempt) times.push(performance.now() - started);
  }
  console.log(`${name} | ${times.map((value) => value.toFixed(1)).join(", ")} | ${median(times).toFixed(1)}`);
}

await db.query("begin");
await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: session.user.id, role: "authenticated", aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] })]);
await db.query("select set_config('request.jwt.claim.sub', $1, true)", [session.user.id]);
await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
await db.query("set local role authenticated");
const explain = async (title: string, sql: string, values: unknown[]) => {
  const result = await db.query(`explain (analyze, buffers) ${sql}`, values);
  console.log(`\n${title}`);
  for (const row of result.rows) console.log(row["QUERY PLAN"]);
};
await explain(
  "EXPLAIN Calendar default view",
  `select t.id, t.client_id, t.code, t.period_key, t.due_on, t.status, t.details, c.name, c.archived_at
   from public.tasks t join public.clients c on c.id = t.client_id and c.firm_id = t.firm_id
   where t.kind = 'compliance' and c.archived_at is null and t.status <> 'filed'
     and t.due_on <= $1::date and t.due_on >= $2::date
   order by t.due_on limit 500`,
  [window.to, window.from],
);
await db.query("commit");
await db.end();
