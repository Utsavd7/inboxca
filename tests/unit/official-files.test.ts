import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { linkAllowed, officialFile, officialLink, type Store } from "@/src/lib/official-files";
import * as worker from "../../worker/official";
import { resavedWorkbook, sha256, shippedWorkbook } from "../fixtures/official-copy";

// A template's official file: shipped in reference/official, else from the store by its hash,
// checked every time it is read, by the app and by the file worker.
const shipped = readFileSync(`reference/official/${shippedWorkbook}`), copy = resavedWorkbook();
const stored = "gstr1-v9.9/GSTR1_Excel_Workbook_Template_V9.9.xlsx";
const store = (files: Buffer[]): Store & { reads: string[] } => {
  const reads: string[] = [];
  return { reads, keep: async () => {}, read: async (hash) => (reads.push(hash), files.find((file) => sha256(file) === hash) ?? null) };
};
afterEach(() => vi.unstubAllEnvs());

it("reads a shipped file from reference/official and a stored one by its hash, and refuses either when the hash differs", async () => {
  expect(sha256(copy)).not.toBe(sha256(shipped));
  const files = store([copy]);
  expect((await officialFile(shippedWorkbook, sha256(shipped), files)).equals(shipped)).toBe(true);
  expect(files.reads).toEqual([]);
  expect((await officialFile(stored, sha256(copy), files)).equals(copy)).toBe(true);
  // A shipped file is never swapped for a stored one, whatever the hash asks for.
  await expect(officialFile(shippedWorkbook, sha256(copy), files)).rejects.toThrow("The official file changed");
  await expect(officialFile(stored, sha256(shipped), files)).rejects.toThrow("not in the store");
  await expect(officialFile(stored, sha256(copy), { ...files, read: async () => shipped })).rejects.toThrow("The official file changed");
  await expect(officialFile("../.env.local", sha256(copy), files)).rejects.toThrow("Unknown official file");
});

it("gives the file worker a signed link only for a file the app does not ship, for 75 seconds", async () => {
  vi.stubEnv("FILE_WORKER_SECRET", "invented-test-secret");
  vi.stubEnv("APP_BASE_URL", "https://app.invalid/");
  expect(await officialLink({ file: shippedWorkbook, sha256: sha256(shipped) })).toBeUndefined();
  const link = new URL((await officialLink({ file: stored, sha256: sha256(copy) }))!);
  expect(link.origin + link.pathname).toBe(`https://app.invalid/api/official/${sha256(copy)}`);
  const until = link.searchParams.get("until"), sig = link.searchParams.get("sig");
  expect(await linkAllowed(sha256(copy), until, sig)).toBe(true);
  expect(await linkAllowed(sha256(shipped), until, sig)).toBe(false);
  expect(await linkAllowed(sha256(copy), String(Number(until) + 1), sig)).toBe(false);
  expect(await linkAllowed(sha256(copy), until, sig, Number(until) + 1)).toBe(false);
  vi.stubEnv("FILE_WORKER_SECRET", "another-secret");
  expect(await linkAllowed(sha256(copy), until, sig)).toBe(false);
  vi.stubEnv("APP_BASE_URL", "");
  expect(await officialLink({ file: stored, sha256: sha256(copy) })).toBeUndefined();
});

it("lets the file worker read a shipped file, fetch a stored one once with its link, and refuse a copy that changed", async () => {
  const asked: string[] = [];
  const fetcher = (async (url: string) => (asked.push(url), new Response(url.endsWith("changed") ? new Uint8Array(shipped) : new Uint8Array(copy)))) as typeof fetch;
  expect(worker.officialFile(shippedWorkbook, sha256(shipped)).equals(shipped)).toBe(true);
  expect(() => worker.officialFile(shippedWorkbook, sha256(copy))).toThrow("The official file changed");
  expect(() => worker.officialFile(stored, sha256(copy))).toThrow("Unknown official file");
  // A shipped file is never fetched; a stored one is fetched once and its hash checked.
  await worker.fetchOfficial({ file: shippedWorkbook, sha256: sha256(shipped) }, "https://app.invalid/shipped", fetcher);
  await expect(worker.fetchOfficial({ file: stored, sha256: sha256(copy) }, "https://app.invalid/changed", fetcher)).rejects.toThrow("The official file changed");
  expect(() => worker.officialFile(stored, sha256(copy))).toThrow("Unknown official file");
  await worker.fetchOfficial({ file: stored, sha256: sha256(copy) }, "https://app.invalid/stored", fetcher);
  await worker.fetchOfficial({ file: stored, sha256: sha256(copy) }, "https://app.invalid/stored", fetcher);
  expect(asked).toEqual(["https://app.invalid/changed", "https://app.invalid/stored"]);
  expect(worker.officialFile(stored, sha256(copy)).equals(copy)).toBe(true);
  expect(() => worker.officialFile(stored, sha256(shipped))).toThrow("Unknown official file");
  expect(() => worker.officialFile("../package.json", sha256(copy))).toThrow("Unknown official file");
});
