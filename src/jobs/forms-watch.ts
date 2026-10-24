import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Json } from "@/src/db/types";
import type { Handler } from "./runner";

// The daily check of official forms (PLAN.md D42, 5.7.3): public pages only, no sign in. Each
// source is fingerprinted; a change is recorded with the old and new fingerprints (and, for a
// downloads page, the links added and removed) as a draft for Orelu's admin, and a source that
// cannot be read two days running raises an alert. Nothing goes live here: a new version is
// added to the template library, with its mapping tested, before outputs use it.
export type Source = { key: string; name: string; url: string; kind: "file" | "page"; body?: string; known?: string };
export const sources: Source[] = [
  { key: "gst_offline_tool", name: "GST returns offline tool (GSTR-1 workbooks)", url: "https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip", kind: "file", known: "f0a7d6f66bf71b30e9ecd045a664dda428c8fac239f51127d656e6faac60e312" },
  { key: "gstr3b_utility", name: "GSTR-3B offline utility", url: "https://tutorial.gst.gov.in/offlineutilities/returns_gstr3b/GSTR3B_Excel_Utility.zip", kind: "file", known: "54e7a39b0d1db41cd726b93e14fce616695a2651cca633ed26124e8cc9211f03" },
  { key: "gstr3b_api_versions", name: "GSTN GSTR-3B schema versions", url: "https://developer.gst.gov.in/apiportal/getAPIVersion", kind: "file", body: '{"apiId":2269}', known: "e41b250dc9cd4e29552f902dab9a3c42f872450ca3026671fe9f73ad903eb570" },
  { key: "itr_downloads", name: "Income tax return schemas and utilities", url: "https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns", kind: "page" },
];

type Seen = { hash?: string; links?: string[]; failures?: number; checked?: string };
export type Watch = { sources: Record<string, Seen>; changes: Json[]; alerts: Json[] };
const LIMIT = 100 * 1024 * 1024;

// A file's SHA-256 read as it streams, or a page's list of schema, workbook and utility links.
async function fingerprint(source: Source, fetcher: typeof fetch) {
  const response = await fetcher(source.url, {
    method: source.body ? "POST" : "GET",
    headers: source.body ? { "Content-Type": "application/json" } : undefined,
    body: source.body,
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const hash = createHash("sha256"), reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > (source.kind === "page" ? 5 * 1024 * 1024 : LIMIT)) throw new Error("Too large");
    if (source.kind === "page") parts.push(value);
    else hash.update(value);
  }
  if (source.kind === "file") return { hash: hash.digest("hex") };
  const html = Buffer.concat(parts).toString("utf8");
  const links = [...new Set([...html.matchAll(/href="([^"]+\.(?:json|zip|xlsx?|xlsm))"/gi)].map(([, link]) => new URL(link, source.url).href))].sort();
  if (!links.length) throw new Error("No files listed");
  return { hash: createHash("sha256").update(links.join("\n")).digest("hex"), links };
}

// One day's check: the next state, given what was seen before. The first sight of a source with
// no recorded fingerprint becomes its baseline; a recorded one that differs is a change.
export async function checkSources(previous: Watch, now: Date, fetcher: typeof fetch = fetch, list = sources): Promise<Watch> {
  const next: Watch = { sources: { ...previous.sources }, changes: [...previous.changes], alerts: [...previous.alerts] };
  const at = now.toISOString();
  for (const source of list) {
    const seen = previous.sources[source.key] ?? {};
    try {
      const found = await fingerprint(source, fetcher);
      const before = seen.hash ?? source.known;
      if (before && before !== found.hash) {
        const added = found.links && seen.links ? found.links.filter((link) => !seen.links!.includes(link)) : [];
        const removed = found.links && seen.links ? seen.links.filter((link) => !found.links!.includes(link)) : [];
        next.changes.push({ source: source.key, name: source.name, url: source.url, at, from: before, to: found.hash, added, removed, status: "draft" });
      }
      next.sources[source.key] = { hash: found.hash, ...(found.links && { links: found.links }), failures: 0, checked: at };
    } catch (error) {
      const failures = (seen.failures ?? 0) + 1;
      next.sources[source.key] = { ...seen, failures, checked: at };
      // Two days running: the page has probably moved.
      if (failures === 2) next.alerts.push({ source: source.key, name: source.name, url: source.url, at, reason: error instanceof Error ? error.message.slice(0, 120) : "unreadable" });
    }
  }
  next.changes = next.changes.slice(-200);
  next.alerts = next.alerts.slice(-200);
  return next;
}

export const formsWatch: Handler = async () => {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("platform_settings").select("value").eq("key", "watch").maybeSingle();
  if (error) return { retry: "watch_not_read" };
  const previous = (data?.value ?? {}) as Partial<Watch>;
  const next = await checkSources({ sources: previous.sources ?? {}, changes: previous.changes ?? [], alerts: previous.alerts ?? [] }, new Date());
  const { error: saved } = await admin.from("platform_settings").upsert({ key: "watch", value: next as unknown as NonNullable<Json> });
  return saved ? { retry: "watch_not_saved" } : { done: true };
};
