import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Passkeys for firm people (PLAN.md 5.17, 8.5): server only, each with its own 2 step factor. A
// passkey removed takes its factor with it and ends every sign in made with it, but the one
// removing it; a factor removed (a recovery code removes them all) takes its passkey.
let db: Client;
const person = "00000000-0000-4000-8000-0000000005a1";
const [laptop, phone] = ["00000000-0000-4000-8000-0000000005f1", "00000000-0000-4000-8000-0000000005f2"];
const [here, lost, other] = ["00000000-0000-4000-8000-0000000005c1", "00000000-0000-4000-8000-0000000005c2", "00000000-0000-4000-8000-0000000005c3"];
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'person@passkeys.test')", [person]);
  await db.query(`insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
    values ($2,$1,'Passkey laptop','totp','verified','INVENTED',now(),now()),($3,$1,'Passkey phone','totp','verified','INVENTED',now(),now())`, [person, laptop, phone]);
  await db.query("insert into auth.sessions(id,user_id,factor_id) values ($1,$4,$5),($2,$4,$5),($3,$4,$6)", [here, lost, other, person, laptop, phone]);
  await db.query("insert into public.passkeys(id,user_id,factor_id,name,public_key,secret) values ('laptop-key',$1,$2,'Laptop','invented','sealed'),('phone-key',$1,$3,'Phone','invented','sealed')", [person, laptop, phone]);
}
const left = async () => ({
  passkeys: (await db.query("select name from public.passkeys where user_id = $1 order by name", [person])).rows.map((row) => row.name),
  factors: (await db.query("select friendly_name from auth.mfa_factors where user_id = $1 order by 1", [person])).rows.map((row) => row.friendly_name),
  sessions: (await db.query("select id from auth.sessions where user_id = $1 order by id", [person])).rows.map((row) => row.id),
});

it("keeps passkeys from everyone signed in, even their own person, and from visitors", () =>
  rollback(db, async () => {
    await seed();
    for (const who of [person, null]) {
      await actAs(db, who);
      for (const sql of ["select id from public.passkeys", "delete from public.passkeys", "update public.passkeys set counter = 0", `insert into public.passkeys(id,user_id,factor_id,name,public_key,secret) values ('x','${person}','${laptop}','X','x','x')`])
        expect((await attempt(db, sql)).error).toMatch(/permission denied/);
    }
  }));

it("removes a passkey's factor with it and signs out where it was used, but not the session removing it", () =>
  rollback(db, async () => {
    await seed();
    await db.query("set local role service_role");
    await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-inboxca-keep-session": here })]);
    await db.query("delete from public.passkeys where id = 'laptop-key'");
    await asOwner(db);
    expect(await left()).toEqual({ passkeys: ["Phone"], factors: ["Passkey phone"], sessions: [here, other] });
  }));

it("signs out everywhere a passkey was used when the owner removes it, and goes with its factor", () =>
  rollback(db, async () => {
    await seed();
    await db.query("set local role service_role");
    await db.query("select set_config('request.headers', '{}', true)");
    await db.query("delete from public.passkeys where id = 'laptop-key'");
    await asOwner(db);
    expect(await left()).toEqual({ passkeys: ["Phone"], factors: ["Passkey phone"], sessions: [other] });
    // A recovery code removes every factor (Supabase Auth's own delete): the passkeys go too.
    await db.query("delete from auth.mfa_factors where user_id = $1", [person]);
    expect(await left()).toEqual({ passkeys: [], factors: [], sessions: [] });
  }));

it("goes with its person", () =>
  rollback(db, async () => {
    await seed();
    await db.query("delete from auth.users where id = $1", [person]);
    expect(await left()).toEqual({ passkeys: [], factors: [], sessions: [] });
  }));
