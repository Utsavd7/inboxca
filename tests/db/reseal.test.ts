import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmCrypto, localKek } from "@/src/lib/crypto";
import { checkValues, ENCRYPTED, pgKeyStore, reseal, retireKeys, STORED, staleCounts } from "../../scripts/encrypted-values.mts";
import { asOwner, attempt, connect, rollback } from "./db";

// The re-seal after a key rotation (PLAN.md 8.4): each older value sealed again with the firm's
// newest key where it is kept, with nothing else changed. Invented values only.
const FIRM = "00000000-0000-4000-8000-00000000e511";
let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(() => db.end());

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, count) => sum + count, 0);

async function seed() {
  await asOwner(db);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Reseal Firm', '27', 'active')", [FIRM]);
  const kek = localKek(randomBytes(32));
  const crypto = firmCrypto(kek, pgKeyStore(db, true));
  const seal = (place: string, text: string) => crypto.encrypt(FIRM, place, text);
  const [client, dataset, line, document, person] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.query("insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx) values ($1, $2, 'Invented Mills', 'company', $3, $4)", [
    client, FIRM, await seal(`clients/${client}/email`, "a@mills.test"), await crypto.blindIndex(FIRM, "email", "a@mills.test"),
  ]);
  await db.query("insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx) values ($1, $2, 'pan', $3, $4)",
    [FIRM, client, await seal(`clients/${client}/pan`, "ABCDE1234F"), await crypto.blindIndex(FIRM, "pan", "ABCDE1234F")]);
  const contact = randomUUID();
  await db.query("insert into public.contacts (id, firm_id, name_enc, email_enc, email_bidx) values ($1, $2, $3, $4, $5)",
    [contact, FIRM, await seal(`contacts/${contact}/name`, "Invented Accountant"), await seal(`contacts/${contact}/email`, "b@mills.test"), await crypto.blindIndex(FIRM, "email", "b@mills.test")]);
  await db.query("insert into public.documents (id, firm_id, client_id, work_type, document_type, drive_file_id, name, size, sha256, original_name_enc, password_enc) values ($1, $2, $3, 'gst', 'Purchase bills', 'nowhere', 'Invented.pdf', 1, $4, $5, $6)",
    [document, FIRM, client, randomUUID(), await seal(`documents/${document}/original_name`, "scan 0042.pdf"), await seal(`documents/${document}/password`, "invented-password")]);
  const request = randomUUID();
  await db.query("insert into public.requests (id, firm_id, client_id, kind, entity_type, entity_id, details) values ($1, $2, $3, 'documents', 'client', $3, $4)",
    [request, FIRM, client, { period: "2026-09", link_hash: "invented", link_enc: await seal(`requests/${request}/link`, "invented-token") }]);
  // A figure, an unfinished correction of it (whose base is the figure as sealed), its change
  // in the log, and a form's rejection reason.
  const figure = await seal(`datasets/${dataset}/lines/${line}`, '{"label":"Invented sales","value":"100"}');
  const edit = { base: figure, value_enc: await seal(`datasets/${dataset}/lines/${line}/edit/${person}`, '{"value":"150"}') };
  await db.query("insert into public.datasets (id, firm_id, client_id, form_code, period_key, data) values ($1, $2, $3, 'GSTR1', '2026-09', $4)",
    [dataset, FIRM, client, { lines: [{ id: line, value_enc: figure }], edits: { [person]: { [line]: edit } } }]);
  await db.query("insert into public.activity_log (firm_id, action, entity_type, entity_id, details) values ($1, 'dataset.changed', 'client', $2, $3), ($1, 'form.rejected', 'document', $4, $5)", [
    FIRM, client, { line, dataset, revision: 2, before: await seal(`datasets/${dataset}/lines/${line}`, '{"value":"90"}'), after: figure, reason_enc: await seal(`datasets/${dataset}/lines/${line}/reason/1`, "Invented reason") },
    document, { code: "figures", text_enc: await seal(`documents/${document}/rejection`, "Invented rejection") },
  ]);
  return { kek, crypto, client, dataset, line, person };
}

