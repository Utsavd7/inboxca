import { expect, it } from "vitest";
import { inFilter, rankWork, visibleTo, type Listed } from "@/src/lib/work/today";

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
