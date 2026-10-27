import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { firmCrypto, localKek, type KeyStore } from "@/src/lib/crypto";
import { b2Store, forgetText, keepSafetyCopy, keepText, localStore, openSafetyCopy, openText, workspaceStore } from "@/src/lib/workspace";
import { fakeAws, testCredentials } from "@/tests/fixtures/aws";

const FIRM = "firm-a";
const DAY = 86_400_000;

// A fake B2 bucket over the S3 API: it checks each signature and each body's MD5, and keeps
// what it was given, with its lock.
const objects = new Map<string, { body: Buffer; lock?: string; until?: string }>();
let failNext = 0;
let b2: Awaited<ReturnType<typeof fakeAws>>;
beforeAll(async () => {
  b2 = await fakeAws("s3", "us-east-1", ({ method, path, headers, body }) => {
    if (failNext-- > 0) return { status: 500, body: Buffer.from("<Error><Code>InternalError</Code></Error>") };
    if (method === "PUT") {
      if (headers["content-md5"] !== createHash("md5").update(body).digest("base64")) return { status: 400, body: Buffer.from("<Error><Code>BadDigest</Code></Error>") };
      objects.set(path, { body, lock: headers["x-amz-object-lock-mode"], until: headers["x-amz-object-lock-retain-until-date"] });
      return {};
    }
    if (method === "DELETE") return objects.delete(path), { status: 204 };
    const found = objects.get(path);
    return found ? { body: found.body } : { status: 404, body: Buffer.from("<Error><Code>NoSuchKey</Code></Error>") };
  });
});
afterAll(() => b2.close());
afterEach(() => {
  objects.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const store = () => b2Store({ endpoint: b2.url, bucket: "orelu-workspace", credentials: testCredentials });

function memoryKeys(): KeyStore {
  const rows = new Map<string, Buffer>();
  return { read: async (firm) => rows.get(firm) ?? null, write: async (firm, wrapped) => (rows.set(firm, wrapped), true) };
}

describe("the B2 store", () => {
  it("saves into the one bucket, with a lock when asked, and reads it back", async () => {
    const until = new Date(Date.now() + 30 * DAY);
    await store().put("safety/f/d", Buffer.from("sealed bytes"), until);
    await store().put("tmp/f/t", Buffer.from("in transit"));
    expect(objects.get("/orelu-workspace/safety/f/d")).toMatchObject({ lock: "GOVERNANCE", until: until.toISOString() });
    expect(objects.get("/orelu-workspace/tmp/f/t")).toMatchObject({ lock: undefined });
    expect(Buffer.from((await store().get("safety/f/d"))!).toString()).toBe("sealed bytes");
    expect(await store().get("safety/f/none")).toBeNull();
  });

  it("tries once more when B2 fails, then says so", async () => {
    failNext = 1;
    await store().put("tmp/f/t", Buffer.from("x"));
    failNext = 2;
    await expect(store().get("tmp/f/t")).rejects.toThrow("The workspace store did not read: 500");
  });

  it("signs for the region in B2's endpoint", async () => {
    const scopes: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      scopes.push(`${url} ${(init.headers as Record<string, string>).authorization.split("/").slice(2, 4).join("/")}`);
      return new Response("");
    });
    await b2Store({ endpoint: "https://s3.us-west-004.backblazeb2.com", bucket: "b", credentials: testCredentials }).put("tmp/x", Buffer.from("x"));
    expect(scopes).toEqual(["https://s3.us-west-004.backblazeb2.com/b/tmp/x us-west-004/s3"]);
  });
});

