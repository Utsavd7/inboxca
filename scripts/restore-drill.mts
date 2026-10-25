// Restore drill (PLAN.md 8, Backups and recovery; M11): exports the local database with the
// local Supabase container's pg_dump, encrypts the export with BACKUP_KEY (32 random bytes,
// base64, from the environment; never written down), checks the export opens, restores it
// into a new scratch database, checks every table has the same rows and every encrypted
// value opens to the same text, times each step, then drops the scratch database and
// deletes the export. Counts only; no value is printed. Prints the plan; `--yes` runs it.
// Run with `BACKUP_KEY=$(openssl rand -base64 32) npx --yes tsx scripts/restore-drill.mts [--yes]`.
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, createReadStream, createWriteStream, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkValues, localEnv, pgKeyStore, printCounts } from "./encrypted-values.mts";

const url = localEnv();
const { default: pg } = await import("pg");
const { firmCrypto, localKek } = await import("../src/lib/crypto.ts");
const key = Buffer.from(process.env.BACKUP_KEY ?? "", "base64");
const container = `supabase_db_${readFileSync("supabase/config.toml", "utf8").match(/^project_id = "(.+)"$/m)![1]}`;
const scratch = `restore_drill_${Date.now()}`;
const scratchUrl = Object.assign(new URL(url), { pathname: `/${scratch}` }).toString();
// The app's own schemas, the sign in accounts, and the migration history. pg_cron's
// schedules live in the cron schema of the main database only; migrations make them again.
const SCHEMAS = ["public", "private", "auth", "supabase_migrations"];
const kek = localKek(Buffer.from(process.env.LOCAL_KEK!, "base64"));
const db = new pg.Client({ connectionString: url });
await db.connect();

// A command inside the database container, with its errors kept for the report.
function inContainer(args: string[]) {
  const child = spawn("docker", ["exec", "-i", container, ...args]);
  let errors = "";
  child.stderr.on("data", (data) => (errors += data));
  const done = new Promise<{ code: number; errors: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, errors }));
  });
  return { child, done };
}

// The export file is: nonce, the dump sealed with AES-256-GCM, tag.
function openExport(file: string) {
  const size = statSync(file).size;
  const nonce = Buffer.alloc(12);
  const tag = Buffer.alloc(16);
  const fd = openSync(file, "r");
  readSync(fd, nonce, 0, 12, 0);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  return [createReadStream(file, { start: 12, end: size - 17 }), createDecipheriv("aes-256-gcm", key, nonce).setAuthTag(tag)] as const;
}

async function rowCounts(client: InstanceType<typeof pg.Client>) {
  const { rows } = await client.query("select table_schema||'.'||table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema = any($1) order by 1", [SCHEMAS]);
  const counts = new Map<string, number>();
  for (const { name } of rows) counts.set(name, Number((await client.query(`select count(*) from ${name.split(".").map((part: string) => `"${part}"`).join(".")}`)).rows[0].count));
  return counts;
}

const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`;
const size = (await db.query("select pg_size_pretty(pg_database_size(current_database())) as size")).rows[0].size;

if (!process.argv.includes("--yes")) {
  console.log(`Restore drill plan (database ${size}, container ${container}):
  1. Take a snapshot of the local database and export it with pg_dump, schemas ${SCHEMAS.join(", ")}.
  2. Encrypt the export with BACKUP_KEY into a private temporary folder${key.length === 32 ? "" : " (BACKUP_KEY is not set: set it to 32 random bytes, base64, before --yes)"}.
  3. Check the whole export opens with the key before restoring anything.
  4. Restore it into a new scratch database, ${scratch}.
  5. Compare row counts of every table, and open every encrypted value in both copies with each copy's own firm keys.
  6. Drop the scratch database and delete the export.
