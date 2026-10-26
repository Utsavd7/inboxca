import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { checkSources, type Source, type Watch } from "@/src/jobs/forms-watch";
import { gstNews } from "@/src/jobs/gov-pages";
import { zip } from "@/src/lib/firm-download";
import type { Template } from "@/src/lib/templates";

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
