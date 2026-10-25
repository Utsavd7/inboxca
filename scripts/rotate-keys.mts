// Key rotation drill (PLAN.md M11): gives each firm a new encryption key, then proves that
// every encrypted value still opens, that blind indexes did not change, and that new values
// use the new key. Prints counts per table, never a value. Older values keep their own key
// until they are re-encrypted. Prints what it would do; `--yes` rotates. `--firm <id>`
// limits it to one firm. Run with `npx --yes tsx scripts/rotate-keys.mts [--yes] [--firm <id>]`.
// The outer key is the server's own (serverKek): LOCAL_KEK from .env.local, or AWS KMS when
// KMS_KEY_ID and KMS_CREDENTIALS are set in the shell, which may then name another database
// in DATABASE_URL (production keys never live in .env.local).
import { allOpened, checkValues, localEnv, pgKeyStore, printCounts } from "./encrypted-values.mts";

const url = process.env.KMS_KEY_ID && process.env.DATABASE_URL ? process.env.DATABASE_URL : localEnv();
const { default: pg } = await import("pg");
const { firmCrypto, serverKek } = await import("../src/lib/crypto.ts");
const db = new pg.Client({ connectionString: url });
await db.connect();
const kek = serverKek();
const only = process.argv.includes("--firm") ? [process.argv[process.argv.indexOf("--firm") + 1]] : undefined;

// Each firm's number of encryption keys, or null when its key set does not open with this outer key.
async function generations() {
  const { rows } = await db.query("select firm_id, wrapped_key from public.firm_keys where $1::uuid[] is null or firm_id = any($1)", [only ?? null]);
  const result = new Map<string, number | null>();
  for (const row of rows) {
    try {
      result.set(row.firm_id, (await kek.unwrap(Buffer.from(row.wrapped_key, "base64"), row.firm_id)).length / 32 - 1);
    } catch {
      result.set(row.firm_id, null);
    }
  }
  return result;
}
const summary = (keys: Map<string, number | null>) => {
  const tally = new Map<string, number>();
  for (const count of keys.values()) {
    const what = count === null ? "a key set that does not open" : `${count} key${count === 1 ? "" : "s"}`;
    tally.set(what, (tally.get(what) ?? 0) + 1);
  }
  return [...tally].map(([what, firms]) => `${firms} firms with ${what}`).join(", ") || "none";
};

const started = Date.now();
const before = await generations();
const firms = [...before].filter(([, count]) => count !== null).map(([firm]) => firm);
console.log(`Firm key sets: ${summary(before)}`);
const counts = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), only);
console.log("Before rotating:");
printCounts(counts);

if (!process.argv.includes("--yes")) {
  console.log(`Would add a new key to ${firms.length} firms, then check every value again. Nothing changed. Run again with --yes to rotate.`);
} else {
  const crypto = firmCrypto(kek, pgKeyStore(db, true));
  let rotated = 0;
  const failed: string[] = [];
  for (const firm of firms) {
    try {
      await crypto.rotate(firm);
      rotated++;
    } catch (error) {
      failed.push(`${firm}: ${(error as Error).message}`);
    }
  }
  const after = await generations();
  // A new value seals with the newest key: its second byte is that key's number.
  let newest = 0;
  for (const firm of firms) {
    const sealed = await crypto.encrypt(firm, "drill/rotation", "check");
    if (Buffer.from(sealed, "base64url")[1] === after.get(firm)! - 1 && (await crypto.decrypt(firm, "drill/rotation", sealed)) === "check") newest++;
  }
  const again = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), only);
  console.log(`Rotated ${rotated} of ${firms.length} firms. Firm key sets now: ${summary(after)}`);
  for (const line of failed) console.log(`  Not rotated: ${line}`);
  console.log(`New values use the new key in ${newest} of ${firms.length} firms.`);
  console.log("After rotating:");
  printCounts(again);
  // Other runs may add values meanwhile, so compare what fails, not totals.
  const same = Object.entries(counts).every(([name, count]) =>
    again[name].values - again[name].opened <= count.values - count.opened && again[name].indexes - again[name].matched <= count.indexes - count.matched);
  const passed = same && !failed.length && newest === firms.length;
  console.log(passed ? "Drill passed: everything that opened before still opens, and blind indexes are unchanged." : "Drill FAILED: see the counts above.");
  process.exitCode = passed ? 0 : 1;
}
if (!allOpened(counts)) console.log("Some values do not open with this server's keys (see the counts above); they were like this before the drill.");
console.log(`Took ${((Date.now() - started) / 1000).toFixed(1)} s.`);
await db.end();
