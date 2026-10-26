import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Json } from "@/src/db/types";
import { officialFile, officialStore, type Store } from "@/src/lib/official-files";
import { layoutDifferences, schemaLayout, workbookLayout } from "@/src/lib/official-layout";
import { xlsxEntries } from "@/src/lib/sheet";
import { version, type Template } from "@/src/lib/templates";
import { cbicUpdates, efilingNews, gstNews, gstOfflineTools, itrDownloads, proteanDownloads, type Entry } from "./gov-pages";
import type { Handler } from "./runner";

// The daily check of official forms (PLAN.md D42, 5.7.3): public pages only, no sign in. Each
// source is fingerprinted; a change is recorded with the old and new fingerprints (and, for a
// downloads page, the links added and removed) as a draft for Orelu's admin, and a source that
// cannot be read two days running raises an alert. Nothing goes live here: Orelu's admin adds
// a new version to the template library (one with the same layout is kept in the store for
// that); one with a changed layout is mapped and tested first. Each source
// names the calendar's returns its forms are for, so the admin sees the firms a change touches,
// and its work area, so a firm sees what is new only for the work its clients have.
// A listing page is read for its entries; one not seen before is new from the government and
// shows on Today for 14 days. A page that refuses readers or shows nothing without its own app
// is "manual": never fetched, listed for people to look at themselves.
export type Area = "gst" | "income_tax" | "tds" | "company_law";
// An official file InboxCA fills, compared with the copy it fills today when a new one comes:
// the file inside the download, the form whose newest version it is set beside (or a fixed
// copy), and how many rows of each sheet hold headings.
type Compare = { file: RegExp; form?: string; current?: { file: string; version: string; sha256: string }; rows?: number };
export type Source = { key: string; name: string; url: string; area: Area; kind: "file" | "page" | "list" | "manual"; feed?: string; body?: string; known?: string; codes?: string[]; parse?: (text: string, url: string) => Entry[]; compare?: Compare };
export const sources: Source[] = [
  { key: "gst_offline_tool", name: "GST returns offline tool (GSTR-1 workbooks)", url: "https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip", area: "gst", kind: "file", known: "f0a7d6f66bf71b30e9ecd045a664dda428c8fac239f51127d656e6faac60e312", codes: ["GSTR1_M", "GSTR1_Q"], compare: { file: /GSTR1_Excel_Workbook_Template_V([\d.]+)\.xlsx$/i, form: "GSTR1", rows: 4 } },
  { key: "gstr3b_utility", name: "GSTR-3B offline utility", url: "https://tutorial.gst.gov.in/offlineutilities/returns_gstr3b/GSTR3B_Excel_Utility.zip", area: "gst", kind: "file", known: "54e7a39b0d1db41cd726b93e14fce616695a2651cca633ed26124e8cc9211f03", codes: ["GSTR3B_M", "GSTR3B_Q"], compare: { file: /GSTR3B_Excel_Utility_V([\d.]+)\.xlsm$/i, current: { file: "gstr3b-v5.8/GSTR3B_Excel_Utility_V5.8.xlsm", version: "5.8", sha256: "e7d2f3f5183d4275a4455b5385baffde47d87b364ccfff2b0cd9352b6051c3ce" }, rows: 200 } },
  { key: "gstr3b_api_versions", name: "GSTN GSTR-3B schema versions", url: "https://developer.gst.gov.in/apiportal/getAPIVersion", area: "gst", kind: "file", body: '{"apiId":2269}', known: "e41b250dc9cd4e29552f902dab9a3c42f872450ca3026671fe9f73ad903eb570", codes: ["GSTR3B_M", "GSTR3B_Q"] },
  { key: "itr_downloads", name: "Income tax return schemas and utilities", url: "https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns", area: "income_tax", kind: "page", codes: ["ITR_NA", "ITR_AUDIT"], parse: itrDownloads, compare: { file: /ITR-(\d)_\d{4}_Main_V([\d.]+)\.json$/i } },
  { key: "gst_news", name: "GST portal news", url: "https://www.gst.gov.in/newsandupdates", feed: "https://www.gst.gov.in/fomessage/newsupdates", area: "gst", kind: "list", parse: gstNews },
  { key: "gst_offline_tools", name: "GST portal offline tools", url: "https://www.gst.gov.in/download/returns", feed: "https://www.gst.gov.in/pages/common/menu.html", area: "gst", kind: "list", parse: gstOfflineTools },
  { key: "cbic_gst", name: "CBIC GST notifications and circulars", url: "https://taxinformation.cbic.gov.in/", feed: "https://taxinformation.cbic.gov.in/api/cbic-notification-msts/fetchUpdatesByTaxId/1000001", area: "gst", kind: "list", parse: cbicUpdates },
  { key: "efiling_news", name: "Income tax e-filing portal news", url: "https://www.incometax.gov.in/iec/foportal/latest-news", area: "income_tax", kind: "list", parse: efilingNews },
  { key: "itd_notifications", name: "Income Tax Department notifications and circulars", url: "https://www.incometaxindia.gov.in/", area: "income_tax", kind: "manual" },
  { key: "protean_etds", name: "Protean e-TDS utilities (RPU and FVU)", url: "https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html", area: "tds", kind: "list", parse: proteanDownloads },
  { key: "traces", name: "TRACES what's new", url: "https://traces.tdscpc.gov.in/", area: "tds", kind: "manual" },
  { key: "mca", name: "MCA news and forms", url: "https://www.mca.gov.in/", area: "company_law", kind: "manual" },
];