describe("sealing older values again after a key rotation", () => {
  it("moves every value to the newest key where it is kept, a batch at a time, and logs the count", () =>
    rollback(db, async () => {
      const { kek, crypto, dataset, line, person } = await seed();
      const open = () => checkValues(db, firmCrypto(kek, pgKeyStore(db)), [FIRM]);
      const before = await open();
      await crypto.rotate(FIRM);
      const older = await staleCounts(db, FIRM, 1);
      expect(total(older)).toBe(13);
      // Small batches, so each table takes several.
      const counts = await reseal(db, firmCrypto(kek, pgKeyStore(db)), FIRM, 2);
      expect(Object.values(counts).reduce((sum, count) => sum + count.sealed, 0)).toBe(13);
      expect(Object.values(counts).every((count) => count.failed === 0)).toBe(true);
      expect(total(await staleCounts(db, FIRM, 1))).toBe(0);
      // The same text in the same place, blind indexes unchanged.
      expect(await open()).toEqual(before);
      // The unfinished correction still matches the figure it was based on.
      const { rows: [data] } = await db.query("select data->'lines'->0->>'value_enc' figure, data->'edits'->$2->$3->>'base' base from public.datasets where id = $1", [dataset, person, line]);
      expect(data.base).toBe(data.figure);
      expect(Buffer.from(data.figure, "base64url")[1]).toBe(1);
      const { rows: log } = await db.query("select action, details from public.activity_log where firm_id = $1 and action in ('keys.resealed', 'client.changed')", [FIRM]);
      expect(log).toEqual([{ action: "keys.resealed", details: { values: 13, key_number: 1 } }]);
    }));

  it("carries on where a stopped run left off, and leaves a value that does not open", () =>
    rollback(db, async () => {
      const { kek, crypto, client } = await seed();
      await crypto.rotate(FIRM);
      // One value sealed again by an earlier run that stopped, and one moved from another place.
      const done = (await crypto.reseal(FIRM, `clients/${client}/email`, (await db.query("select email_enc from public.clients where id = $1", [client])).rows[0].email_enc))!;
      await db.query("update public.clients set email_enc = $2, sales_mapping_enc = (select number_enc from public.client_registrations where client_id = $1) where id = $1", [client, done]);
      const counts = await reseal(db, firmCrypto(kek, pgKeyStore(db)), FIRM);
      expect(counts["clients.email"]).toEqual({ sealed: 0, failed: 0 });
      expect(counts["clients.sales_mapping"]).toEqual({ sealed: 0, failed: 1 });
      expect((await db.query("select email_enc from public.clients where id = $1", [client])).rows[0].email_enc).toBe(done);
      expect(await staleCounts(db, FIRM, 1)).toMatchObject({ "clients.sales_mapping": 1, "clients.email": 0, "client_registrations.number": 0 });
    }));

  it("has a statement for every encrypted place, and each runs", () =>
    rollback(db, async () => {
      expect(Object.keys(STORED).sort()).toEqual(Object.keys(ENCRYPTED).sort());
      for (const sql of Object.values(STORED)) await db.query(sql, [FIRM, [], [], []]);
    }));
});

