import { expect, it, vi } from "vitest";
import { weekOfNotices } from "@/src/jobs/date-watch";
import type { Source } from "@/src/jobs/forms-watch";

// The Sunday check: a plain extension is applied for its return and period only, anything
// unclear or refused changes nothing and waits for a person, a listing not read this week is
// told too, and an item is handled once. Titles are invented in the official style.
const list: Source[] = [
  { key: "cbic", name: "Invented CBIC listing", url: "https://official.invalid/cbic", area: "gst", kind: "list" },
  { key: "news", name: "Invented tax news", url: "https://official.invalid/news", area: "income_tax", kind: "list" },
];
const item = (id: string, source: string, title: string, seen = "2026-11-05") => ({ id, source, title, link: `https://official.invalid/${id}`, seen, date: "2026-11-04" });
const sunday = new Date("2026-11-08T03:30:00Z");

it("applies a plain extension to its return and period, leaves the rest to a person, and handles each item once", async () => {
  const apply = vi.fn(async (code: string) => (code === "GSTR3B_M" ? "extended" : "earlier"));
  const items = [
    item("a".repeat(16), "cbic", "99/2026-Central Tax: Seeks to extend the due date for furnishing FORM GSTR-3B for the month of October, 2026 till 25th November, 2026"),
    item("b".repeat(16), "cbic", "98/2026-Central Tax: Seeks to extend the due date for furnishing FORM GSTR-1 for the month of October, 2026 for registered persons in the State of Manipur till 20.11.2026"),
    item("c".repeat(16), "news", "Extension of due date for furnishing the audit report for AY 2026-27 to 10th November 2026"),
    item("d".repeat(16), "news", "Invented advisory on the e-filing portal"),
    item("e".repeat(16), "cbic", "97/2026-Central Tax: Seeks to extend the due date for furnishing FORM GSTR-3B for the month of September, 2026 till 25th October, 2026", "2026-10-20"),
  ];
  const { dates, news } = await weekOfNotices({ sources: { cbic: { failures: 0 }, news: { failures: 0 } }, items }, {}, sunday, apply, list);
  expect(apply.mock.calls).toEqual([
    ["GSTR3B_M", "2026-10", "2026-11-25", "https://official.invalid/aaaaaaaaaaaaaaaa", "99/2026-Central Tax", undefined],
    ["TAX_AUDIT", "2026-03", "2026-11-10", "https://official.invalid/cccccccccccccccc", "Invented tax news, 4 Nov 2026", undefined],
  ]);
  expect(dates.week.map((did) => [did.id.slice(0, 1), did.did])).toEqual([["a", "extended"], ["b", "ask"], ["c", "ask"], ["d", "nothing"]]);
  expect(dates.week[0]).toMatchObject({ code: "GSTR3B_M", period: "2026-10", on: "2026-11-25", notice: "99/2026-Central Tax" });
  expect(dates.week[2].why).toMatch(/not later/);
  expect(news).toHaveLength(3);
  // Next Sunday: nothing is handled twice, and a listing not read is told, with last week's dates standing.
  const again = await weekOfNotices({ sources: { cbic: { failures: 3 }, news: { failures: 0 } }, items }, dates, new Date("2026-11-15T03:30:00Z"), apply, list);
  expect(apply).toHaveBeenCalledTimes(2);
  expect(again.dates.week).toMatchObject([{ source: "cbic", did: "ask", why: expect.stringMatching(/3 days/) }]);
  expect(again.dates.done).toHaveLength(4);
});
