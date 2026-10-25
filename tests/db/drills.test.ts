import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmCrypto, localKek } from "@/src/lib/crypto";
import { allOpened, checkValues, pgKeyStore } from "../../scripts/encrypted-values.mts";
import { asOwner, connect, rollback } from "./db";

// What the key rotation and restore drills rely on: finding and opening every encrypted value.
const FIRM = "00000000-0000-4000-8000-00000000d211";
let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(() => db.end());

async function seed() {
  await asOwner(db);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Drill Firm', '27', 'active')", [FIRM]);
  const kek = localKek(randomBytes(32));
  const crypto = firmCrypto(kek, pgKeyStore(db, true));
  const client = (await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Invented Mills', 'company') returning id", [FIRM])).rows[0].id;
  await db.query("update public.clients set email_enc = $2, email_bidx = $3 where id = $1", [client, await crypto.encrypt(FIRM, `clients/${client}/email`, "a@mills.test"), await crypto.blindIndex(FIRM, "email", "a@mills.test")]);
  await db.query("insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, 'pan', $3, $4)",
    [FIRM, client, await crypto.encrypt(FIRM, `clients/${client}/pan`, "ABCDE1234F"), await crypto.blindIndex(FIRM, "pan", "ABCDE1234F")]);
  return { kek, crypto, client };
}

describe("the drills' check of encrypted values", () => {
  it("opens every value and blind index, before and after a rotation", () =>
    rollback(db, async () => {
      const { kek, crypto } = await seed();
      const before = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), [FIRM]);
      expect(before["clients.email"]).toMatchObject({ values: 1, opened: 1, indexes: 1, matched: 1 });
      expect(before["client_registrations.number"]).toMatchObject({ values: 1, opened: 1, indexes: 1, matched: 1 });
      await crypto.rotate(FIRM);
      const after = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), [FIRM]);
      expect(allOpened(after)).toBe(true);
      expect(after["clients.email"].digest).toBe(before["clients.email"].digest);
    }));

  it("counts a value moved to another place, or opened with another outer key, as not opened", () =>
    rollback(db, async () => {
      const { kek, client } = await seed();
      await db.query("update public.clients set email_enc = (select number_enc from public.client_registrations where client_id = $1) where id = $1", [client]);
      const moved = await checkValues(db, firmCrypto(kek, pgKeyStore(db)), [FIRM]);
      expect(moved["clients.email"]).toMatchObject({ values: 1, opened: 0 });
      expect(allOpened(moved)).toBe(false);
      const other = await checkValues(db, firmCrypto(localKek(randomBytes(32)), pgKeyStore(db)), [FIRM]);
      expect(other["client_registrations.number"]).toMatchObject({ values: 1, opened: 0 });
    }));

  it("never makes or changes a key when read only", () =>
    rollback(db, async () => {
      await asOwner(db);
      await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Drill Firm', '27', 'active')", [FIRM]);
      await expect(firmCrypto(localKek(randomBytes(32)), pgKeyStore(db)).encrypt(FIRM, "drill/x", "x")).rejects.toThrow("read only");
      expect((await db.query("select 1 from public.firm_keys where firm_id = $1", [FIRM])).rowCount).toBe(0);
    }));
});
