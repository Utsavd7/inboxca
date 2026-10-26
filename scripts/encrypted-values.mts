// Shared by the key rotation and restore drills (PLAN.md M11) and the re-seal after a rotation:
// every encrypted value the app stores, and a check that each one still opens. Counts only; no
// value is ever printed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ClientBase } from "pg";
import type { firmCrypto, KeyStore } from "../src/lib/crypto.ts";

// Reads .env.local into the environment, and refuses anything but the local database.
export function localEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
  }
  if (!/@(127\.0\.0\.1|localhost):/.test(process.env.TEST_DB_URL ?? "")) throw new Error("Only for the local database");
  if (!process.env.LOCAL_KEK) throw new Error("LOCAL_KEK is not set; run npm run db:env");
  return process.env.TEST_DB_URL!;
}

// Each place a value is encrypted for, as the code that encrypts it builds it, with the blind
// index stored beside it, if any. Rows are: firm, place, value, index field, index.
export const ENCRYPTED: Record<string, string> = {
  "client_registrations.number": "select firm_id, 'clients/'||client_id||'/'||kind, number_enc, kind, number_bidx from public.client_registrations",
  "clients.email": "select firm_id, 'clients/'||id||'/email', email_enc, 'email', email_bidx from public.clients where email_enc is not null",
  "clients.sales_mapping": "select firm_id, 'clients/'||id||'/sales_mapping', sales_mapping_enc, null, null from public.clients where sales_mapping_enc is not null",
  "connected_accounts.address": "select firm_id, 'accounts/'||id||'/address', address_enc, 'email', address_bidx from public.connected_accounts",
  "connected_accounts.credentials": "select firm_id, 'accounts/'||id||'/credentials', credentials_enc, null, null from public.connected_accounts",
  "contacts.name": "select firm_id, 'contacts/'||id||'/name', name_enc, null, null from public.contacts",
  "contacts.email": "select firm_id, 'contacts/'||id||'/email', email_enc, 'email', email_bidx from public.contacts",
  "documents.original_name": "select firm_id, 'documents/'||id||'/original_name', original_name_enc, null, null from public.documents where original_name_enc is not null",
  "documents.password": "select firm_id, 'documents/'||id||'/password', password_enc, null, null from public.documents where password_enc is not null",
  "requests.link": "select firm_id, 'requests/'||id||'/link', details->>'link_enc', null, null from public.requests where details ? 'link_enc'",
  "shares.link": "select firm_id, 'shares/'||id||'/link', delivery->>'link_enc', null, null from public.shares where delivery ? 'link_enc'",
  "datasets.lines": "select d.firm_id, 'datasets/'||d.id||'/lines/'||(l->>'id'), l->>'value_enc', null, null from public.datasets d, jsonb_array_elements(d.data->'lines') l",
  "datasets.edits": `select d.firm_id, 'datasets/'||d.id||'/lines/'||l.key||'/edit/'||p.key, l.value->>'value_enc', null, null
    from public.datasets d, jsonb_each(coalesce(d.data->'edits', '{}')) p, jsonb_each(p.value) l`,
  "activity_log.rejection": "select firm_id, 'documents/'||entity_id||'/rejection', details->>'text_enc', null, null from public.activity_log where action = 'form.rejected' and details ? 'text_enc'",
  "activity_log.figure_change": `select firm_id, 'datasets/'||(details->>'dataset')||'/lines/'||(details->>'line')||v.suffix, v.value, null, null
    from public.activity_log, lateral (values ('', details->>'before'), ('', details->>'after'),
      ('/reason/'||((details->>'revision')::int - 1), details->>'reason_enc')) v(suffix, value)
    where action = 'dataset.changed' and v.value is not null`,
};