Nothing run. Run again with --yes to run the drill.`);
  await db.end();
  process.exit(0);
}
if (key.length !== 32) throw new Error("Set BACKUP_KEY to 32 random bytes, base64 (openssl rand -base64 32)");

const folder = mkdtempSync(join(tmpdir(), "restore-drill-"));
const file = join(folder, "export.enc");
const started = Date.now();
const copy = new pg.Client({ connectionString: scratchUrl });
let made = false;
let passed = false;
try {
  // 1 and 2. One snapshot for the export and for the counts it is compared with.
  await db.query("begin isolation level repeatable read read only");
  const { snapshot } = (await db.query("select pg_export_snapshot() as snapshot")).rows[0];
  let step = Date.now();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const out = createWriteStream(file, { mode: 0o600 });
  out.write(nonce);
  const dump = inContainer(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "-Fc", `--snapshot=${snapshot}`, ...SCHEMAS.flatMap((schema) => ["-n", schema])]);
  dump.child.stdin.end();
  await pipeline(dump.child.stdout, cipher, out);
  appendFileSync(file, cipher.getAuthTag());
  const dumped = await dump.done;
  if (dumped.code) throw new Error(`pg_dump failed: ${dumped.errors}`);
  console.log(`Exported and encrypted ${(statSync(file).size / 1048576).toFixed(1)} MB in ${seconds(step)}.`);
  const sourceRows = await rowCounts(db);
  const sourceValues = await checkValues(db, firmCrypto(kek, pgKeyStore(db)));
  await db.query("commit");

  // 3. A wrong key or a changed byte fails here, before anything is restored.
  step = Date.now();
  await pipeline(...openExport(file), new Writable({ write: (_chunk, _encoding, next) => next() }));
  console.log(`Checked the export opens in ${seconds(step)}.`);

  // 4.
  step = Date.now();
  await db.query(`create database ${scratch}`);
  made = true;
  const restore = inContainer(["pg_restore", "-U", "supabase_admin", "--clean", "--if-exists", "-d", scratch]);
  await pipeline(...openExport(file), restore.child.stdin);
  const restored = await restore.done;
  const errors = restored.errors.split("\n").filter((line) => line.startsWith("pg_restore: error:"));
  console.log(`Restored into ${scratch} in ${seconds(step)}${errors.length ? `, with ${errors.length} errors:\n  ${errors.join("\n  ")}` : ""}.`);
  console.log(`Time to a usable copy: ${seconds(started)}.`);

  // 5.
  step = Date.now();
  await copy.connect();
  const copyRows = await rowCounts(copy);
  const differ = [...new Set([...sourceRows.keys(), ...copyRows.keys()])].filter((name) => sourceRows.get(name) !== copyRows.get(name));
  const total = [...sourceRows.values()].reduce((sum, count) => sum + count, 0);
  console.log(`Row counts: ${sourceRows.size} tables, ${total} rows; ${differ.length ? `differ in ${differ.map((name) => `${name} (${sourceRows.get(name) ?? "missing"} vs ${copyRows.get(name) ?? "missing"})`).join(", ")}` : "every table matches"}.`);
  const copyValues = await checkValues(copy, firmCrypto(kek, pgKeyStore(copy)));
  console.log("Encrypted values in the restored copy, opened with its own firm keys:");
  printCounts(copyValues);
  const mismatched = Object.keys(sourceValues).filter((name) =>
    copyValues[name].values !== sourceValues[name].values || copyValues[name].opened !== copyValues[name].values || copyValues[name].digest !== sourceValues[name].digest);
  console.log(mismatched.length ? `Values differ from the source in: ${mismatched.join(", ")}.` : "Every encrypted value opens to the same text as in the source.");
  console.log(`Checked in ${seconds(step)}.`);
  passed = !errors.length && !differ.length && !mismatched.length;
} finally {
  // 6.
  await copy.end().catch(() => undefined);
  if (made) await db.query(`drop database if exists ${scratch} with (force)`);
  rmSync(folder, { recursive: true, force: true });
  await db.end();
}
console.log(`${passed ? "Drill passed" : "Drill FAILED"}. Dropped ${scratch} and deleted the export. Total ${seconds(started)}.`);
process.exitCode = passed ? 0 : 1;
