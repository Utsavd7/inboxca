import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { awsCredentials, awsFetch, type AwsCredentials } from "./aws";
import { supabaseAdmin } from "./supabase";

// Per-firm envelope encryption (PLAN.md 8.4). Each firm has a key set: one key for blind
// indexes and its encryption keys, newest last. The set is stored only wrapped by the
// outer key (AWS KMS in production), and kept unwrapped in memory for at most 5 minutes.
// Every value is AES-256-GCM, bound to its firm and its place (record and field), so a
// value copied to another firm, record or field fails to open.

// The outer key: AWS KMS in production, a local key in development and tests.
export type Kek = {
  wrap(data: Buffer, firmId: string): Promise<Buffer>;
  unwrap(data: Buffer, firmId: string): Promise<Buffer>;
};
// Where wrapped key sets live (firm_keys). write() replaces only if the stored value is
// still `previous`, so two servers never overwrite each other's new key.
export type KeyStore = {
  read(firmId: string): Promise<Buffer | null>;
  write(firmId: string, wrapped: Buffer, previous: Buffer | null): Promise<boolean>;
};

const KEY = 32;
const IV = 12;
const TAG = 16;
const FORMAT = 1;
const CACHE_MS = 5 * 60 * 1000;

function seal(key: Buffer, data: Buffer, aad: string) {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

function open(key: Buffer, sealed: Buffer, aad: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, IV)).setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([decipher.update(sealed.subarray(IV, sealed.length - TAG)), decipher.final()]);
}

// A local outer key, for development and tests only.
export function localKek(key: Buffer): Kek {
  if (key.length !== KEY) throw new Error("A local key is 32 bytes");
  return {
    wrap: async (data, firmId) => seal(key, data, `kek:${firmId}`),
    unwrap: async (data, firmId) => open(key, data, `kek:${firmId}`),
  };
}

// AWS KMS as the outer key (8.4, D28). Each wrap asks KMS for a fresh data key bound to the
// firm by its encryption context, and seals the key set with it here, so a key set of any
// size fits: stored is the data key as KMS wrapped it, then the sealed set. Only KMS can
// unwrap the data key, and only for the same firm. Errors carry KMS's error name, no data.
export function kmsKek({ keyId, region, credentials, endpoint = `https://kms.${region}.amazonaws.com/` }: { keyId: string; region: string; credentials: AwsCredentials; endpoint?: string }): Kek {
  const call = async (action: string, firmId: string, body: object) => {
    const headers = { "content-type": "application/x-amz-json-1.1", "x-amz-target": `TrentService.${action}` };
    const response = await awsFetch("POST", endpoint, headers, JSON.stringify({ KeyId: keyId, EncryptionContext: { firm_id: firmId }, ...body }), { service: "kms", region, credentials });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`KMS ${action} failed: ${String(answer.__type ?? response.status).split("#").pop()}`);
    return { key: Buffer.from(answer.Plaintext, "base64"), wrapped: Buffer.from(answer.CiphertextBlob ?? "", "base64") };
  };
  return {
    async wrap(data, firmId) {
      const { key, wrapped } = await call("GenerateDataKey", firmId, { KeySpec: "AES_256" });
      const size = Buffer.alloc(2);
      size.writeUInt16BE(wrapped.length);
      return Buffer.concat([size, wrapped, seal(key, data, `kek:${firmId}`)]);
    },
    async unwrap(data, firmId) {
      const size = data.readUInt16BE(0);
      const { key } = await call("Decrypt", firmId, { CiphertextBlob: data.subarray(2, 2 + size).toString("base64") });
      return open(key, data.subarray(2 + size), `kek:${firmId}`);
    },
  };
}

// This server's outer key: AWS KMS once KMS_KEY_ID (the key's ARN, which names its region)
// and KMS_CREDENTIALS ("key id:secret" of a user that may only use this key; on AWS Lambda
// the function's role instead) are set; otherwise LOCAL_KEK, in development and tests.
export function serverKek(): Kek {
  const keyId = process.env.KMS_KEY_ID;
  if (keyId) {
    const credentials = awsCredentials(process.env.KMS_CREDENTIALS);
    if (!credentials) throw new Error("KMS_CREDENTIALS is not set");
    return kmsKek({ keyId, region: keyId.startsWith("arn:") ? keyId.split(":")[3] : "ap-south-1", credentials });
  }
  if (!process.env.LOCAL_KEK) throw new Error("Firm encryption is not set up on this server");
  return localKek(Buffer.from(process.env.LOCAL_KEK, "base64"));
}

