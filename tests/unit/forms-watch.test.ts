import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

// Reads files and runs the worker: slow under load, so longer than the 5 second default.
vi.setConfig({ testTimeout: 30_000 });
import { checkLive, checkSources, type Source, type Watch } from "@/src/jobs/forms-watch";
import { handle } from "@/worker/handler";
import { gstNews } from "@/src/jobs/gov-pages";
import { zip } from "@/src/lib/firm-download";
import type { Template } from "@/src/lib/templates";
import { resavedWorkbook, sha256 } from "../fixtures/official-copy";

// A stand-in for the official sites: each address answers with whatever the test sets.
const pages = new Map<string, string | Uint8Array<ArrayBuffer> | null>();
const fetcher = (async (url: string | URL | Request) => {
  const body = pages.get(String(url));
  return body === null || body === undefined ? new Response("gone", { status: 404 }) : new Response(body);
}) as typeof fetch;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const list: Source[] = [
  { key: "tool", name: "Invented offline tool", url: "https://official.invalid/tool.zip", area: "gst", kind: "file", known: sha("tool v1") },
  { key: "downloads", name: "Invented downloads page", url: "https://official.invalid/downloads", area: "income_tax", kind: "page" },
];
const empty: Watch = { sources: {}, changes: [], alerts: [] };
const day = (n: number) => new Date(Date.UTC(2026, 9, 24 + n));

it("records a changed official file or downloads page as a draft, and alerts on a source unreadable two days running", async () => {
  pages.set(list[0].url, "tool v1");
  pages.set(list[1].url, '<a href="/files/ITR-1_V1.1.json">ITR-1</a><a href="/files/ITR4.zip">ITR-4</a><a href="/about">About</a>');
  // First day: the recorded file matches, and the page becomes its own baseline.
  let watch = await checkSources(empty, day(0), fetcher, list);
  expect(watch.changes).toEqual([]);
  expect(watch.sources.downloads.links).toEqual(["https://official.invalid/files/ITR-1_V1.1.json", "https://official.invalid/files/ITR4.zip"]);
  // An unchanged day records nothing new.
  watch = await checkSources(watch, day(1), fetcher, list);
  expect(watch.changes).toEqual([]);
  // A new utility and a new schema link are drafts for Orelu's admin.
  pages.set(list[0].url, "tool v2");
  pages.set(list[1].url, '<a href="/files/ITR-1_V1.2.json">ITR-1</a><a href="/files/ITR4.zip">ITR-4</a>');
  watch = await checkSources(watch, day(2), fetcher, list);
  expect(watch.changes).toMatchObject([
    { source: "tool", from: sha("tool v1"), to: sha("tool v2"), status: "draft" },
    { source: "downloads", added: ["https://official.invalid/files/ITR-1_V1.2.json"], removed: ["https://official.invalid/files/ITR-1_V1.1.json"] },
  ]);
  // One bad day is not an alert; the second running is.
  pages.set(list[0].url, null);
  watch = await checkSources(watch, day(3), fetcher, list);
  expect(watch.alerts).toEqual([]);
  watch = await checkSources(watch, day(4), fetcher, list);
  expect(watch.alerts).toMatchObject([{ source: "tool", reason: "HTTP 404" }]);
  expect(watch.sources.tool.hash).toBe(sha("tool v2"));
});

