import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { firmCrypto, localKek, type KeyStore } from "@/src/lib/crypto";

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
