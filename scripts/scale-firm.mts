// Fills one local scale firm with invented clients and 12 months of returns.
// Running it again replaces only this firm's data; with --remove it deletes the firm and its owner.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
const { default: pg } = await import("pg");
const { createClient } = await import("@supabase/supabase-js");
const { serverCrypto } = await import("../src/lib/crypto");

const OWNER = "scale-owner@inboxca.test";
const FIRM_NAME = "Scale Test Firm";
const CLIENTS = 10_000;
const BATCH = 500;
const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstin(state: string, pan: string) {
  const body = `${state}${pan}1Z`;
  let sum = 0;
  for (let at = 0; at < 14; at++) {
    const value = BASE36.indexOf(body[at]) * (at % 2 ? 2 : 1);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return body + BASE36[(36 - (sum % 36)) % 36];
}

const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

let [user] = (await db.query("select id from auth.users where email = $1", [OWNER])).rows;
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email: OWNER, email_confirm: true });
  if (error) throw error;
  user = data.user;
}
const memberships = (
  await db.query(
    "select m.firm_id, m.role, f.name from public.firm_members m join public.firms f on f.id = m.firm_id where m.user_id = $1",
    [user.id],
  )
).rows;
if (memberships.length > 1 || memberships.some((row) => row.name !== FIRM_NAME || row.role !== "owner")) {
  throw new Error(`${OWNER} belongs to another firm. Nothing was changed.`);
}
const sameName = (await db.query("select id from public.firms where name = $1", [FIRM_NAME])).rows;
if (sameName.some((row) => !memberships.some((membership) => membership.firm_id === row.id))) {
  throw new Error(`${FIRM_NAME} has another owner. Nothing was changed.`);
}

await db.query("begin");
try {
  await db.query("select set_config('app.log_purge', 'on', true)");
  if (memberships[0]) await db.query("delete from public.firms where id = $1", [memberships[0].firm_id]);
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  throw error;
}
if (process.argv.includes("--remove")) {
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw error;
  await db.end();
  console.log(`${FIRM_NAME} and ${OWNER} removed.`);
  process.exit(0);
}

const [{ id: firm }] = (
  await db.query("insert into public.firms (name, state_code, status) values ($1, '24', 'active') returning id", [FIRM_NAME])
).rows;
await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [firm, user.id]);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const totpSecret = Array.from(randomBytes(16), (byte) => alphabet[byte % alphabet.length]).join("");
await db.query("delete from auth.mfa_factors where user_id = $1", [user.id]);
await db.query(
  "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Scale test', 'totp', 'verified', $2, now(), now())",
  [user.id, totpSecret],
);
const crypto = serverCrypto();

for (let start = 0; start < CLIENTS; start += BATCH) {
  const clients = Array.from({ length: Math.min(BATCH, CLIENTS - start) }, (_, offset) => {
    const number = start + offset;
    return {
      id: randomUUID(),
      name: `Scale Client ${String(number + 1).padStart(5, "0")}`,
      kind: number % 5 === 0 ? "individual" : "business",
      number,
    };
  });
  await db.query(
    `insert into public.clients (id, firm_id, name, kind)
     select (row ->> 'id')::uuid, $1, row ->> 'name', row ->> 'kind'
     from jsonb_array_elements($2::jsonb) row`,
    [firm, JSON.stringify(clients)],
  );

  const registrations = [];
  for (const client of clients) {
    const pan = `TSTAA${String(client.number).padStart(4, "0")}A`;
    const values: [string, string, string[], string | null][] = [["pan", pan, ["ITR_NA"], null]];
    if (client.number % 10 < 4) values.push(["gstin", gstin("24", pan), ["GSTR1_M", "GSTR3B_M"], "24"]);
    else if (client.number % 10 < 7) values.push(["gstin", gstin("27", pan), ["GSTR1_Q", "GSTR3B_Q", "PMT06"], "27"]);
    if (client.number % 3 === 0) values.push(["tan", `AHMS${String(client.number).padStart(5, "0")}A`, ["TDS_PAY", "TDS_RET"], null]);
    for (const [kind, number, services, state] of values) {
      registrations.push({
        id: randomUUID(),
        client_id: client.id,
        kind,
        number_enc: await crypto.encrypt(firm, `clients/${client.id}/${kind}`, number),
        number_bidx: await crypto.blindIndex(firm, kind, number),
        state_code: state,
        services,
      });
    }
  }
  await db.query(
    `insert into public.client_registrations (id, firm_id, client_id, kind, number_enc, number_bidx, state_code, services)
     select (row ->> 'id')::uuid, $1, (row ->> 'client_id')::uuid, row ->> 'kind', row ->> 'number_enc',
       row ->> 'number_bidx', row ->> 'state_code', array(select jsonb_array_elements_text(row -> 'services'))
     from jsonb_array_elements($2::jsonb) row`,
    [firm, JSON.stringify(registrations)],
  );
  process.stdout.write(`\rInserted ${Math.min(start + BATCH, CLIENTS).toLocaleString("en-IN")} clients`);
}

process.stdout.write("\nPlanning returns...\n");
await db.query("select private.plan_tasks(id) from public.client_registrations where firm_id = $1 and cardinality(services) > 0", [firm]);
const [{ clients, registrations, tasks }] = (
  await db.query(
    `select
       (select count(*)::int from public.clients where firm_id = $1) clients,
       (select count(*)::int from public.client_registrations where firm_id = $1) registrations,
       (select count(*)::int from public.tasks where firm_id = $1 and kind = 'compliance') tasks`,
    [firm],
  )
).rows;
await db.end();
console.log(`${FIRM_NAME}: ${clients.toLocaleString("en-IN")} clients, ${registrations.toLocaleString("en-IN")} registrations, ${tasks.toLocaleString("en-IN")} returns.`);