it("announces a listing's new entries from its second day, seen on India's date, and never reads a page marked manual", async () => {
  const news: Source = { key: "news", name: "Invented news", url: "https://official.invalid/news", feed: "https://official.invalid/news.json", area: "gst", kind: "list", parse: gstNews };
  const blocked: Source = { key: "blocked", name: "Invented blocked page", url: "https://blocked.invalid/", area: "tds", kind: "manual" };
  const feed = (...rows: [number, string][]) => JSON.stringify({ data: rows.map(([id, title]) => ({ id, title, date: "16/10/2026" })) });
  pages.set(news.feed!, feed([1, "Invented old advisory"]));
  // The check runs at 08:30 in India, 03:00 UTC. The first day is the baseline.
  let watch = await checkSources(empty, new Date("2026-10-25T03:00:00Z"), fetcher, [news, blocked]);
  expect(watch.items).toEqual([]);
  expect(watch.sources.blocked).toBeUndefined();
  // 01:30 on 26 Oct in India: an entry not seen before is new, with the date as published.
  pages.set(news.feed!, feed([2, "Invented new form GSTR-99"], [1, "Invented old advisory"]));
  watch = await checkSources(watch, new Date("2026-10-25T20:00:00Z"), fetcher, [news, blocked]);
  expect(watch.items).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{16}$/), source: "news", area: "gst", title: "Invented new form GSTR-99", date: "2026-10-16", link: "https://www.gst.gov.in/newsandupdates/read/2", seen: "2026-10-26" }]);
  expect(watch.changes).toEqual([]);
  // Once seen, never new again, even after it leaves the page and comes back.
  pages.set(news.feed!, feed([1, "Invented old advisory"]));
  watch = await checkSources(watch, day(3), fetcher, [news]);
  pages.set(news.feed!, feed([2, "Invented new form GSTR-99"], [1, "Invented old advisory"]));
  watch = await checkSources(watch, day(4), fetcher, [news]);
  expect(watch.items).toHaveLength(1);
  // A page that changed shape is an alert on its second day, never a guess.
  pages.set(news.feed!, "<html>Under maintenance</html>");
  watch = await checkSources(watch, day(5), fetcher, [news]);
  watch = await checkSources(watch, day(6), fetcher, [news]);
  expect(watch.alerts).toMatchObject([{ source: "news" }]);
  expect(watch.items).toHaveLength(1);
});

it("reads only the official sites over https: a plain http source, or a redirect off them, is a failed read, never a change", async () => {
  const elsewhere: Source = { key: "elsewhere", name: "Invented unsecured copy", url: "http://official.invalid/tool.zip", area: "gst", kind: "file", known: sha("tool v1") };
  const moved: Source = { key: "moved", name: "Invented moved page", url: "https://official.invalid/moved", area: "gst", kind: "page" };
  pages.set(elsewhere.url, "tool v2");
  const redirecting = (async (url: string | URL | Request) =>
    String(url) === moved.url ? new Response(null, { status: 302, headers: { location: "https://mirror.invalid/moved" } }) : fetcher(url)) as typeof fetch;
  let watch = await checkSources(empty, day(0), redirecting, [elsewhere, moved]);
  watch = await checkSources(watch, day(1), redirecting, [elsewhere, moved]);
  expect(watch.changes).toEqual([]);
  expect(watch.alerts).toMatchObject([{ source: "elsewhere", reason: "Outside the official sites" }, { source: "moved", reason: "Outside the official sites" }]);
});

// The official files InboxCA fills, from reference/official, set beside what a new download holds.
const official = (file: string) => new Uint8Array(readFileSync(`reference/official/${file}`));
const templates = JSON.parse(readFileSync("reference/official/templates.json", "utf8")) as Template[];

it("compares a new GSTR-1 download with the workbook InboxCA fills: the same layout, or the sheets and headings that differ", async () => {
  const tool: Source = { key: "tool", name: "Invented offline tool", url: "https://official.invalid/tool.zip", area: "gst", kind: "file", known: sha("before"), compare: { file: /GSTR1_Excel_Workbook_Template_V([\d.]+)\.xlsx$/i, form: "GSTR1", rows: 4 } };
  const older = official("gstr1-v2.0/GSTR1_Excel_Workbook_Template_V2.0.xlsx");
  // The newest workbook inside the download is the one compared.
  pages.set(tool.url, new Uint8Array(zip([{ name: "Readme.txt", text: "Invented" }, { name: "GSTR1_Excel_Workbook_Template_V2.0.xlsx", text: older }, { name: "GSTR1_Excel_Workbook_Template_V2.2.xlsx", text: official("gstr1-v2.2/GSTR1_Excel_Workbook_Template_V2.2.xlsx") }])));
  let watch = await checkSources(empty, day(0), fetcher, [tool], templates);
  expect(watch.changes).toMatchObject([{ source: "tool", status: "draft", compared: [{ file: "GSTR1_Excel_Workbook_Template_V2.2.xlsx", with: "2.2", same: true }] }]);
  pages.set(tool.url, new Uint8Array(zip([{ name: "GSTR1_Excel_Workbook_Template_V2.0.xlsx", text: older }])));
  watch = await checkSources(watch, day(1), fetcher, [tool], templates);
  const [, { compared: [different] }] = watch.changes as { compared: { file: string; with: string; differences: string[] }[] }[];
  expect(different).toMatchObject({ file: "GSTR1_Excel_Workbook_Template_V2.0.xlsx", with: "2.2" });
  expect(different.differences).toContain("Sheet added: hsn");
  // A download that no longer holds the workbook says so.
  pages.set(tool.url, new Uint8Array(zip([{ name: "Readme.txt", text: "Moved" }])));
  watch = await checkSources(watch, day(2), fetcher, [tool], templates);
  expect(watch.changes.at(-1)).toMatchObject({ compared: [{ with: "2.2", error: "The download no longer holds the form" }] });
});