// Same text, same index; different text, firm or field, different index.
const normalise = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function firmCrypto(kek: Kek, store: KeyStore, now = () => Date.now()) {
  const cache = new Map<string, { index: Buffer; keys: Buffer[]; until: number }>();
  const loading = new Map<string, ReturnType<typeof load>>();

  // fresh skips the cache: a value made after another server rotated the key. Values opened
  // at the same moment share one unwrap, so a page of them asks KMS once.
  function keySet(firmId: string, fresh = false) {
    const cached = cache.get(firmId);
    if (cached && cached.until > now() && !fresh) return Promise.resolve(cached);
    if (!fresh && loading.has(firmId)) return loading.get(firmId)!;
    const pending = load(firmId).finally(() => loading.delete(firmId));
    loading.set(firmId, pending);
    return pending;
  }
  async function load(firmId: string) {
    let wrapped = await store.read(firmId);
    if (!wrapped) {
      await store.write(firmId, await kek.wrap(randomBytes(KEY * 2), firmId), null);
      wrapped = (await store.read(firmId))!;
    }
    const plain = await kek.unwrap(wrapped, firmId);
    const set = { index: plain.subarray(0, KEY), keys: [] as Buffer[], until: now() + CACHE_MS };
    // A retired key is kept as zeros, so later keys keep their numbers; it opens nothing.
    for (let at = KEY; at < plain.length; at += KEY) if (plain.subarray(at, at + KEY).some(Boolean)) set.keys[at / KEY - 1] = plain.subarray(at, at + KEY);
    cache.set(firmId, set);
    return set;
  }

  // Ties a value to its firm and place: "clients/<id>/pan", for example.
  const aad = (firmId: string, place: string, extra = "") => `${FORMAT}:${firmId}:${place}${extra}`;

  return {
    async encrypt(firmId: string, place: string, text: string) {
      const { keys } = await keySet(firmId);
      const generation = keys.length - 1;
      const body = seal(keys[generation], Buffer.from(text), aad(firmId, place));
      return Buffer.concat([Buffer.from([FORMAT, generation]), body]).toString("base64url");
    },

    async decrypt(firmId: string, place: string, value: string) {
      const raw = Buffer.from(value, "base64url");
      let { keys } = await keySet(firmId);
      if (!keys[raw[1]]) ({ keys } = await keySet(firmId, true));
      if (raw[0] !== FORMAT || !keys[raw[1]]) throw new Error("Unknown encryption format or key");
      return open(keys[raw[1]], raw.subarray(2), aad(firmId, place)).toString();
    },

    // A keyed hash for finding a record by an encrypted identifier (a PAN, an email).
    async blindIndex(firmId: string, field: string, value: string) {
      const { index } = await keySet(firmId);
      return createHmac("sha256", index).update(`${field}:${normalise(value)}`).digest().subarray(0, 16).toString("base64url");
    },

    // Large files, chunk by chunk. Each chunk is bound to its number and to whether it is
    // the last, so chunks can not be reordered, dropped or cut off at the end.
    async *encryptChunks(firmId: string, place: string, chunks: AsyncIterable<Uint8Array>) {
      const { keys } = await keySet(firmId);
      const generation = keys.length - 1;
      yield Buffer.from([FORMAT, generation]);
      let number = 0;
      let held: Buffer | null = null;
      const frame = (data: Buffer, last: boolean) => {
        const body = seal(keys[generation], data, aad(firmId, place, `:${number++}:${last ? 1 : 0}`));
        const head = Buffer.alloc(5);
        head.writeUInt32BE(body.length);
        head[4] = last ? 1 : 0;
        return Buffer.concat([head, body]);
      };
      for await (const chunk of chunks) {
        if (held) yield frame(held, false);
        held = Buffer.from(chunk);
      }
      yield frame(held ?? Buffer.alloc(0), true);
    },

    async *decryptChunks(firmId: string, place: string, chunks: AsyncIterable<Uint8Array>) {
      let { keys } = await keySet(firmId);
      let buffer = Buffer.alloc(0);
      let key: Buffer | null = null;
      let number = 0;
      let ended = false;
      for await (const chunk of chunks) {
        buffer = Buffer.concat([buffer, chunk]);
        if (!key && buffer.length >= 2) {
          if (!keys[buffer[1]]) ({ keys } = await keySet(firmId, true));
          if (buffer[0] !== FORMAT || !keys[buffer[1]]) throw new Error("Unknown encryption format or key");
          key = keys[buffer[1]];
          buffer = buffer.subarray(2);
        }
        while (key && buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt32BE(0)) {
          if (ended) throw new Error("Data after the last chunk");
          const size = buffer.readUInt32BE(0);
          const last = buffer[4] === 1;
          yield open(key, buffer.subarray(5, 5 + size), aad(firmId, place, `:${number++}:${last ? 1 : 0}`));
          buffer = buffer.subarray(5 + size);
          ended = last;
        }
      }
      if (!ended || buffer.length) throw new Error("The file is cut off");
    },

    // A new encryption key for the firm. Older values still open with their own key until
    // they are re-encrypted; the search key stays, so blind indexes do not change.
    async rotate(firmId: string) {
      const previous = await store.read(firmId);
      if (!previous) {
        await keySet(firmId);
        return;
      }
      const plain = await kek.unwrap(previous, firmId);
      if (plain.length / KEY - 1 >= 255) throw new Error("Too many keys; re-encrypt first");
      const next = await kek.wrap(Buffer.concat([plain, randomBytes(KEY)]), firmId);
      if (!(await store.write(firmId, next, previous))) throw new Error("The key changed meanwhile; try again");
      cache.delete(firmId);
    },

    // After a rotation: the same value sealed with the newest key for the same place, or null
    // when it already is. It is opened first, so a value moved from elsewhere is refused.
    async reseal(firmId: string, place: string, value: string) {
      const { keys } = await keySet(firmId);
      if (Buffer.from(value, "base64url")[1] === keys.length - 1) return null;
      return this.encrypt(firmId, place, await this.decrypt(firmId, place, value));
    },

    // After the re-seal: wipes the firm's keys older than `newest`, so a copy of them taken
    // later opens nothing. The search key and the newest key stay. Returns how many it wiped
    // (with `dryRun`, would wipe); refuses if the newest key is no longer `newest`.
    async retire(firmId: string, newest: number, dryRun = false) {
      const previous = await store.read(firmId);
      const plain = previous && (await kek.unwrap(previous, firmId));
      if (!plain || plain.length / KEY - 2 !== newest) throw new Error("The key changed meanwhile; try again");
      const older = plain.subarray(KEY, plain.length - KEY);
      let live = 0;
      for (let at = 0; at < older.length; at += KEY) if (older.subarray(at, at + KEY).some(Boolean)) live++;
      if (!live || dryRun) return live;
      const next = await kek.wrap(Buffer.concat([plain.subarray(0, KEY), Buffer.alloc(older.length), plain.subarray(plain.length - KEY)]), firmId);
      if (!(await store.write(firmId, next, previous))) throw new Error("The key changed meanwhile; try again");
      cache.delete(firmId);
      return live;
    },
  };
}

