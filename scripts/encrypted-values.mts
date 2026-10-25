// Shared by the key rotation and restore drills (PLAN.md M11): every encrypted value the app
// stores, and a check that each one still opens. Counts only; no value is ever printed.
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
