import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/src/db/types";
import { firmCrypto, localKek, supabaseKeyStore } from "@/src/lib/crypto";
import { localSupabase } from "../local-env";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Each firm's wrapped key set, in firm_keys. The second group goes through Supabase's API
// like the app does, so it commits, and removes its firm afterwards.
const FIRM = "00000000-0000-4000-8000-0000000002a0";
const OWNER = "00000000-0000-4000-8000-0000000002a1";
const local = localSupabase();

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await asOwner(db);
  await db.query("delete from public.firms where id = $1", [FIRM]);
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users (id, email) values ($1, 'keys@firm.test')", [OWNER]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Keys Firm', '27', 'active')", [FIRM]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [FIRM, OWNER]);
  await db.query("insert into public.firm_keys (firm_id, wrapped_key) values ($1, 'x')", [FIRM]);
}

describe("firm keys in the database", () => {
  it("are out of reach of everyone signed in, the firm's owner included", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect((await attempt(db, "select 1 from public.firm_keys")).ok).toBe(false);
      expect((await attempt(db, "delete from public.firm_keys")).ok).toBe(false);
    }));

  it("go with the firm when it is deleted", () =>
    rollback(db, async () => {
      await seed();
      await db.query("delete from public.firms where id = $1", [FIRM]);
      expect((await db.query("select 1 from public.firm_keys where firm_id = $1", [FIRM])).rowCount).toBe(0);
    }));
});

describe.skipIf(!local.url)("the key store through Supabase's API", () => {
  it("makes a key once, rotates it, and refuses a write from stale data", async () => {
    await asOwner(db);
    await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Keys Firm', '27', 'active')", [FIRM]);
    const admin = createClient<Database>(local.url, local.secretKey, { auth: { persistSession: false } });
    const store = supabaseKeyStore(admin);
    const kek = localKek(randomBytes(32));
    const crypto = firmCrypto(kek, store);
    const sealed = await crypto.encrypt(FIRM, "clients/c1/pan", "ABCDE1234F");
    const first = await store.read(FIRM);
    expect(await firmCrypto(kek, store).decrypt(FIRM, "clients/c1/pan", sealed)).toBe("ABCDE1234F");

    await crypto.rotate(FIRM);
    expect((await store.read(FIRM))!.equals(first!)).toBe(false);
    expect(await store.write(FIRM, randomBytes(8), first)).toBe(false);
    expect(await store.write(FIRM, randomBytes(8), null)).toBe(false);
    expect(await crypto.decrypt(FIRM, "clients/c1/pan", sealed)).toBe("ABCDE1234F");
  });
});