it("compares a new ITR schema on the downloads page with the one InboxCA fills, field by field", async () => {
  const downloads: Source = { key: "itr", name: "Invented downloads", url: "https://official.invalid/itr", area: "income_tax", kind: "page", compare: { file: /ITR-(\d)_\d{4}_Main_V([\d.]+)\.json$/i } };
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.1.json">Schema</a>');
  let watch = await checkSources(empty, day(0), fetcher, [downloads], templates);
  const schema = JSON.parse(readFileSync("reference/official/itr/ITR-1_2026_Main_V1.1.json", "utf8"));
  delete schema.definitions.CreationInfo.properties.IntermediaryCity;
  pages.set("https://official.invalid/f/ITR-1_2026_Main_V1.2.json", JSON.stringify(schema));
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.2.json">Schema</a><a href="/f/ITR-4_2026_Main_V1.1.json">Schema</a>');
  pages.set("https://official.invalid/f/ITR-4_2026_Main_V1.1.json", official("itr/ITR-4_2026_Main_V1.1.json"));
  watch = await checkSources(watch, day(1), fetcher, [downloads], templates);
  expect(watch.changes).toMatchObject([{ source: "itr", compared: [
    { file: "ITR-1_2026_Main_V1.2.json", with: "1.1", differences: ["Field removed: ITR.ITR1.CreationInfo.IntermediaryCity"], more: 0 },
    { file: "ITR-4_2026_Main_V1.1.json", with: "1.1", same: true },
  ] }]);
});

// A same layout file in a newer version InboxCA does not have is kept in the store, with the
// version it would become, and goes live by itself (forms_go_live); a changed layout never is.
it("keeps a same layout file of a new version in the store with the version it would become, and compares the next with it", async () => {
  const kept: Buffer[] = [];
  const store = { keep: async (bytes: Buffer) => void kept.push(bytes), read: async (hash: string) => kept.find((file) => sha256(file) === hash) ?? null };
  const tool: Source = { key: "tool", name: "Invented offline tool", url: "https://official.invalid/tool.zip", area: "gst", kind: "file", known: sha("before"), compare: { file: /GSTR1_Excel_Workbook_Template_V([\d.]+)\.xlsx$/i, form: "GSTR1", rows: 4 } };
  const copy = resavedWorkbook();
  pages.set(tool.url, new Uint8Array(zip([{ name: "GSTR1_Excel_Workbook_Template_V9.9.xlsx", text: copy }])));
  let watch = await checkSources(empty, day(0), fetcher, [tool], templates, store);
  const next = { form_code: "GSTR1", version: "9.9", source: { file: "gstr1-v9.9/GSTR1_Excel_Workbook_Template_V9.9.xlsx", url: tool.url, sha256: sha256(copy) } };
  expect(watch.changes).toMatchObject([{ compared: [{ file: "GSTR1_Excel_Workbook_Template_V9.9.xlsx", with: "2.2", same: true, live: true, template: next }] }]);
  expect(kept.map(sha256)).toEqual([sha256(copy)]);
  // Once in use, the next download is set beside it, read from the store; a changed layout is not kept.
  const used = [...templates, { ...templates.find((row) => row.version === "2.2")!, ...next, valid_from: "2099-01-01" }];
  pages.set(tool.url, new Uint8Array(zip([{ name: "GSTR1_Excel_Workbook_Template_V9.10.xlsx", text: official("gstr1-v2.0/GSTR1_Excel_Workbook_Template_V2.0.xlsx") }])));
  watch = await checkSources(watch, day(1), fetcher, [tool], used, store);
  const [, { compared: [different] }] = watch.changes as { compared: { with: string; differences: string[]; template?: object }[] }[];
  expect(different).toMatchObject({ with: "9.9", differences: expect.arrayContaining(["Sheet added: hsn"]) });
  expect(different.template).toBeUndefined();
  expect(kept).toHaveLength(1);
  // The same file again, or one in a version already listed, is not new.
  pages.set(tool.url, new Uint8Array(zip([{ name: "GSTR1_Excel_Workbook_Template_V9.9.xlsx", text: copy }])));
  watch = await checkSources(watch, day(2), fetcher, [tool], used, store);
  expect(watch.changes.at(-1)).toMatchObject({ compared: [{ with: "9.9", same: true }] });
  expect((watch.changes.at(-1) as { compared: { template?: object }[] }).compared[0].template).toBeUndefined();
}, 30_000); // Three 7 MB workbooks are read; a busy machine needs more than 5 seconds.

