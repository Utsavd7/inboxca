// Makes a demo firm on local Supabase to sign in to and show the app, with invented data
// only. Its owner's 2 step key is written to .env.local (DEMO_OWNER_TOTP), never printed:
// add it to an authenticator app, or let `npm run demo:code` show the current code.
// Run after `npm run db:env`. Running it again keeps the same firm and key.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const env = Object.fromEntries(
  (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
export const DEMO_OWNER = "demo-owner@inboxca.test";

export function code(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

if (process.argv[2] === "code") {
  console.log(code(env.DEMO_OWNER_TOTP));
  process.exit(0);
}

if (!env.TEST_DB_URL) throw new Error("Run npm run db:env first.");
const db = new pg.Client({ connectionString: env.TEST_DB_URL });
await db.connect();
const key = env.DEMO_OWNER_TOTP ?? Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let [user] = (await db.query("select id from auth.users where email = $1", [DEMO_OWNER])).rows;
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email: DEMO_OWNER, email_confirm: true });
  if (error) throw error;
  user = data.user;
}
await db.query("delete from auth.mfa_factors where user_id = $1", [user.id]);
await db.query(
  "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Demo app', 'totp', 'verified', $2, now(), now())",
  [user.id, key],
);
if (!(await db.query("select 1 from public.firm_members where user_id = $1", [user.id])).rowCount) {
  const [{ id: firm }] = (await db.query("insert into public.firms (name, state_code, status) values ('Demo CA Firm', '24', 'active') returning id")).rows;
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [firm, user.id]);
}
await db.end();
if (!env.DEMO_OWNER_TOTP) writeFileSync(".env.local", readFileSync(".env.local", "utf8").replace(/\n?$/, "\n") + `DEMO_OWNER_TOTP=${key}\n`);
console.log(`Demo firm ready. Sign in as ${DEMO_OWNER}; the email code is in the local mail catcher, and npm run demo:code shows the 2 step code.`);
