import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { checkSources, type Source, type Watch } from "@/src/jobs/forms-watch";

// A stand-in for the official sites: each address answers with whatever the test sets.
const pages = new Map<string, string | null>();
const fetcher = (async (url: string | URL | Request) => {
  const body = pages.get(String(url));
  return body === null || body === undefined ? new Response("gone", { status: 404 }) : new Response(body);
}) as typeof fetch;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const list: Source[] = [
  { key: "tool", name: "Invented offline tool", url: "https://official.invalid/tool.zip", kind: "file", known: sha("tool v1") },
  { key: "downloads", name: "Invented downloads page", url: "https://official.invalid/downloads", kind: "page" },
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