it("keeps a same layout ITR schema of a new version under its own link", async () => {
  const kept: Buffer[] = [];
  const store = { keep: async (bytes: Buffer) => void kept.push(bytes), read: async () => null };
  const downloads: Source = { key: "itr", name: "Invented downloads", url: "https://official.invalid/itr", area: "income_tax", kind: "page", compare: { file: /ITR-(\d)_\d{4}_Main_V([\d.]+)\.json$/i } };
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.1.json">Schema</a>');
  let watch = await checkSources(empty, day(0), fetcher, [downloads], templates, store);
  // The same schema written on one line: the same fields, a different hash.
  const schema = Buffer.from(JSON.stringify(JSON.parse(readFileSync("reference/official/itr/ITR-1_2026_Main_V1.1.json", "utf8"))));
  pages.set("https://official.invalid/f/ITR-1_2026_Main_V1.3.json", new Uint8Array(schema));
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.3.json">Schema</a>');
  watch = await checkSources(watch, day(1), fetcher, [downloads], templates, store);
  expect(watch.changes).toMatchObject([{ compared: [{ file: "ITR-1_2026_Main_V1.3.json", with: "1.1", same: true, live: true, template: { form_code: "ITR1", version: "1.3", source: { file: "itr/ITR-1_2026_Main_V1.3.json", url: "https://official.invalid/f/ITR-1_2026_Main_V1.3.json", sha256: sha256(schema) } } }] }]);
  expect(kept.map(sha256)).toEqual([sha256(schema)]);
  // One whose name is for another year never goes live, and is marked for the admin to confirm.
  pages.set("https://official.invalid/f/ITR-1_2027_Main_V1.4.json", new Uint8Array(schema));
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.3.json">Schema</a><a href="/f/ITR-1_2027_Main_V1.4.json">Schema</a>');
  watch = await checkSources(watch, day(2), fetcher, [downloads], templates, store);
  const [other] = (watch.changes.at(-1) as { compared: { live?: true; renamed?: true; template?: { version: string } }[] }).compared;
  expect(other).toMatchObject({ renamed: true, template: { version: "1.4" } });
  expect(other.live).toBeUndefined();
  // Next year's schema may start again at a version number this year's already has; it is still offered.
  pages.set("https://official.invalid/f/ITR-1_2027_Main_V1.1.json", new Uint8Array(schema));
  pages.set(downloads.url, '<a href="/f/ITR-1_2026_Main_V1.3.json">Schema</a><a href="/f/ITR-1_2027_Main_V1.1.json">Schema</a>');
  watch = await checkSources(watch, day(3), fetcher, [downloads], templates, store);
  const [again] = (watch.changes.at(-1) as { compared: { file: string; renamed?: true; template?: { version: string } }[] }).compared;
  expect(again).toMatchObject({ file: "ITR-1_2027_Main_V1.1.json", renamed: true, template: { version: "1.1" } });
});

