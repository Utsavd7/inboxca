// The last step of a key rotation (PLAN.md 8.4, M11), after scripts/reseal-values.mts: each
// firm's keys older than its newest are wiped from its key set, so a copy of them taken later
// opens nothing. Only for a firm where nothing still needs one: no encrypted value on an older
// key, no 30-day safety copy taken before the newest key, and not within 5 minutes of the
// rotation; otherwise the firm is left as it is and what still needs one is named. The search
// key that blind indexes use and the newest key stay. Prints counts per table, never a value,
// then checks that every value that opened before still opens. Logs each firm's count
// (keys.retired). Prints what it would do; `--yes` retires. `--firm <id>` limits it to one
// firm. Run with `npx --yes tsx scripts/retire-keys.mts [--yes] [--firm <id>]`, with the outer
// key rotate-keys used (LOCAL_KEK from .env.local, or KMS_KEY_ID, KMS_CREDENTIALS and
// DATABASE_URL set in the shell).
import { checkValues, localEnv, pgKeyStore, printCounts, retireKeys } from "./encrypted-values.mts";

const url = process.env.KMS_KEY_ID && process.env.DATABASE_URL ? process.env.DATABASE_URL : localEnv();
const { default: pg } = await import("pg");
const { firmCrypto, serverKek } = await import("../src/lib/crypto.ts");
const db = new pg.Client({ connectionString: url });
await db.connect();
const kek = serverKek();
const yes = process.argv.includes("--yes");
const only = process.argv.includes("--firm") ? [process.argv[process.argv.indexOf("--firm") + 1]] : undefined;
const crypto = firmCrypto(kek, pgKeyStore(db, yes));

const started = Date.now();
const before = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), only);
let firms = 0;
let keys = 0;
let closed = 0;
const held: Record<string, number> = {};
const { rows } = await db.query("select firm_id from public.firm_keys where $1::uuid[] is null or firm_id = any($1)", [only ?? null]);
for (const { firm_id: firm } of rows as { firm_id: string }[]) {
  let result: Awaited<ReturnType<typeof retireKeys>>;
  try {
    result = await retireKeys(db, crypto, firm, !yes);
  } catch {
    closed++;
    continue;
  }
  for (const [name, count] of Object.entries(result.using)) held[name] = (held[name] ?? 0) + count;
  if (Object.keys(result.using).length) firms++;
  keys += result.keys;
}

console.log(`${keys} older keys ${yes ? "retired" : "can be retired"}.${closed ? ` ${closed} firms' key sets do not open with this server's outer key, or changed meanwhile; left as they are.` : ""}`);
if (firms) {
  console.log(`${firms} firms still need an older key, so theirs stay:`);
  console.table(Object.fromEntries(Object.entries(held).map(([name, count]) => [name, { "still need one": count }])));
  console.log("Run scripts/reseal-values.mts --yes, wait for the 5 minutes and for safety copies to pass their 30 days, then run this again.");
}
if (!yes) console.log("Nothing changed. Run again with --yes to retire them.");
else {
  const after = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), only);
  printCounts(after);
  // Other runs may add values meanwhile, so compare what fails, not totals.
  const same = Object.entries(before).every(([name, count]) =>
    after[name].values - after[name].opened <= count.values - count.opened && after[name].indexes - after[name].matched <= count.indexes - count.matched);
  console.log(same ? "Everything that opened before still opens, and blind indexes are unchanged." : "FAILED: some values no longer open; see the counts above.");
  process.exitCode = same && !closed && !firms ? 0 : 1;
}
console.log(`Took ${((Date.now() - started) / 1000).toFixed(1)} s.`);
await db.end();
