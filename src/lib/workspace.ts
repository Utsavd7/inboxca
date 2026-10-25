import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { awsFetch, type AwsCredentials } from "./aws";
import { serverCrypto, type firmCrypto } from "./crypto";

// Orelu's workspace store (PLAN.md D12, 5.5.1): one private bucket on Backblaze B2, reached
// through its S3 API. Rules made once on the bucket keep its areas: tmp/ holds files in
// transit and empties after 24 hours; safety/ holds the 30-day safety copies, each locked
// against removal for 30 days, then removed. What goes in is sealed with the firm's key.
// Off until all four B2 settings are set; a folder on this computer in development and
// tests (WORKSPACE_LOCAL_DIR), which does not lock.
export interface WorkspaceStore {
  // lockedUntil: until then nobody can remove or replace it, InboxCA's own key included.
  put(key: string, body: Uint8Array, lockedUntil?: Date): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

// B2's S3 API, path style. The region is in B2's endpoint (s3.<region>.backblazeb2.com). The
// lock is governance mode: the app's key cannot lift it; only a separate key with B2's
// bypassGovernance right can, for a lawful erasure.
export function b2Store({ endpoint, bucket, credentials }: { endpoint: string; bucket: string; credentials: AwsCredentials }): WorkspaceStore {
  const scope = { service: "s3", region: /^s3\.([^.]+)\./.exec(new URL(endpoint).hostname)?.[1] ?? "us-east-1", credentials };
  const at = (key: string) => `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
  return {
    async put(key, body, lockedUntil) {
      const headers = {
        "content-md5": createHash("md5").update(body).digest("base64"),
        ...(lockedUntil && { "x-amz-object-lock-mode": "GOVERNANCE", "x-amz-object-lock-retain-until-date": lockedUntil.toISOString() }),
      };
      const response = await awsFetch("PUT", at(key), headers, body, scope);
      if (!response.ok) throw new Error(`The workspace store did not save: ${response.status}`);
    },
    async get(key) {
      const response = await awsFetch("GET", at(key), {}, "", scope);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`The workspace store did not read: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function localStore(root: string): WorkspaceStore {
  const file = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("outside the test store");
    return full;
  };
  return {
    async put(key, body) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), body);
    },
    get: (key) => readFile(file(key)).then((data) => new Uint8Array(data), (error) => {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }),
  };
}

// This server's store, or null when it is not set up yet.
export function workspaceStore(): WorkspaceStore | null {
  const { B2_ENDPOINT, B2_KEY_ID, B2_APPLICATION_KEY, B2_WORKSPACE_BUCKET, WORKSPACE_LOCAL_DIR } = process.env;
  if (B2_ENDPOINT && B2_KEY_ID && B2_APPLICATION_KEY && B2_WORKSPACE_BUCKET)
    return b2Store({ endpoint: B2_ENDPOINT, bucket: B2_WORKSPACE_BUCKET, credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APPLICATION_KEY } });
  return WORKSPACE_LOCAL_DIR ? localStore(WORKSPACE_LOCAL_DIR) : null;
}

// Orelu's safety copy of a file (5.5.1): taken before InboxCA removes or changes it, sealed
// with the firm's key in 1 MB chunks, locked for 30 days. Taken again (removed, put back,
// removed), the newest is what is read; an earlier locked copy still stays until its day.
const SAFETY_DAYS = 30;
const safetyKey = (firmId: string, documentId: string) => `safety/${firmId}/${documentId}`;
const place = (documentId: string) => `documents/${documentId}/safety_copy`;
async function* inChunks(bytes: Uint8Array, size = 1 << 20) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
async function joined(chunks: AsyncIterable<Buffer>) {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
}

// false when the store is not set up, and the file is not read.
export async function keepSafetyCopy(firmId: string, documentId: string, read: () => Promise<Uint8Array>, store = workspaceStore(), crypto?: ReturnType<typeof firmCrypto>) {
  if (!store) return false;
  const sealed = await joined((crypto ?? serverCrypto()).encryptChunks(firmId, place(documentId), inChunks(await read())));
  await store.put(safetyKey(firmId, documentId), sealed, new Date(Date.now() + SAFETY_DAYS * 86_400_000));
  return true;
}

export async function openSafetyCopy(firmId: string, documentId: string, store = workspaceStore(), crypto?: ReturnType<typeof firmCrypto>) {
  const sealed = await store?.get(safetyKey(firmId, documentId));
  return sealed ? joined((crypto ?? serverCrypto()).decryptChunks(firmId, place(documentId), inChunks(sealed))) : null;
}