// Before going live by itself, the file worker makes InboxCA's own returns with the new version
// (it fetches the kept file from the app by a signed link); one that fails a check stays a draft.
it("goes live by itself only when InboxCA's own returns pass every official check with the new file", async () => {
  const kept = new Map<string, Buffer>(), at = "2026-10-26T03:00:00.000Z";
  const live = (file: string, bytes: Buffer, form: string, version: string, current: string) => {
    kept.set(sha256(bytes), bytes);
    return { file: file.split("/").pop()!, with: current, same: true, live: true, template: { form_code: form, version, source: { file, url: "https://official.invalid/f", sha256: sha256(bytes) } } };
  };
  // The ITR-1 schema written on one line, and again with a tighter rule on a field it has.
  const schema = JSON.parse(readFileSync("reference/official/itr/ITR-1_2026_Main_V1.1.json", "utf8")), same = Buffer.from(JSON.stringify(schema));
  schema.definitions.Address.properties.EmailAddress.maxLength = 10;
  const watch: Watch = { sources: {}, alerts: [], changes: [{ source: "tool", at, compared: [
    live("gstr1-v9.9/GSTR1_Excel_Workbook_Template_V9.9.xlsx", resavedWorkbook(), "GSTR1", "9.9", "2.2"),
    live("itr/ITR-1_2026_Main_V1.3.json", same, "ITR1", "1.3", "1.1"),
    live("itr/ITR-1_2026_Main_V1.4.json", Buffer.from(JSON.stringify(schema)), "ITR1", "1.4", "1.1"),
  ] }] };
  vi.stubEnv("FILE_WORKER_URL", "http://worker");
  vi.stubEnv("FILE_WORKER_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("APP_BASE_URL", "http://app");
  const fetched = globalThis.fetch;
  const worker = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const address = String(url), file = kept.get(/^http:\/\/app\/api\/official\/([a-f0-9]{64})\?/.exec(address)?.[1] ?? "");
    if (address.startsWith("http://worker/")) return handle(new Request(address, { ...init, duplex: "half" } as RequestInit));
    return file ? new Response(new Uint8Array(file)) : fetched(url, init);
  });
  try {
    await checkLive(watch, at, templates);
  } finally {
    worker.mockRestore();
    vi.unstubAllEnvs();
  }
  const [gst, itr, stricter] = (watch.changes[0] as { compared: { live?: true; failed?: string }[] }).compared;
  expect([gst, itr]).toEqual([expect.objectContaining({ live: true }), expect.objectContaining({ live: true })]);
  expect(gst.failed ?? itr.failed).toBeUndefined();
  expect(stricter.live).toBeUndefined();
  expect(stricter.failed).toMatch(/10 characters/);
}, 60_000); // A 7 MB workbook is filled.

// Protean's Form No. 140 format, as an invented workbook laid out like the official one (its
// records' fields and annexures' codes), built from the layout InboxCA writes the statement to.
// Forms No. 138, 144 and 143 lay some annexures out otherwise: a reason with whether it needs a
// PAN, a reason with a row of codes, a remittance code with its section.
const formatBook = (layout: Record<string, string[]>, payee = "Deductee") => {
  const titles: Record<string, string> = { FH: "File Header", BH: "Batch Header", CD: "Challan Detail", DD: `${payee} Detail` };
  const row = (cells: string[]) => `<row>${cells.map((value, at) => value && `<c r="${"ABCDEFG"[at]}1" t="inlineStr"><is><t>${value.replace(/&/g, "&amp;")}</t></is></c>`).join("")}</row>`;
  const rows = Object.entries(layout).flatMap(([key, entries]) => [
    row(["", titles[key] ? `Invented statement (${titles[key]} Record)` : `${key.replace(" ", " - ")}`]),
    ...entries.map((entry) => { const [a, b, c, d] = entry.split(" "); return row(titles[key] ? [a, "Field", "", b, c, d] : key === "Annexure 2" ? ["", "Payment", "Section", a] : key === "Annexure 6" ? (/^\d{4}$/.test(b) ? ["", a, "Section", b] : ["", "Reason", a, b]) : key === "Annexure 9" ? ["", "Nature", a, b] : ["", "Name", a]); }),
  ]);
  return zip([{ name: "xl/worksheets/sheet1.xml", text: `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>` }]);
};

