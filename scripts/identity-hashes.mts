// Writes identity_hash (D38 (6), src/lib/crypto.ts) for every client PAN or GSTIN and connected
// account, a page of firms at a time: each value is opened with its firm's key and hashed with
// the platform key, and the hash is written where it differs. Run it once for rows made before
// the column, and again whenever the platform key (from SUPABASE_SECRET_KEY) changes, since every
// hash then changes; until it has run, the nightly split firms check misses matches and never
// invents one. Counts only, never a value. Prints what it would change; `--yes` writes. Run with
// `npx --yes tsx scripts/identity-hashes.mts [--yes]`. The keys are the server's own, as for the
// key drills: .env.local, or with KMS_KEY_ID, KMS_CREDENTIALS and SUPABASE_SECRET_KEY set in the
// shell, AWS KMS and the database in DATABASE_URL.
import { localEnv, pgKeyStore } from "./encrypted-values.mts";

const url = process.env.KMS_KEY_ID && process.env.DATABASE_URL ? process.env.DATABASE_URL : localEnv();
const { default: pg } = await import("pg");
const { accountIdentity, firmCrypto, numberIdentity, serverKek } = await import("../src/lib/crypto.ts");
const db = new pg.Client({ connectionString: url });
await db.connect();
const crypto = firmCrypto(serverKek(), pgKeyStore(db));
const write = process.argv.includes("--yes");
const VALUES = `select 'client_registrations' tab, id, 'clients/'||client_id||'/'||kind place, number_enc sealed, kind, null provider, identity_hash
    from public.client_registrations where firm_id = $1 and kind in ('pan', 'gstin')
  union all select 'connected_accounts', id, 'accounts/'||id||'/address', address_enc, kind, provider, identity_hash
    from public.connected_accounts where firm_id = $1`;

const started = Date.now();
let firms = 0, values = 0, changed = 0, unopened = 0;
for (let after = "00000000-0000-0000-0000-000000000000"; ; ) {
  const { rows: page } = await db.query("select id from public.firms where id > $1 order by id limit 100", [after]);
  if (!page.length) break;
  for (const { id: firm } of page) {
    firms++;
    const updates: Record<string, { ids: string[]; hashes: (string | null)[] }> = { client_registrations: { ids: [], hashes: [] }, connected_accounts: { ids: [], hashes: [] } };
    for (const row of (await db.query(VALUES, [firm])).rows) {
      values++;
      const plain = await crypto.decrypt(firm, row.place, row.sealed).catch(() => null);
      if (plain === null) {
        unopened++;
        continue;
      }
      const hash = row.tab === "connected_accounts" ? accountIdentity(row.kind, row.provider, plain) : numberIdentity(row.kind, plain);
      if (hash === row.identity_hash) continue;
      changed++;
      updates[row.tab].ids.push(row.id);
      updates[row.tab].hashes.push(hash);
    }
    if (write)
      for (const [table, { ids, hashes }] of Object.entries(updates))
        if (ids.length) await db.query(`update public.${table} x set identity_hash = m.hash from unnest($1::uuid[], $2::text[]) m(id, hash) where x.id = m.id`, [ids, hashes]);
  }
  after = page.at(-1).id;
}
console.log(`${firms} firms, ${values} values, ${unopened} that did not open. ${changed} hashes ${write ? "written" : "to write; run again with --yes to write them"}, in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
await db.end();