describe("the local store for development and tests", () => {
  it("keeps files in its folder and nowhere else", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "inboxca-workspace-"));
    try {
      const local = localStore(root);
      await local.put("safety/f/d", Buffer.from("sealed"));
      expect(await readFile(path.join(root, "safety/f/d"), "utf8")).toBe("sealed");
      expect(Buffer.from((await local.get("safety/f/d"))!).toString()).toBe("sealed");
      expect(await local.get("safety/f/none")).toBeNull();
      await expect(local.put("../outside", Buffer.from("x"))).rejects.toThrow("outside the test store");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("which store this server uses", () => {
  it("is B2 with all four settings, else the test folder, else none", async () => {
    vi.stubEnv("WORKSPACE_LOCAL_DIR", "");
    for (const [name, value] of [["B2_ENDPOINT", "https://s3.eu-central-003.backblazeb2.com"], ["B2_KEY_ID", "invented"], ["B2_APPLICATION_KEY", "invented"]]) vi.stubEnv(name, value);
    vi.stubEnv("B2_WORKSPACE_BUCKET", "");
    expect(workspaceStore()).toBeNull();
    const root = await mkdtemp(path.join(tmpdir(), "inboxca-workspace-"));
    vi.stubEnv("WORKSPACE_LOCAL_DIR", root);
    await workspaceStore()!.put("tmp/x", Buffer.from("x"));
    expect(await readFile(path.join(root, "tmp/x"), "utf8")).toBe("x");
    await rm(root, { recursive: true, force: true });
    vi.stubEnv("B2_WORKSPACE_BUCKET", "orelu-workspace");
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (sent.push(url), new Response("")));
    await workspaceStore()!.put("tmp/x", Buffer.from("x"));
    expect(sent).toEqual(["https://s3.eu-central-003.backblazeb2.com/orelu-workspace/tmp/x"]);
  });
});

describe("safety copies", () => {
  const crypto = firmCrypto(localKek(randomBytes(32)), memoryKeys());

  it("are sealed with the firm's key, locked for 30 days, and open to the same bytes", async () => {
    const file = Buffer.concat([randomBytes((1 << 20) + 5), Buffer.from("PAN ABCDE1234F")]);
    expect(await keepSafetyCopy(FIRM, "doc-1", async () => file, store(), crypto)).toBe(true);
    const kept = objects.get(`/orelu-workspace/safety/${FIRM}/doc-1`)!;
    expect(kept.body.includes(Buffer.from("ABCDE1234F"))).toBe(false);
    expect(kept.lock).toBe("GOVERNANCE");
    expect(Math.round((Date.parse(kept.until!) - Date.now()) / DAY)).toBe(30);
    expect(Buffer.from((await openSafetyCopy(FIRM, "doc-1", store(), crypto))!).equals(file)).toBe(true);
    expect(await openSafetyCopy(FIRM, "doc-2", store(), crypto)).toBeNull();
  });

  it("do not open for another document or firm, or once changed", async () => {
    await keepSafetyCopy(FIRM, "doc-1", async () => Buffer.from("bank statement"), store(), crypto);
    const sealed = objects.get(`/orelu-workspace/safety/${FIRM}/doc-1`)!;
    objects.set(`/orelu-workspace/safety/${FIRM}/doc-2`, sealed);
    await expect(openSafetyCopy(FIRM, "doc-2", store(), crypto)).rejects.toThrow();
    objects.set("/orelu-workspace/safety/firm-b/doc-1", sealed);
    await expect(openSafetyCopy("firm-b", "doc-1", store(), crypto)).rejects.toThrow();
    sealed.body[sealed.body.length - 3] ^= 1;
    await expect(openSafetyCopy(FIRM, "doc-1", store(), crypto)).rejects.toThrow();
  });

  it("are not taken, and the file is not read, while the store is not set up", async () => {
    const read = vi.fn(async () => Buffer.from("x"));
    expect(await keepSafetyCopy(FIRM, "doc-1", read, null, crypto)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(await openSafetyCopy(FIRM, "doc-1", null, crypto)).toBeNull();
  });
});

describe("the text read from a paper (D29)", () => {
  const crypto = firmCrypto(localKek(randomBytes(32)), memoryKeys());

  it("is kept sealed, opens for that paper of that firm only, and goes with the paper", async () => {
    const details = { text: await keepText(FIRM, "doc-1", "Invented Traders PAN ABCDE1234F", store(), crypto) };
    expect(objects.get(`/orelu-workspace/text/${FIRM}/doc-1`)!.body.includes(Buffer.from("ABCDE1234F"))).toBe(false);
    expect(await openText(FIRM, "doc-1", details, store(), crypto)).toBe("Invented Traders PAN ABCDE1234F");
    await expect(openText("firm-b", "doc-1", details, store(), crypto)).rejects.toThrow();
    await expect(openText(FIRM, "doc-2", details, store(), crypto)).rejects.toThrow();
    await forgetText(details, store());
    expect(await openText(FIRM, "doc-1", details, store(), crypto)).toBeNull();
  });
});
