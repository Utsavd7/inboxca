// Removes what test runs left in the shared local database: firms made by tests, people
// whose test firm is gone, and the invented return types tests add. A test firm is one whose
// people all use the reserved @example.test domain, or one with no people at all that is
// named or marked as a test firm. The demo firm and anything less than an hour old (a run
// still going) are never touched. Rows with the database tests' fixed ids (00000000-0000-
// 4000-8000-...) are always leftovers, as those tests roll back, so they go at any age. Prints what it would delete; `--yes` deletes it.
// Run with `npx --yes tsx scripts/clean-test-data.mts [--yes]`.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
if (!/@(127\.0\.0\.1|localhost):/.test(process.env.TEST_DB_URL ?? "")) throw new Error("Only for the local database");
const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();

const firms = (await db.query(`
  select f.id, f.name, to_char(f.created_at, 'YYYY-MM-DD') as made, count(m.user_id)::int as people from public.firms f
  left join public.firm_members m on m.firm_id = f.id left join auth.users u on u.id = m.user_id
  group by f.id
  having f.id::text like '00000000-0000-4000-8000-%' or (f.created_at < now() - interval '1 hour' and (bool_and(u.email like '%@example.test')
    or (count(m.user_id) = 0 and (f.name ilike '%test%' or f.settings ? 'test_run'))))
  order by f.created_at`)).rows;
const demo = (await db.query("select m.firm_id from public.firm_members m join auth.users u on u.id = m.user_id where u.email = 'demo-owner@inboxca.test'")).rows.map((row) => row.firm_id);
if (firms.some((firm) => demo.includes(firm.id))) throw new Error("The demo firm matched; nothing deleted");
const ids = firms.map((firm) => firm.id);
// People of the reserved test domain (or fixed test ids) who belong to no firm once the test firms are gone.
const people = (await db.query(`
  select id, email from auth.users u where (id::text like '00000000-0000-4000-8000-%' or (email like '%@example.test' and created_at < now() - interval '1 hour'))
  and not exists (select 1 from public.firm_members m where m.user_id = u.id and m.firm_id <> all($1::uuid[]))`, [ids])).rows;
// Invented return types, but not one a firm made in the last hour (a running test) still uses.
const types = (await db.query(`select code, name from public.compliance_types c where approved_by = 'test' and source_url like 'https://example.test/%'
  and not exists (select 1 from public.tasks t join public.firms f on f.id = t.firm_id where t.code = c.code and f.created_at > now() - interval '1 hour') order by code`)).rows;

console.log(`${firms.length} test firms:`);
for (const firm of firms) console.log(`  ${firm.name} (made ${firm.made}, ${firm.people} people)`);
console.log(`${people.length} test people with no other firm`);
console.log(`${types.length} test return types: ${types.map((type) => `${type.name} ${type.code}`).join(", ")}`);
if (process.argv.includes("--yes")) {
  await db.query("begin");
  await db.query("select set_config('app.log_purge', 'on', true)");
  await db.query("delete from public.firms where id = any($1::uuid[])", [ids]);
  await db.query("delete from auth.users where id = any($1::uuid[])", [people.map((person) => person.id)]);
  await db.query("delete from public.tasks where code = any($1)", [types.map((type) => type.code)]);
  await db.query("delete from public.compliance_types where code = any($1)", [types.map((type) => type.code)]);
  await db.query("commit");
  console.log("Deleted.");
} else console.log("Nothing deleted. Run again with --yes to delete these.");
await db.end();
