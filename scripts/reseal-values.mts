// After a key rotation (PLAN.md 8.4, M11): every value a firm still holds under an older key
// is sealed again with the newest key that scripts/rotate-keys.mts added. A batch at a time, so
// a run that stops part way is finished by running it again. App servers keep a firm's keys
// for up to 5 minutes, so a value written in the 5 minutes after a rotation may still use the
// older key: run this after that, or run it again. Prints counts per table, never a value, and
// logs each firm's count (keys.resealed). Prints what it would do; `--yes` re-seals. `--firm
// <id>` limits it to one firm. Run with `npx --yes tsx scripts/reseal-values.mts [--yes]
// [--firm <id>]`, with the outer key rotate-keys used (LOCAL_KEK from .env.local, or KMS_KEY_ID,
// KMS_CREDENTIALS and DATABASE_URL set in the shell).
import { localEnv, newestKey, pgKeyStore, reseal, staleCounts } from "./encrypted-values.mts";

const url = process.env.KMS_KEY_ID && process.env.DATABASE_URL ? process.env.DATABASE_URL : localEnv();
const { default: pg } = await import("pg");
const { firmCrypto, serverKek } = await import("../src/lib/crypto.ts");
const db = new pg.Client({ connectionString: url });
await db.connect();
const crypto = firmCrypto(serverKek(), pgKeyStore(db));
const yes = process.argv.includes("--yes");
const only = process.argv.includes("--firm") ? [process.argv[process.argv.indexOf("--firm") + 1]] : null;

const started = Date.now();
const totals: Record<string, { older: number; sealed: number; left: number }> = {};
const add = (counts: Record<string, number>, field: "older" | "sealed" | "left") => {
  for (const [name, count] of Object.entries(counts)) (totals[name] ??= { older: 0, sealed: 0, left: 0 })[field] += count;
};
let firms = 0;
let closed = 0;
const { rows } = await db.query("select firm_id from public.firm_keys where $1::uuid[] is null or firm_id = any($1)", [only]);
for (const { firm_id: firm } of rows as { firm_id: string }[]) {
  let newest: number;
  try {
    newest = await newestKey(crypto, firm);
  } catch {
    closed++;
    continue;
  }
  // A firm with one key has nothing older.
  if (!newest) continue;
  firms++;
  add(await staleCounts(db, firm, newest), "older");
  if (!yes) continue;
  add(Object.fromEntries(Object.entries(await reseal(db, crypto, firm)).map(([name, count]) => [name, count.sealed])), "sealed");
  add(await staleCounts(db, firm, newest), "left");
}

const sum = (field: "older" | "sealed" | "left") => Object.values(totals).reduce((all, count) => all + count[field], 0);
console.log(`${firms} firms have more than one key.${closed ? ` ${closed} firms' key sets do not open with this server's outer key; left as they are.` : ""}`);
console.table(Object.fromEntries(Object.entries(totals).map(([name, count]) => [name, yes ? { "on an older key": count.older, "sealed again": count.sealed, "still older": count.left } : { "on an older key": count.older }])));
if (!yes) console.log(`Would seal ${sum("older")} values again with each firm's newest key. Nothing changed. Run again with --yes to re-seal.`);
else {
  console.log(`Sealed ${sum("sealed")} values again with each firm's newest key.`);
  if (sum("left")) console.log(`${sum("left")} values are still on an older key: they do not open with this server's keys, or changed while this ran. Run again to retry.`);
  process.exitCode = sum("left") ? 1 : 0;
}
console.log(`Took ${((Date.now() - started) / 1000).toFixed(1)} s.`);
await db.end();