// Where each of those values is kept, to put it back sealed with the firm's newest key: the row
// named by the id in its place, and only while it still holds the old value, so a change made
// meanwhile is kept. In a jsonb column the value is swapped wherever it appears, so a copy of
// it (an unfinished correction's base) stays equal. $1 firm, $2 old values, $3 new, $4 places.
const ids = "(select split_part(p, '/', 2)::uuid from unnest($4::text[]) p)";
const column = (table: string, name: string, id = "id") =>
  `update public.${table} x set ${name} = m.sealed from unnest($2::text[], $3::text[], $4::text[]) m(was, sealed, place)
    where x.firm_id = $1 and x.${id} = split_part(m.place, '/', 2)::uuid and x.${name} = m.was`;
const json = (table: string, name: string, rows = `x.id in ${ids}`) =>
  `update public.${table} x set ${name} = private.swap_sealed(x.${name}, $2, $3) where x.firm_id = $1 and ${rows}`;
export const STORED: Record<string, string> = {
  "client_registrations.number": column("client_registrations", "number_enc", "client_id"),
  "clients.email": column("clients", "email_enc"),
  "clients.sales_mapping": column("clients", "sales_mapping_enc"),
  "connected_accounts.address": column("connected_accounts", "address_enc"),
  "connected_accounts.credentials": column("connected_accounts", "credentials_enc"),
  "contacts.name": column("contacts", "name_enc"),
  "contacts.email": column("contacts", "email_enc"),
  "documents.original_name": column("documents", "original_name_enc"),
  "documents.password": column("documents", "password_enc"),
  "requests.link": json("requests", "details"),
  "shares.link": json("shares", "delivery"),
  "datasets.lines": json("datasets", "data"),
  "datasets.edits": json("datasets", "data"),
  "activity_log.rejection": json("activity_log", "details", `x.action = 'form.rejected' and x.entity_id in ${ids}`),
  "activity_log.figure_change": json("activity_log", "details", "x.action = 'dataset.changed' and x.details->>'dataset' in (select split_part(p, '/', 2) from unnest($4::text[]) p)"),
};

// The key store on a direct Postgres connection. Read only unless `writable`, so a dry run
// can never make or change a firm's key.
export function pgKeyStore(db: ClientBase, writable = false): KeyStore {
  return {
    async read(firmId) {
      const { rows } = await db.query("select wrapped_key from public.firm_keys where firm_id = $1", [firmId]);
      return rows[0] ? Buffer.from(rows[0].wrapped_key, "base64") : null;
    },
    async write(firmId, wrapped, previous) {
      if (!writable) throw new Error("The key store is read only here");
      const { rowCount } = previous
        ? await db.query("update public.firm_keys set wrapped_key = $2 where firm_id = $1 and wrapped_key = $3", [firmId, wrapped.toString("base64"), previous.toString("base64")])
        : await db.query("insert into public.firm_keys (firm_id, wrapped_key) values ($1, $2) on conflict do nothing", [firmId, wrapped.toString("base64")]);
      return (rowCount ?? 0) > 0;
    },
  };
}

// Opens every encrypted value (of `firms` only, when given) and checks its blind index.
// Returns counts per table: values, values that opened, and blind indexes that matched, and
// a digest of what opened, so two copies of the data can be compared without showing it.
export async function checkValues(db: ClientBase, crypto: ReturnType<typeof firmCrypto>, firms?: string[]) {
  const counts: Record<string, { values: number; opened: number; indexes: number; matched: number; digest: string }> = {};
  for (const [name, sql] of Object.entries(ENCRYPTED)) {
    const { rows } = await db.query({
      text: `select * from (${sql}) v where $1::uuid[] is null or v.firm_id = any($1)`,
      values: [firms ?? null],
      rowMode: "array",
    });
    const count = (counts[name] = { values: rows.length, opened: 0, indexes: 0, matched: 0, digest: "" });
    const seen: string[] = [];
    for (const [firm, place, value, field, index] of rows as string[][]) {
      try {
        const text = await crypto.decrypt(firm, place, value);
        count.opened++;
        seen.push(`${firm}/${place}:${createHash("sha256").update(text).digest("hex")}`);
        if (field && index) {
          count.indexes++;
          if ((await crypto.blindIndex(firm, field, text)) === index) count.matched++;
        }
      } catch {}
    }
    count.digest = createHash("sha256").update(seen.sort().join("\n")).digest("hex");
  }
  return counts;
}