describe("retiring the older keys after the re-seal", () => {
  const wrapped = async () => (await db.query("select wrapped_key from public.firm_keys where firm_id = $1", [FIRM])).rows[0].wrapped_key as string;

  it("wipes them once nothing needs them: every value still opens, blind indexes stay, and the older key opens nothing", () =>
    rollback(db, async () => {
      const { kek, crypto } = await seed();
      const open = () => checkValues(db, firmCrypto(kek, pgKeyStore(db)), [FIRM]);
      const before = await open();
      // A value sealed with the first key and kept nowhere InboxCA looks.
      const kept = await crypto.encrypt(FIRM, "drill/kept", "Invented note");
      await crypto.rotate(FIRM);
      await reseal(db, firmCrypto(kek, pgKeyStore(db)), FIRM);
      // The rotation an hour ago, and a safety copy taken since, with the newest key.
      await db.query("insert into public.activity_log (firm_id, action, entity_type, entity_id, details, at) values ($1, 'keys.rotated', 'firm', $1, $2, now() - interval '1 hour'), ($1, 'document.safety_copy', 'firm', $1, '{}', now() - interval '10 minutes')", [FIRM, { key_number: 1 }]);
      const was = await wrapped();
      // A dry run counts the key and changes nothing.
      expect(await retireKeys(db, firmCrypto(kek, pgKeyStore(db)), FIRM, true)).toEqual({ using: {}, keys: 1 });
      expect(await wrapped()).toBe(was);
      expect(await retireKeys(db, firmCrypto(kek, pgKeyStore(db, true)), FIRM)).toEqual({ using: {}, keys: 1 });
      expect(await wrapped()).not.toBe(was);
      expect(await open()).toEqual(before);
      await expect(firmCrypto(kek, pgKeyStore(db)).decrypt(FIRM, "drill/kept", kept)).rejects.toThrow();
      // Nothing left to retire; a later rotation adds key 2, and values on key 1 still open.
      expect(await retireKeys(db, firmCrypto(kek, pgKeyStore(db, true)), FIRM)).toEqual({ using: {}, keys: 0 });
      const rotated = firmCrypto(kek, pgKeyStore(db, true));
      await rotated.rotate(FIRM);
      expect(Buffer.from(await rotated.encrypt(FIRM, "drill/kept", "x"), "base64url")[1]).toBe(2);
      expect(await open()).toEqual(before);
      const { rows: log } = await db.query("select details from public.activity_log where firm_id = $1 and action = 'keys.retired'", [FIRM]);
      expect(log).toEqual([{ details: { keys: 1, key_number: 1 } }]);
    }));

  it("refuses while a value, a safety copy or the 5 minutes after the rotation still need an older key, and names them", () =>
    rollback(db, async () => {
      const { kek, crypto, client } = await seed();
      const retire = () => retireKeys(db, firmCrypto(kek, pgKeyStore(db, true)), FIRM);
      const older = (await db.query("select email_enc from public.clients where id = $1", [client])).rows[0].email_enc;
      await crypto.rotate(FIRM);
      await reseal(db, firmCrypto(kek, pgKeyStore(db)), FIRM);
      // One value back on the first key, as a server that had not yet seen the rotation would seal it.
      await db.query("update public.clients set email_enc = $2 where id = $1", [client, older]);
      const was = await wrapped();
      expect(await retire()).toEqual({ using: { "clients.email": 1 }, keys: 0 });
      expect(await wrapped()).toBe(was);
      await reseal(db, firmCrypto(kek, pgKeyStore(db)), FIRM);
      // Within 5 minutes of the rotation a server may still seal with the older key. A safety
      // copy older than 30 days has passed its lock, so it does not count.
      const log = (action: string, at: string, details: object = {}) =>
        db.query(`insert into public.activity_log (firm_id, action, entity_type, entity_id, details, at) values ($1, $2, 'firm', $1, $3, now() - interval '${at}')`, [FIRM, action, details]);
      await log("keys.rotated", "0 minutes", { key_number: 1 });
      await log("document.safety_copy", "31 days");
      expect(await retire()).toEqual({ using: { "the 5 minutes after the rotation": 1 }, keys: 0 });
      // A safety copy taken before the newest key came in is locked for 30 days, so it keeps its key.
      await log("document.safety_copy", "2 hours");
      expect(await retire()).toEqual({ using: { "safety copies": 1, "the 5 minutes after the rotation": 1 }, keys: 0 });
      expect(await wrapped()).toBe(was);
      expect((await db.query("select count(*)::int n from public.activity_log where firm_id = $1 and action = 'keys.retired'", [FIRM])).rows[0].n).toBe(0);
    }));
});

describe("the activity log after this change", () => {
  it("still refuses every edit but a sealed value swapped for one under a newer key", () =>
    rollback(db, async () => {
      const { crypto, client } = await seed();
      const place = `documents/${client}/rejection`;
      const old = await crypto.encrypt(FIRM, place, "Invented rejection");
      await db.query("insert into public.activity_log (firm_id, action, entity_type, entity_id, details) values ($1, 'form.rejected', 'document', $2, $3)", [FIRM, client, { code: "figures", text_enc: old }]);
      const same = await crypto.encrypt(FIRM, place, "Another reason");
      await crypto.rotate(FIRM);
      const newer = (await crypto.reseal(FIRM, place, old))!;
      const change = (set: string, value: unknown) => attempt(db, `update public.activity_log set ${set} where firm_id = $1 and details->>'text_enc' = $2`, [FIRM, old, value]);
      for (const [set, value] of [
        ["action = $3", "form.approved"],
        ["details = details || jsonb_build_object('code', $3::text)", "other"],
        ["details = jsonb_set(details, '{text_enc}', to_jsonb($3::text))", same],
        ["details = jsonb_set(details, '{text_enc}', to_jsonb($3::text))", "not a sealed value"],
        ["details = details - 'text_enc' || jsonb_build_object('x', $3::text)", newer],
      ] as const)
        expect(await change(set, value)).toMatchObject({ ok: false, code: "42501" });
      expect((await attempt(db, "delete from public.activity_log where firm_id = $1", [FIRM])).ok).toBe(false);
      // Through the API, not even the server key may do it.
      await db.query("set local role service_role");
      expect((await change("details = jsonb_set(details, '{text_enc}', to_jsonb($3::text))", newer)).ok).toBe(false);
      await asOwner(db);
      expect(await change("details = jsonb_set(details, '{text_enc}', to_jsonb($3::text))", newer)).toMatchObject({ ok: true, count: 1 });
    }));
});
