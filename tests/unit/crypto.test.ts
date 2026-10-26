import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { firmCrypto, kmsKek, localKek, serverKek, type KeyStore } from "@/src/lib/crypto";
import { fakeAws, testCredentials } from "@/tests/fixtures/aws";

const FIRM = "firm-a";
const OTHER = "firm-b";
const PLACE = "clients/c1/pan";

function memoryStore(): KeyStore & { rows: Map<string, Buffer> } {
  const rows = new Map<string, Buffer>();
  return {
    rows,
    read: async (firmId) => rows.get(firmId) ?? null,
    write: async (firmId, wrapped, previous) => {
      const current = rows.get(firmId) ?? null;
      if (previous ? !current?.equals(previous) : current) return false;
      rows.set(firmId, wrapped);
      return true;
    },
  };
}
const setup = () => {
  const kek = localKek(randomBytes(32));
  const store = memoryStore();
  return { kek, store, crypto: firmCrypto(kek, store) };
};
async function* from(...parts: string[]) {
  for (const part of parts) yield Buffer.from(part);
}
async function collect(chunks: AsyncIterable<Buffer>) {
  const out: Buffer[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}
const fails = (promise: Promise<unknown>) => expect(promise).rejects.toThrow();

describe("encrypting a value", () => {
  it("opens what it sealed, and seals the same text differently each time", async () => {
    const { crypto } = setup();
    const a = await crypto.encrypt(FIRM, PLACE, "ABCDE1234F");
    const b = await crypto.encrypt(FIRM, PLACE, "ABCDE1234F");
    expect(a).not.toBe(b);
    expect(a).not.toContain("ABCDE1234F");
    expect(await crypto.decrypt(FIRM, PLACE, a)).toBe("ABCDE1234F");
  });

  it("refuses a value moved to another firm, record or field", async () => {
    const { crypto } = setup();
    const sealed = await crypto.encrypt(FIRM, PLACE, "ABCDE1234F");
    await fails(crypto.decrypt(OTHER, PLACE, sealed));
    await fails(crypto.decrypt(FIRM, "clients/c2/pan", sealed));
    await fails(crypto.decrypt(FIRM, "clients/c1/gstin", sealed));
  });

  it("refuses a value that was changed", async () => {
    const { crypto } = setup();
    const raw = Buffer.from(await crypto.encrypt(FIRM, PLACE, "ABCDE1234F"), "base64url");
    raw[raw.length - 20] ^= 1;
    await fails(crypto.decrypt(FIRM, PLACE, raw.toString("base64url")));
  });

  it("gives each firm its own key, which a different outer key can not open", async () => {
    const { store, crypto } = setup();
    await crypto.encrypt(FIRM, PLACE, "x");
    await crypto.encrypt(OTHER, PLACE, "x");
    expect(store.rows.get(FIRM)!.equals(store.rows.get(OTHER)!)).toBe(false);
    const stranger = firmCrypto(localKek(randomBytes(32)), store);
    await fails(stranger.encrypt(FIRM, PLACE, "x"));
  });
});

describe("blind indexes", () => {
  it("match the same identifier however it is typed, and nothing else", async () => {
    const { crypto } = setup();
    const index = (firm: string, field: string, value: string) => crypto.blindIndex(firm, field, value);
    expect(await index(FIRM, "email", " Ram@Example.com ")).toBe(await index(FIRM, "email", "ram@example.com"));
    expect(await index(FIRM, "email", "ram@example.com")).not.toBe(await index(OTHER, "email", "ram@example.com"));
    expect(await index(FIRM, "email", "x")).not.toBe(await index(FIRM, "pan", "x"));
    expect(await index(FIRM, "email", "ram@example.com")).not.toContain("ram");
  });
});

describe("encrypting a file in chunks", () => {
  it("opens what it sealed, empty files included", async () => {
    const { crypto } = setup();
    for (const parts of [["first ", "second ", "third"], []]) {
      const sealed = await collect(crypto.encryptChunks(FIRM, "copies/f1", from(...parts)));
      const opened = await collect(crypto.decryptChunks(FIRM, "copies/f1", (async function* () { yield* sealed; })()));
      expect(Buffer.concat(opened).toString()).toBe(parts.join(""));
    }
  });

  it("opens it however the stored bytes are split when read back", async () => {
    const { crypto } = setup();
    const whole = Buffer.concat(await collect(crypto.encryptChunks(FIRM, "copies/f1", from("a", "b", "c"))));
    async function* bytes() {
      for (const byte of whole) yield Buffer.from([byte]);
    }
    expect(Buffer.concat(await collect(crypto.decryptChunks(FIRM, "copies/f1", bytes()))).toString()).toBe("abc");
  });

  it("refuses chunks that were reordered, dropped, cut off or moved", async () => {
    const { crypto } = setup();
    const [head, one, two, three] = await collect(crypto.encryptChunks(FIRM, "copies/f1", from("a", "b", "c")));
    const open = (place: string, ...parts: Buffer[]) =>
      collect(crypto.decryptChunks(FIRM, place, (async function* () { yield* parts; })()));
    await fails(open("copies/f1", head, two, one, three));
    await fails(open("copies/f1", head, one, three));
    await fails(open("copies/f1", head, one, two));
    await fails(open("copies/f1", head, one, two, three.subarray(0, three.length - 1)));
    await fails(open("copies/f2", head, one, two, three));
  });
});

describe("rotating a firm's key", () => {
  it("keeps old values readable, seals new ones with the new key, and keeps blind indexes", async () => {
    const { kek, store, crypto } = setup();
    const before = await crypto.encrypt(FIRM, PLACE, "old");
    const index = await crypto.blindIndex(FIRM, "pan", "ABCDE1234F");
    // A second server that cached the key set before the rotation.
    const other = firmCrypto(kek, store);
    await other.encrypt(FIRM, PLACE, "warm the cache");
    await crypto.rotate(FIRM);
    const after = await crypto.encrypt(FIRM, PLACE, "new");
    expect(Buffer.from(after, "base64url")[1]).toBe(1);
    expect(await crypto.decrypt(FIRM, PLACE, before)).toBe("old");
    expect(await other.decrypt(FIRM, PLACE, after)).toBe("new");
    expect(await crypto.blindIndex(FIRM, "pan", "abcde1234f")).toBe(index);
  });

  it("refuses to overwrite a key another server changed meanwhile", async () => {
    const { kek, store, crypto } = setup();
    await crypto.encrypt(FIRM, PLACE, "x");
    const original = store.rows.get(FIRM)!;
    // A store where someone else wrote first: the conditional write is refused.
    const racing = firmCrypto(kek, { read: async () => original, write: async () => false });
    await fails(racing.rotate(FIRM));
    expect(store.rows.get(FIRM)!.equals(original)).toBe(true);
  });

  it("seals an older value again with the newest key, in its own place only", async () => {
    const { crypto } = setup();
    const old = await crypto.encrypt(FIRM, PLACE, "ABCDE1234F");
    await crypto.rotate(FIRM);
    await crypto.rotate(FIRM);
    const again = (await crypto.reseal(FIRM, PLACE, old))!;
    expect(Buffer.from(again, "base64url")[1]).toBe(2);
    expect(await crypto.decrypt(FIRM, PLACE, again)).toBe("ABCDE1234F");
    // Already on the newest key: nothing to do.
    expect(await crypto.reseal(FIRM, PLACE, again)).toBeNull();
    // A value copied from another place or firm does not open, so it is not sealed anew.
    await fails(crypto.reseal(FIRM, "clients/c2/pan", old));
    await crypto.encrypt(OTHER, PLACE, "x");
    await crypto.rotate(OTHER);
    await fails(crypto.reseal(OTHER, PLACE, old));
  });
});

describe("the unwrapped key in memory", () => {
  it("is kept for 5 minutes, then unwrapped again", async () => {
    const base = localKek(randomBytes(32));
    let unwraps = 0;
    const kek = { wrap: base.wrap, unwrap: (data: Buffer, firm: string) => (unwraps++, base.unwrap(data, firm)) };
    let time = 0;
    const crypto = firmCrypto(kek, memoryStore(), () => time);
    await crypto.encrypt(FIRM, PLACE, "x");
    time += 4 * 60 * 1000;
    await crypto.encrypt(FIRM, PLACE, "x");
    expect(unwraps).toBe(1);
    time += 2 * 60 * 1000;
    await crypto.encrypt(FIRM, PLACE, "x");
    expect(unwraps).toBe(2);
  });
});

// AWS KMS as the outer key, against a fake KMS that checks every signature and keeps its own
// key: a data key comes back wrapped for one encryption context and opens only with it.
describe("AWS KMS as the outer key", () => {
  const KEY_ID = "arn:aws:kms:ap-south-1:111122223333:key/invented";
  const master = randomBytes(32);
  const calls: string[] = [];
  let kms: Awaited<ReturnType<typeof fakeAws>>;
  beforeAll(async () => {
    kms = await fakeAws("kms", "ap-south-1", ({ headers, body }) => {
      const action = headers["x-amz-target"].replace("TrentService.", "");
      const asked = JSON.parse(body.toString());
      calls.push(action);
      if (asked.KeyId !== KEY_ID) return { status: 400, json: { __type: "NotFoundException" } };
      const context = Buffer.from(JSON.stringify(asked.EncryptionContext));
      if (action === "GenerateDataKey") {
        const key = randomBytes(32);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", master, iv).setAAD(context);
        const blob = Buffer.concat([iv, cipher.update(key), cipher.final(), cipher.getAuthTag()]);
        return { json: { KeyId: KEY_ID, Plaintext: key.toString("base64"), CiphertextBlob: blob.toString("base64") } };
      }
      try {
        const blob = Buffer.from(asked.CiphertextBlob, "base64");
        const decipher = createDecipheriv("aes-256-gcm", master, blob.subarray(0, 12)).setAAD(context);
        decipher.setAuthTag(blob.subarray(blob.length - 16));
        return { json: { KeyId: KEY_ID, Plaintext: Buffer.concat([decipher.update(blob.subarray(12, blob.length - 16)), decipher.final()]).toString("base64") } };
      } catch {
        return { status: 400, json: { __type: "com.amazonaws.kms#InvalidCiphertextException", message: "invented" } };
      }
    });
  });
  afterAll(() => kms.close());
  afterEach(() => vi.unstubAllEnvs());
  const kek = (credentials = testCredentials) => kmsKek({ keyId: KEY_ID, region: "ap-south-1", credentials, endpoint: `${kms.url}/` });

  it("seals and opens values, with a fresh data key for each wrap", async () => {
    const store = memoryStore();
    const crypto = firmCrypto(kek(), store);
    const sealed = await crypto.encrypt(FIRM, PLACE, "ABCDE1234F");
    expect(await crypto.decrypt(FIRM, PLACE, sealed)).toBe("ABCDE1234F");
    // A second server, with nothing cached, opens it through KMS too.
    expect(await firmCrypto(kek(), store).decrypt(FIRM, PLACE, sealed)).toBe("ABCDE1234F");
    const data = randomBytes(64);
    const [one, two] = [await kek().wrap(data, FIRM), await kek().wrap(data, FIRM)];
    expect(one.equals(two)).toBe(false);
    expect(one.includes(data)).toBe(false);
  });

  it("refuses a key set wrapped for another firm, or changed", async () => {
    const wrapped = await kek().wrap(randomBytes(64), FIRM);
    await expect(kek().unwrap(wrapped, OTHER)).rejects.toThrow("KMS Decrypt failed: InvalidCiphertextException");
    const blob = Buffer.from(wrapped);
    blob[4] ^= 1;
    await fails(kek().unwrap(blob, FIRM));
    const sealed = Buffer.from(wrapped);
    sealed[sealed.length - 1] ^= 1;
    await fails(kek().unwrap(sealed, FIRM));
  });

  it("names only KMS's error, never a key or a value", async () => {
    const error = await kek({ ...testCredentials, secretAccessKey: "wrong" }).wrap(Buffer.from("key set"), FIRM).catch((caught: Error) => caught);
    expect((error as Error).message).toBe("KMS GenerateDataKey failed: InvalidSignatureException");
  });

  it("rotates: old values open, new ones use the new key, blind indexes stay", async () => {
    const store = memoryStore();
    const crypto = firmCrypto(kek(), store);
    const before = await crypto.encrypt(FIRM, PLACE, "old");
    const index = await crypto.blindIndex(FIRM, "pan", "ABCDE1234F");
    await crypto.rotate(FIRM);
    const after = await crypto.encrypt(FIRM, PLACE, "new");
    expect(Buffer.from(after, "base64url")[1]).toBe(1);
    const fresh = firmCrypto(kek(), store);
    expect(await fresh.decrypt(FIRM, PLACE, before)).toBe("old");
    expect(await fresh.decrypt(FIRM, PLACE, after)).toBe("new");
    expect(await fresh.blindIndex(FIRM, "pan", "abcde1234f")).toBe(index);
  });

  it("asks KMS once for many values opened together", async () => {
    const store = memoryStore();
    const values = await Promise.all(["a", "b", "c"].map((text) => firmCrypto(kek(), store).encrypt(FIRM, PLACE, text)));
    calls.length = 0;
    const crypto = firmCrypto(kek(), store);
    expect(await Promise.all([...values, ...values].map((value) => crypto.decrypt(FIRM, PLACE, value)))).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect(calls).toEqual(["Decrypt"]);
  });

  it("is the server's outer key once KMS_KEY_ID and KMS_CREDENTIALS are set", async () => {
    vi.stubEnv("LOCAL_KEK", randomBytes(32).toString("base64"));
    vi.stubEnv("KMS_KEY_ID", "");
    const local = serverKek();
    expect(await local.unwrap(await local.wrap(Buffer.from("x"), FIRM), FIRM)).toEqual(Buffer.from("x"));
    vi.stubEnv("KMS_KEY_ID", KEY_ID);
    expect(() => serverKek()).toThrow("KMS_CREDENTIALS is not set");
    vi.stubEnv("KMS_CREDENTIALS", `${testCredentials.accessKeyId}:${testCredentials.secretAccessKey}`);
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      asked.push(`${url} ${(init.headers as Record<string, string>).authorization.split(",")[0]}`);
      return Response.json({ Plaintext: randomBytes(32).toString("base64"), CiphertextBlob: "AAAA" });
    });
    await serverKek().wrap(Buffer.from("x"), FIRM);
    vi.unstubAllGlobals();
    expect(asked).toEqual([`https://kms.ap-south-1.amazonaws.com/ AWS4-HMAC-SHA256 Credential=${testCredentials.accessKeyId}/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}/ap-south-1/kms/aws4_request`]);
    vi.stubEnv("KMS_KEY_ID", "");
    vi.stubEnv("LOCAL_KEK", "");
    expect(() => serverKek()).toThrow("Firm encryption is not set up on this server");
  });
});