export const allOpened = (counts: Awaited<ReturnType<typeof checkValues>>) =>
  Object.values(counts).every((count) => count.opened === count.values && count.matched === count.indexes);

export function printCounts(counts: Awaited<ReturnType<typeof checkValues>>) {
  console.table(Object.fromEntries(Object.entries(counts).map(([name, count]) =>
    [name, { values: count.values, opened: count.opened, "blind indexes": count.indexes, "indexes matched": count.matched }])));
}

// The number of a firm's newest key: a new value's second byte.
export const newestKey = async (crypto: ReturnType<typeof firmCrypto>, firm: string) =>
  Buffer.from(await crypto.encrypt(firm, "drill/rotation", "check"), "base64url")[1];

// How many of a firm's values each table still holds under a key older than `newest`.
export async function staleCounts(db: ClientBase, firm: string, newest: number) {
  const counts: Record<string, number> = {};
  for (const [name, sql] of Object.entries(ENCRYPTED)) {
    const { rows } = await db.query(`select count(*)::int n from (${sql}) v(firm_id, place, value) where v.firm_id = $1 and private.sealed_key(v.value) < $2`, [firm, newest]);
    counts[name] = rows[0].n;
  }
  return counts;
}

// Seals each of a firm's values still under an older key again with its newest key (after
// rotate-keys added one), a batch at a time, so a run stopped part way is finished by the
// next. One line in the firm's log counts them (keys.resealed); the tables' own change lines
// are left out (app.logged), since what they hold did not change. A value that does not open
// is left as it is and counted. Never returns or prints a value.
export async function reseal(db: ClientBase, crypto: ReturnType<typeof firmCrypto>, firm: string, batch = 500) {
  const newest = await newestKey(crypto, firm);
  const counts: Record<string, { sealed: number; failed: number }> = {};
  await db.query("select set_config('app.logged', 'on', false)");
  try {
    for (const [name, sql] of Object.entries(ENCRYPTED)) {
      const count = (counts[name] = { sealed: 0, failed: 0 });
      for (let after = ""; ; ) {
        const { rows } = await db.query({
          text: `select v.place, v.value from (${sql}) v(firm_id, place, value)
            where v.firm_id = $1 and private.sealed_key(v.value) < $2 and v.value collate "C" > $3 order by v.value collate "C" limit $4`,
          values: [firm, newest, after, batch],
          rowMode: "array",
        });
        if (!rows.length) break;
        after = rows[rows.length - 1][1];
        const swaps = new Map<string, { sealed: string; place: string }>();
        for (const [place, value] of rows as string[][]) {
          if (swaps.has(value)) continue;
          try {
            const sealed = await crypto.reseal(firm, place, value);
            if (sealed) swaps.set(value, { sealed, place });
          } catch {
            count.failed++;
          }
        }
        if (!swaps.size) continue;
        await db.query(STORED[name], [firm, [...swaps.keys()], [...swaps.values()].map((swap) => swap.sealed), [...swaps.values()].map((swap) => swap.place)]);
        count.sealed += swaps.size;
      }
    }
  } finally {
    await db.query("select set_config('app.logged', 'off', false)");
  }
  const values = Object.values(counts).reduce((sum, count) => sum + count.sealed, 0);
  if (values) await db.query("insert into public.activity_log (firm_id, action, entity_type, entity_id, details) values ($1, 'keys.resealed', 'firm', $1, $2)", [firm, { values, key_number: newest }]);
  return counts;
}
