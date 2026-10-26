import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// A person in two firms: the app names the firm it works in (x-inboxca-firm, src/lib/member.ts),
// and the database then shows and changes that firm only.
const A = "00000000-0000-4000-8000-000000000da0";
const B = "00000000-0000-4000-8000-000000000db0";
const ELSEWHERE = "00000000-0000-4000-8000-000000000dc0";
const PERSON = "00000000-0000-4000-8000-000000000d01";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const named = (firm: string) => db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-inboxca-firm": firm })]);
const clients = async () => (await db.query("select name from public.clients order by name")).rows.map((row) => row.name);

it("shows a person in two firms only the firm the app names, and changes nothing in the other", () =>
  rollback(db, async () => {
    await asOwner(db);
    await db.query("insert into auth.users (id, email) values ($1, 'two-firms@current-firm.test')", [PERSON]);
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Firm A', '24', 'active'), ($2, 'Firm B', '27', 'active'), ($3, 'Elsewhere', '27', 'active')", [A, B, ELSEWHERE]);
    await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $3, 'owner', 'active'), ($2, $3, 'partner', 'active')", [A, B, PERSON]);
    await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'A client', 'individual'), ($2, 'B client', 'individual'), ($3, 'Elsewhere client', 'individual')", [A, B, ELSEWHERE]);
    await actAs(db, PERSON);
    // The server's own lookups send no firm: both of the person's firms stay open.
    expect(await clients()).toEqual(["A client", "B client"]);

    await named(A);
    expect(await clients()).toEqual(["A client"]);
    expect((await db.query("select public.member_role($1) as a, public.member_role($2) as b", [A, B])).rows[0]).toEqual({ a: "owner", b: null });
    expect((await attempt(db, "update public.clients set name = 'Changed' where firm_id = $1", [B])).count ?? 0).toBe(0);

    await named(B);
    expect(await clients()).toEqual(["B client"]);
    // Naming a firm the person is not in opens nothing, and a header that is not a firm id
    // narrows nothing: it can never widen what the person sees.
    await named(ELSEWHERE);
    expect(await clients()).toEqual([]);
    await named("not-a-firm");
    expect(await clients()).toEqual(["A client", "B client"]);
  }));