it("watches the Form No. 140 format by its entry on Protean's page: a same layout version goes live, a changed one lists its differences", async () => {
  const { form140Layout } = await import("@/src/lib/tds");
  const { proteanDownloads } = await import("@/src/jobs/gov-pages");
  const base = formatBook(form140Layout), kept: Buffer[] = [];
  const store = { keep: async (bytes: Buffer) => void kept.push(bytes), read: async (hash: string) => kept.find((file) => sha256(file) === hash) ?? null };
  const page = (name: string, version: string) => `<section class="main-content-area"><a href="/f/${encodeURIComponent(name)}">File Format for Form Number 140 Q1 to Q4 Version ${version}</a></section>`;
  const format: Source = { key: "f140", name: "Invented format", url: "https://official.invalid/etds", area: "tds", kind: "file", known: sha256(base), parse: proteanDownloads, entry: /^File Format for Form Number 140\b.*\bVersion ([\d.]+)/i, compare: { file: /\.xlsx$/i, form: "TDS140", layout: { of: (await import("@/src/lib/official-layout")).tdsFormatLayout, expected: form140Layout } } };
  pages.set(format.url, page("Form Number 140 - Q1 to Q4_22072026.xlsx", "1.2"));pages.set("https://official.invalid/f/Form%20Number%20140%20-%20Q1%20to%20Q4_22072026.xlsx", new Uint8Array(base));
  let watch = await checkSources(empty, day(0), fetcher, [format], templates, store);
  expect(watch.changes).toEqual([]);
  // A newer version under a new name, the same layout: kept, and goes live by itself.
  const again = formatBook({ ...form140Layout, FH: [...form140Layout.FH].reverse() });
  pages.set(format.url, page("Form Number 140 - Q1 to Q4_15102026.xlsx", "1.3"));pages.set("https://official.invalid/f/Form%20Number%20140%20-%20Q1%20to%20Q4_15102026.xlsx", new Uint8Array(again));
  watch = await checkSources(watch, day(1), fetcher, [format], templates, store);
  expect(watch.changes).toMatchObject([{ source: "f140", compared: [{ file: "Form Number 140 - Q1 to Q4_15102026.xlsx", with: "1.2", same: true, live: true, template: { form_code: "TDS140", version: "1.3", source: { file: "protean/Form_Number_140_-_Q1_to_Q4_15102026.xlsx", sha256: sha256(again) } } }] }]);
  expect(kept).toHaveLength(1);
  await checkLive(watch, day(1).toISOString(), templates);
  expect((watch.changes[0] as { compared: { live?: true }[] }).compared[0].live).toBe(true);
  // A changed field size and a new section code are listed for Orelu's admin, never live.
  const changed = formatBook({ ...form140Layout, DD: form140Layout.DD.map((field) => (field === "28 DECIMAL 7 M" ? "28 DECIMAL 8 M" : field)), "Annexure 2": [...form140Layout["Annexure 2"], "1099"] });
  pages.set(format.url, page("Form Number 140 - Q1 to Q4_01122026.xlsx", "1.4"));pages.set("https://official.invalid/f/Form%20Number%20140%20-%20Q1%20to%20Q4_01122026.xlsx", new Uint8Array(changed));
  watch = await checkSources(watch, day(2), fetcher, [format], templates, store);
  expect(watch.changes.at(-1)).toMatchObject({ compared: [{ with: "1.2", differences: ["In DD, heading added: 28 DECIMAL 8 M", "In DD, heading removed: 28 DECIMAL 7 M", "In Annexure 2, heading added: 1099"] }] });
  expect((watch.changes.at(-1) as { compared: { live?: true }[] }).compared[0].live).toBeUndefined();
});

it("shows the Form No. 138 Q4 format as new from the government once Protean links it", async () => {
  const { proteanDownloads } = await import("@/src/jobs/gov-pages");
  const etds: Source = { key: "etds", name: "Invented e-TDS downloads", url: "https://official.invalid/etds-list", area: "tds", kind: "list", parse: proteanDownloads };
  pages.set(etds.url, '<section class="main-content-area"><a href="#">File Format for Form Number 138 Q4 Version 1.0 (Expected to be released soon.)</a></section>');
  let watch = await checkSources(empty, day(0), fetcher, [etds]);
  watch = await checkSources(watch, day(1), fetcher, [etds]);
  expect(watch.items).toEqual([]);
  pages.set(etds.url, '<section class="main-content-area"><a href="/f/Form%20Number%20138-24Q%20-%20Q4.xlsx">File Format for Form Number 138 Q4 Version 1.0</a></section>');
  watch = await checkSources(watch, day(2), fetcher, [etds]);
  expect(watch.items).toMatchObject([{ source: "etds", area: "tds", title: "File Format for Form Number 138 Q4 Version 1.0", link: "https://official.invalid/f/Form%20Number%20138-24Q%20-%20Q4.xlsx" }]);
});