// The key store on Supabase, through the server key. Kept as base64 text, so that the
// "only if unchanged" write is a plain comparison.
export function supabaseKeyStore(supabase: SupabaseClient<Database>): KeyStore {
  return {
    async read(firmId) {
      const { data, error } = await supabase.from("firm_keys").select("wrapped_key").eq("firm_id", firmId).maybeSingle();
      if (error) throw new Error(`firm_keys read failed: ${error.code}`);
      return data ? Buffer.from(data.wrapped_key, "base64") : null;
    },
    async write(firmId, wrapped, previous) {
      const table = supabase.from("firm_keys");
      const value = wrapped.toString("base64");
      const { data, error } = previous
        ? await table.update({ wrapped_key: value }).eq("firm_id", firmId).eq("wrapped_key", previous.toString("base64")).select("firm_id")
        : await table.upsert({ firm_id: firmId, wrapped_key: value }, { onConflict: "firm_id", ignoreDuplicates: true }).select("firm_id");
      if (error) throw new Error(`firm_keys write failed: ${error.code}`);
      return data.length > 0;
    },
  };
}

// This server's firm encryption, one per server so the 5 minute key cache is shared. The
// outer key is local in development and tests (LOCAL_KEK, written by `npm run db:env`) and
// AWS KMS in production (serverKek); with neither, nothing is encrypted.
let server: ReturnType<typeof firmCrypto> | undefined;
export function serverCrypto() {
  return (server ??= firmCrypto(serverKek(), supabaseKeyStore(supabaseAdmin())));
}
