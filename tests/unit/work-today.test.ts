import { expect, it } from "vitest";
import { weekFor } from "@/app/(app)/app/work-data";
import { groupRepeats, inFilter, pickShown, rankWork, shortReturn, visibleTo, type Listed } from "@/src/lib/work/today";

// Today by role: every area's items in one list, most urgent first, and only what the person's
// role and clients allow. Invented clients only.
const today = "2026-10-26";
const item = (key: string, extra: Partial<Listed> = {}): Listed => ({ key, title: key, why: "", action: { label: "Open", href: "/app" }, audience: "assigned", area: "returns", ...extra });
const shah = { id: "shah", name: "Invented Shah Traders" };
const mehta = { id: "mehta", name: "Invented Mehta Textiles" };

it("puts late and red first, then the rest by due date, what has no date counting as today", () => {
  const list = [
    item("approve:later", { due: "2026-10-29" }),
    item("reply:now"),
    item("missing:soon", { due: "2026-10-28", urgent: true }),
    item("late:old", { due: "2026-10-01", urgent: true }),
    item("virus:x", { urgent: true }),
    item("approve:sooner", { due: "2026-10-27" }),
    item("late:older", { due: "2026-09-20" }),
    item("approved:past", { due: "2026-10-20" }),
  ];
  expect(rankWork(list, today).map((row) => row.key)).toEqual(["virus:x", "late:older", "late:old", "approved:past", "missing:soon", "reply:now", "approve:sooner", "approve:later"]);
});

it("keeps each area's own order within the same day", () => {
  const list = [item("reply:a"), item("reply:b"), item("call:c"), item("reply:d")];
  expect(rankWork(list, today).map((row) => row.key)).toEqual(["reply:a", "reply:b", "call:c", "reply:d"]);
});

it("shows the owner and partners the firm, a manager the approvals, staff their own clients, front desk emails and papers", () => {
  const list = [
    item("late:shah", { client: shah }),
    item("late:mehta", { client: mehta }),
    item("approve:draft", { client: mehta, audience: "approver" }),
    item("alert:drive", { audience: "firm", area: "firm" }),
    item("gov:new", { audience: "firm", area: "gov" }),
    item("reply:contact", { audience: "firm", area: "emails" }),
    item("reply:shah", { client: shah, area: "emails" }),
    item("call:shah", { client: shah, area: "papers" }),
  ];
  const sees = (role: string, looked: Set<string> | null) => list.filter((row) => visibleTo(row, { role, looked })).map((row) => row.key);
  expect(sees("owner", null)).toEqual(list.map((row) => row.key));
  expect(sees("partner", null)).toEqual(list.map((row) => row.key));
  expect(sees("manager", new Set(["shah"]))).toEqual(["late:shah", "approve:draft", "gov:new", "reply:shah", "call:shah"]);
  expect(sees("staff", new Set(["shah"]))).toEqual(["late:shah", "gov:new", "reply:shah", "call:shah"]);
  expect(sees("staff", new Set())).toEqual(["gov:new"]);
  expect(sees("front_desk", new Set(["shah"]))).toEqual(["reply:contact", "reply:shah", "call:shah"]);
});

it("shows the same work for one client once, with how many, and keeps other clients' apart", () => {
  const reply = (key: string, client: typeof shah, extra: Partial<Listed> = {}) =>
    item(key, { client, area: "emails", action: { label: "Check and send", href: `/app/inbox?mail=${key}` }, many: { title: `replies to ${client.name}`, why: "Check each" }, ...extra });
  const list = groupRepeats([reply("a", shah), item("late:shah", { client: shah }), reply("b", shah, { urgent: true, due: "2026-10-20" }), reply("c", mehta)]);
  expect(list.map((row) => [row.key, row.title])).toEqual([["a", `2 replies to ${shah.name}`], ["late:shah", "late:shah"], ["c", "c"]]);
  expect(list[0]).toMatchObject({ action: { href: "/app/inbox?mail=a" }, urgent: true, due: "2026-10-20", why: "Check each" });
});

it("groups Today's list, a row from each group first, and counts every item once", () => {
  const list = rankWork([
    ...["a", "b", "c", "d"].map((key) => item(`late:${key}`, { due: "2026-10-20", urgent: true })),
    item("missing:soon", { due: "2026-10-28", waits: true }),
    item("approve:week", { due: "2026-11-01" }),
    item("approve:later", { due: "2026-11-02" }),
    item("reply:x"),
  ], today);
  const groups = pickShown(list, today, 6);
  expect(groups.map(({ group, count, items }) => [group, count, items.map((row) => row.key)])).toEqual([
    ["late", 4, ["late:a", "late:b", "late:c"]],
    ["week", 1, ["approve:week"]],
    ["waits", 1, ["missing:soon"]],
    ["other", 2, ["reply:x"]],
  ]);
});

it("names a return's period the short way, the quarter of the financial year for TDS", () => {
  expect(shortReturn("GSTR1_M", "2026-10", today)).toBe("GSTR-1 Oct");
  expect(shortReturn("GSTR1_M", "2025-12", today)).toBe("GSTR-1 Dec 2025");
  expect(["2026-06", "2026-09", "2026-12", "2027-03"].map((end) => shortReturn("TDS_RET", end, today))).toEqual(["TDS Q1", "TDS Q2", "TDS Q3", "TDS Q4"]);
  expect(shortReturn("TCS_RET", "2026-03", today)).toBe("TCS Q4 FY 2025-26");
  expect(shortReturn("ITR_BIZ", "2026-03", today)).toBe("ITR AY 2026-27");
  expect(shortReturn("MGT7", "2026-03", today, { name: "MGT-7 (annual return)", frequency: "yearly" })).toBe("MGT-7 FY 2025-26");
});

it("filters the full list: mine, late, approvals and each area", () => {
  const list = [
    item("late:shah", { client: shah, due: "2026-10-01", urgent: true }),
    item("approve:draft", { client: mehta, audience: "approver", due: "2026-10-30" }),
    item("approve:paper", { client: shah, audience: "approver", area: "papers" }),
    item("questions", { audience: "approver", area: "firm" }),
    item("reply:mehta", { client: mehta, area: "emails" }),
    item("call:shah", { client: shah, area: "papers" }),
  ];
  const keys = (show: Parameters<typeof inFilter>[1]) => list.filter((row) => inFilter(row, show, today, new Set(["shah"]))).map((row) => row.key);
  expect(keys("all")).toHaveLength(6);
  expect(keys("mine")).toEqual(["late:shah", "approve:paper", "questions", "call:shah"]);
  expect(keys("late")).toEqual(["late:shah"]);
  expect(keys("approvals")).toEqual(["approve:draft", "approve:paper", "questions"]);
  expect(keys("papers")).toEqual(["approve:paper", "call:shah"]);
  expect(keys("returns")).toEqual(["late:shah", "approve:draft"]);
  expect(keys("emails")).toEqual(["reply:mehta"]);
});

it("tells the person the week's numbers could not be read, rather than that none are due", async () => {
  const read = { data: [], error: null }, failed = { data: null, error: { code: "57014" } };
  const week = (numbers: { data: unknown; error: unknown }) => weekFor({
    supabase: { rpc: async () => numbers },
    membership: { role: "manager", firmId: "firm" },
    userId: "me",
  } as unknown as Parameters<typeof weekFor>[0], Promise.resolve({ items: [], total: 0, late: 0, failed: false }));
  expect((await week(read)).range).toEqual({ due: 0, filed: 0, waiting: 0 });
  expect((await week(failed)).range).toBeNull();
});