it("watches the Forms No. 138, 144 and 143 formats each by its own entry and layout; the Form No. 138 Q4 entry is not taken for Q1 to Q3", async () => {
  const { sources } = await import("@/src/jobs/forms-watch");
  const { tdsLayouts } = await import("@/src/lib/tds");
  const { proteanDownloads } = await import("@/src/jobs/gov-pages");
  const watched = sources.filter((source) => ["protean_form138", "protean_form144", "protean_form143"].includes(source.key));
  expect(watched.map((source) => [source.key, source.compare?.form, source.codes])).toEqual([["protean_form138", "TDS138", ["TDS_RET"]], ["protean_form144", "TDS144", ["TDS_RET"]], ["protean_form143", "TDS143", ["TCS_RET"]]]);
  const kept: Buffer[] = [], store = { keep: async (bytes: Buffer) => void kept.push(bytes), read: async (hash: string) => kept.find((file) => sha256(file) === hash) ?? null };
  const url = watched[0].url, link = (name: string) => `https://tinpan.proteantech.in/f/${encodeURIComponent(name)}`;
  const page = (version: string) => `<section class="main-content-area"><a href="#">File Format for Form Number 138 Q4 Version 1.0 (Expected to be released soon.)</a><a href="/f/138.xlsx">File Format for Form Number 138 Q1 to Q3 Version ${version}</a><a href="/f/144.xlsx">File Format for Form Number 144 Q1 to Q4 Version ${version}</a><a href="/f/143.xlsx">File Format for Form Number 143 Q1 to Q4 Version ${version}</a></section>`;
  const books = { TDS138: formatBook(tdsLayouts.TDS138), TDS144: formatBook(tdsLayouts.TDS144), TDS143: formatBook(tdsLayouts.TDS143, "Collectee") };
  for (const [form, book] of Object.entries(books)) pages.set(link(`${form.slice(3)}.xlsx`), new Uint8Array(book));
  pages.set(url, page("1.2"));
  expect(proteanDownloads(page("1.2"), url).filter((entry) => watched[0].entry!.test(entry.title)).map((entry) => entry.title)).toEqual(["File Format for Form Number 138 Q1 to Q3 Version 1.2"]);
  // The same version as InboxCA writes: each file read is its own form's, with no difference.
  let watch = await checkSources(empty, day(0), fetcher, watched, templates, store);
  expect(watch.changes.map((change) => (change as { compared: object[] }).compared[0])).toEqual([{ file: "138.xlsx", with: "1.2", same: true }, { file: "144.xlsx", with: "1.2", same: true }, { file: "143.xlsx", with: "1.2", same: true }]);
  // A new release with a new country code and a changed collection field is listed, never live.
  pages.set(url, page("1.3"));
  pages.set(link("144.xlsx"), new Uint8Array(formatBook({ ...tdsLayouts.TDS144, "Annexure 10": [...tdsLayouts.TDS144["Annexure 10"], "287"] })));
  pages.set(link("143.xlsx"), new Uint8Array(formatBook({ ...tdsLayouts.TDS143, DD: tdsLayouts.TDS143.DD.map((field) => (field === "12 INTEGER 2 M" ? "12 INTEGER 3 M" : field)) }, "Collectee")));
  watch = await checkSources(watch, day(1), fetcher, watched, templates, store);
  expect(watch.changes.slice(3).map((change) => (change as { source: string; compared: { differences?: string[]; live?: true }[] }))).toMatchObject([
    { source: "protean_form144", compared: [{ with: "1.2", differences: ["In Annexure 10, heading added: 287"] }] },
    { source: "protean_form143", compared: [{ with: "1.2", differences: ["In DD, heading added: 12 INTEGER 3 M", "In DD, heading removed: 12 INTEGER 2 M"] }] },
  ]);
  expect(watch.changes.slice(3).some((change) => (change as { compared: { live?: true }[] }).compared[0].live)).toBe(false);
});