type Seen = { hash?: string; links?: string[]; entries?: string[]; failures?: number; checked?: string };
export type Watch = { sources: Record<string, Seen>; changes: Json[]; alerts: Json[]; items?: Json[] };
const LIMIT = 100 * 1024 * 1024;
const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

// A file's SHA-256 read as it streams (kept whole only when it is compared), or a page's list
// of schema, workbook and utility links, or a listing's entries.
async function fetchBody(url: string, fetcher: typeof fetch, limit: number, keep: boolean, body?: string) {
  const response = await fetcher(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body,
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
    if (size > limit) throw new Error("Too large");
    if (keep) parts.push(value);
    hash.update(value);
  }
  return { hash: hash.digest("hex"), bytes: Buffer.concat(parts) };
}

async function fingerprint(source: Source, fetcher: typeof fetch) {
  const read = await fetchBody(source.feed ?? source.url, fetcher, source.kind === "file" ? LIMIT : 5 * 1024 * 1024, source.kind !== "file" || !!source.compare, source.body);
  if (source.kind === "file") return { hash: read.hash, bytes: read.bytes };
  const html = read.bytes.toString("utf8");
  const entries = source.parse?.(html, source.url).map((entry) => ({ ...entry, id: sha(`${source.key}\n${entry.title}\n${entry.link}`).slice(0, 16) }));
  if (source.kind === "list") return { hash: sha((entries ?? []).map((entry) => entry.id).join("\n")), entries };
  const links = [...new Set([...html.matchAll(/href="([^"]+\.(?:json|zip|xlsx?|xlsm))"/gi)].map(([, link]) => new URL(link, source.url).href))].sort();
  if (!links.length) throw new Error("No files listed");
  return { hash: sha(links.join("\n")), links, entries };
}

// A new official file set beside the copy InboxCA fills today: the same layout, or the sheets,
// headings or schema fields that differ. The file is only read, never run. A same layout file
// of a form InboxCA fills, in a version it does not have, is kept in the store with the version
// it would become (its official link, and a name beside the one it matches), for Orelu's admin
// to use from a period.
async function compareFile(compare: Compare, name: string, bytes: Buffer, templates: Template[], url: string, store: Store) {
  const form = compare.form ?? `ITR${compare.file.exec(name)?.[1]}`;
  const newest = templates.filter((template) => template.form_code === form && template.status !== "draft").sort((a, b) => version(a.version, b.version))[0];
  const current = compare.current ?? (newest && { file: newest.source.file, version: newest.version, sha256: newest.source.sha256 });
  if (!current) return { file: name, error: "No current version to compare with" };
  try {
    // A zip holds the workbooks: the newest one inside is the one to compare.
    const inside = name.endsWith(".zip") ? [...xlsxEntries(bytes)].filter(([path]) => compare.file.test(path)).sort(([a], [b]) => version(compare.file.exec(a)!.at(-1)!, compare.file.exec(b)!.at(-1)!))[0] : null;
    if (name.endsWith(".zip") && !inside) throw new Error("The download no longer holds the form");
    const file = inside ? inside[1]() : bytes, found = inside?.[0].split("/").pop() ?? name;
    const layout = (data: Buffer) => (/\.json$/i.test(current.file) ? schemaLayout(JSON.parse(data.toString("utf8"))) : workbookLayout(data, compare.rows));
    const differences = layoutDifferences(layout(await officialFile(current.file, current.sha256, store)), layout(file));
    if (differences.length) return { file: found, with: current.version, differences: differences.slice(0, 40), more: Math.max(0, differences.length - 40) };
    const next = compare.file.exec(found)?.at(-1) ?? "";
    if (compare.current || !/^\d+(\.\d+){0,3}$/.test(next) || sha(file) === current.sha256 || templates.some((template) => template.form_code === form && template.version === next)) return { file: found, with: current.version, same: true };
    await store.keep(file);
    return { file: found, with: current.version, same: true, template: { form_code: form, version: next, source: { file: `${dirname(current.file).replace(/-v[\d.]+$/, `-v${next}`)}/${found}`, url, sha256: sha(file) } } };
  } catch (error) {
    return { file: name, with: current.version, error: error instanceof Error ? error.message.slice(0, 120) : "unreadable" };
  }
}

// One day's check: the next state, given what was seen before. The first sight of a source with
// no recorded fingerprint becomes its baseline; a recorded one that differs is a change. Entries
// are new only once a source has a baseline, so the first day announces nothing.
export async function checkSources(previous: Watch, now: Date, fetcher: typeof fetch = fetch, list = sources, templates: Template[] = [], store: Store = officialStore()): Promise<Watch> {
  const next: Watch = { sources: { ...previous.sources }, changes: [...previous.changes], alerts: [...previous.alerts], items: [...(previous.items ?? [])] };
  const at = now.toISOString(), day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  for (const source of list) {
    if (source.kind === "manual") continue;
    const seen = previous.sources[source.key] ?? {};
    try {
      const found = await fingerprint(source, fetcher);
      const before = seen.hash ?? source.known;
      if (source.kind !== "list" && before && before !== found.hash) {
        const added = found.links && seen.links ? found.links.filter((link) => !seen.links!.includes(link)) : [];
        const removed = found.links && seen.links ? seen.links.filter((link) => !found.links!.includes(link)) : [];
        const compared = !source.compare ? [] : source.kind === "file" ? [await compareFile(source.compare, source.url.split("/").pop()!, found.bytes!, templates, source.url, store)]
          : await Promise.all(added.filter((link) => source.compare!.file.test(link)).map((link) => fetchBody(link, fetcher, LIMIT, true).then((file) => compareFile(source.compare!, decodeURIComponent(link.split("/").pop()!), file.bytes, templates, link, store), (error: Error) => ({ file: link, error: error.message.slice(0, 120) }))));
        next.changes.push({ source: source.key, name: source.name, url: source.url, at, from: before, to: found.hash, added, removed, status: "draft", ...(compared.length ? { compared } : {}) });
      }
      const known = new Set(seen.entries ?? []);
      if (seen.entries) for (const { id, title, date, link } of found.entries ?? []) if (!known.has(id)) next.items!.push({ id, source: source.key, area: source.area, title, ...(date ? { date } : {}), link, seen: day });
      next.sources[source.key] = { hash: found.hash, ...(found.links && { links: found.links }), ...(found.entries && { entries: [...new Set([...known, ...found.entries.map((entry) => entry.id)])].slice(-500) }), failures: 0, checked: at };
    } catch (error) {
      const failures = (seen.failures ?? 0) + 1;
      next.sources[source.key] = { ...seen, failures, checked: at };
      // Two days running: the page has probably moved. A refused connection says why (its cause).
      const reason = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : "unreadable";
      if (failures === 2) next.alerts.push({ source: source.key, name: source.name, url: source.url, at, reason: String(reason).slice(0, 120) });
    }
  }
  next.changes = next.changes.slice(-200);
  next.alerts = next.alerts.slice(-200);
  next.items = next.items!.slice(-300);
  return next;
}

export const formsWatch: Handler = async () => {
  const admin = supabaseAdmin();
  const [{ data, error }, { data: templates }] = await Promise.all([admin.from("platform_settings").select("value").eq("key", "watch").maybeSingle(), admin.from("templates").select("*")]);
  if (error) return { retry: "watch_not_read" };
  const previous = (data?.value ?? {}) as Partial<Watch>;
  const next = await checkSources({ sources: previous.sources ?? {}, changes: previous.changes ?? [], alerts: previous.alerts ?? [], items: previous.items ?? [] }, new Date(), fetch, sources, (templates ?? []) as Template[], officialStore());
  const { error: saved } = await admin.from("platform_settings").upsert({ key: "watch", value: next as unknown as NonNullable<Json> });
  return saved ? { retry: "watch_not_saved" } : { done: true };
};
