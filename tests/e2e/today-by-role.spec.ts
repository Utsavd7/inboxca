import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Today by role (PLAN.md "Today by role"): one screen for each person in a firm of 1,200
// clients, their own list of at most 7 with See all for the rest, and this week's numbers for
// their role. The owner sees the firm, the manager their team, staff their own clients.
// Invented firm, people and clients only. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const emails = { owner: `today-owner-${tag}@invented.test`, manager: `today-manager-${tag}@invented.test`, staff: `today-staff-${tag}@invented.test`, other: `today-other-${tag}@invented.test` };
const keys = { owner: appKey(), manager: appKey(), staff: appKey(), other: appKey() };
const mehta = `Invented Mehta Traders ${tag}`;
const shah = `Invented Shah Exports ${tag}`;
const BULK = 1200;
// Screenshots for the lead, in light and dark, when SHOTS names a folder.
const shots = process.env.SHOTS;
let firm: Awaited<ReturnType<typeof seedFirm>>;
const pages: Partial<Record<keyof typeof emails, Page>> = {};

const day = (days: number) => `(now() at time zone 'Asia/Kolkata')::date + ${days}`;
async function open(browser: Browser, who: keyof typeof emails) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(page, emails[who], keys[who]);
  return (pages[who] = page);
}
const list = (page: Page) => page.locator("section[aria-labelledby=t-list]");
const week = (page: Page) => page.getByRole("region", { name: "This week" });
// Nothing on Today scrolls at 1440 by 900: the page's scroll area is no taller than its window.
const oneScreen = (page: Page) => page.locator(".stage-panel").evaluate((panel) => panel.scrollHeight <= panel.clientHeight + 1);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Invented Today Firm ${tag}`, emails.owner, keys.owner);
  const [manager, staff, other] = [await addPerson(firm.firmId, emails.manager, "manager", keys.manager), await addPerson(firm.firmId, emails.staff, "staff", keys.staff), await addPerson(firm.firmId, emails.other, "staff", keys.other)];
  const [{ id: team }] = await query(local.dbUrl, "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'Invented GST team') returning id", [firm.firmId]);
  await query(local.dbUrl, "update public.firm_members set team_id = $2 where firm_id = $1 and user_id = any($3)", [firm.firmId, team, [manager, staff]]);
  const [{ id: mehtaId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, mehta]);
  const [{ id: shahId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, shah]);
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff'), ($1, $4, $5, 'staff')", [firm.firmId, mehtaId, staff, shahId, other]);
  // Mehta: a return 8 days late (always last week), two due today (one filed), papers asked twice
  // with nothing back, and an email waiting for a reply. Shah: a return 8 days late.
  await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'GSTR1_M', '2026-08', ${day(-8)}), ($1, $3, 'compliance', 'GSTR1_M', '2026-08', ${day(-8)})`, [firm.firmId, mehtaId, shahId]);
  await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on, status, details) values ($1, $2, 'compliance', 'GSTR3B_M', '2026-09', ${day(0)}, 'upcoming', '{}'), ($1, $2, 'compliance', 'GSTR1_M', '2026-09', ${day(0)}, 'filed', jsonb_build_object('filed_on', ${day(0)}))`, [firm.firmId, mehtaId]);
  await query(local.dbUrl, `insert into public.requests (firm_id, client_id, kind, entity_type, entity_id, expires_at, details) values ($1, $2, 'documents', 'checklist', gen_random_uuid(), now() + interval '10 days', jsonb_build_object('period', '2026-09', 'link_hash', $3::text, 'items', jsonb_build_array(jsonb_build_object('type', 'Sales bills', 'work', 'gst', 'received', '[]'::jsonb)), 'followups', jsonb_build_array(${day(-6)}, ${day(-3)})))`, [firm.firmId, mehtaId, `invented-${tag}`]);
  await query(local.dbUrl, "insert into public.requests (firm_id, client_id, kind, entity_type, entity_id, reason_code) values ($1, $2, 'team_reply', 'email', gen_random_uuid(), 'no_rule')", [firm.firmId, mehtaId]);
  // 1,200 more clients, each with a return 10 days late, that nobody in particular looks after.
  await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) select $1, 'Invented Bulk Client ' || n, 'individual' from generate_series(1, $2) n", [firm.firmId, BULK]);
  await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) select $1, id, 'compliance', 'GSTR1_M', '2026-08', ${day(-10)} from public.clients where firm_id = $1 and name like 'Invented Bulk Client %'`, [firm.firmId]);
  for (const who of ["owner", "manager", "staff"] as const) await open(browser, who);
  if (shots) await mkdir(shots, { recursive: true });
});
test.afterAll(async () => {
  await firm.remove(emails.manager, emails.staff, emails.other);
});

async function shoot(page: Page, name: string) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}-light.png`, animations: "disabled" });
  await page.context().addCookies([{ name: "theme", value: "dark", url: page.url() }]);
  await page.reload();
  await expect(list(page)).toBeVisible();
  await expect(week(page)).toBeVisible();
  await page.screenshot({ path: `${shots}/${name}-dark.png`, animations: "disabled" });
  await page.context().clearCookies({ name: "theme" });
}

test("the owner sees the whole firm: 7 rows, See all, and the firm's numbers, on one screen", async () => {
  const owner = pages.owner!;
  await owner.goto("/app");
  await expect(owner.locator(".page-head")).toContainText(/Good (morning|afternoon|evening), Today\./);
  const rows = list(owner).getByRole("listitem");
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText("File GSTR-1 (monthly) for Aug 2026");
  await expect(rows.first()).toContainText("10 days late");
  // Every late client, Mehta's return due today, the call and the reply.
  const all = BULK + 5;
  await expect(owner.locator(".page-head")).toContainText(`${all.toLocaleString("en-IN")} things need you.`);
  await expect(list(owner).getByRole("link", { name: `See all ${all.toLocaleString("en-IN")}` })).toHaveAttribute("href", "/app/work");
  await expect(week(owner).getByRole("link", { name: /^Returns this month/ })).toBeVisible();
  await expect(week(owner).getByRole("link", { name: /^Late / })).toContainText((BULK + 2).toLocaleString("en-IN"));
  await expect(week(owner).getByRole("link", { name: /^Waiting for papers 1 client/ })).toHaveAttribute("href", "/app/clients?show=missing");
  await expect(week(owner).getByRole("link", { name: /\d Waiting$/ })).toBeVisible();
  // Off Today: the week strip, InboxCA's day, the four big figures and the email week card.
  for (const gone of ["Due this week", "What InboxCA did today", "Email this week", "Returns filed this month", "Get questions and approvals"]) await expect(owner.getByText(gone)).toHaveCount(0);
  expect(await oneScreen(owner)).toBe(true);
  await shoot(owner, "owner");

  // See all: the same list a page at a time, with filters.
  await owner.goto("/app");
  await list(owner).getByRole("link", { name: `See all ${all.toLocaleString("en-IN")}` }).click();
  await expect(owner).toHaveURL(/\/app\/work$/);
  const shown = owner.locator("section[aria-labelledby=w-list]").getByRole("listitem");
  await expect(shown).toHaveCount(25);
  if (shots) await owner.screenshot({ path: `${shots}/owner-full-list-light.png`, animations: "disabled" });
  const filters = owner.getByRole("navigation", { name: "Show" });
  await expect(filters.getByRole("link", { name: /^All/ })).toContainText(all.toLocaleString("en-IN"));
  await expect(filters.getByRole("link", { name: /^Papers/ })).toContainText("1");
  await expect(filters.getByRole("link", { name: /^Emails/ })).toContainText("1");
  await owner.getByRole("navigation", { name: "List pages" }).getByRole("link", { name: "Next" }).click();
  await expect(owner).toHaveURL(/\/app\/work\?page=2$/);
  await expect(owner.getByRole("navigation", { name: "List pages" })).toContainText("Showing 26 to 50");
  await filters.getByRole("link", { name: /^Emails/ }).click();
  await expect(shown).toHaveCount(1);
  await expect(shown).toContainText(`Reply to ${mehta}`);
  await expect(owner.getByText("The 500 clients late the longest are here.")).toHaveCount(0);
  await filters.getByRole("link", { name: /^Late/ }).click();
  await expect(owner.getByText("The 500 clients late the longest are here.")).toBeVisible();
});

test("the manager sees their team's clients and the team's numbers", async () => {
  const manager = pages.manager!;
  await manager.goto("/app");
  const rows = list(manager).getByRole("listitem");
  // Mehta's late return, the call, the reply, and the GSTR-3B due today: returns due soon are
  // pinned to whoever looks after the client, so to a manager for their team's people (return_pins).
  await expect(rows.filter({ hasText: mehta })).toHaveCount(4);
  await expect(rows.filter({ hasText: `GSTR-3B for ${mehta}` })).toHaveCount(1);
  await expect(list(manager)).not.toContainText(shah);
  await expect(list(manager)).not.toContainText("Invented Bulk Client");
  await expect(rows.filter({ hasText: `Call ${mehta}` })).toContainText("Asked twice, still missing Sales bills for Sep 2026");
  await expect(week(manager).getByRole("link", { name: /^Team returns this week 1 of 2 filed/ })).toHaveAttribute("href", "/app/calendar?view=week");
  await expect(week(manager).getByRole("link", { name: /^Drafts to approve 0/ })).toHaveAttribute("href", "/app/work?show=approvals");
  // Stuck: the call, and the GSTR-3B due today still waiting for its papers.
  await expect(week(manager).getByRole("link", { name: /^Stuck 2/ })).toBeVisible();
  await expect(week(manager).getByRole("listitem")).toHaveText([/^Today\s*2 returns$/]);
  expect(await oneScreen(manager)).toBe(true);
  await shoot(manager, "manager");
});

test("staff see their own clients only, with a button for each, and their own numbers", async () => {
  const staff = pages.staff!;
  await staff.goto("/app");
  const rows = list(staff).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("File GSTR-1 (monthly) for Aug 2026");
  await expect(rows.nth(1)).toContainText(`GSTR-3B for ${mehta}, Sep 2026`);
  await expect(rows.nth(0)).toContainText(mehta);
  await expect(rows.nth(0).getByRole("link", { name: `See returns: ${mehta}` })).toBeVisible();
  await expect(rows.filter({ hasText: `Reply to ${mehta}` }).getByRole("link", { name: `Reply to ${mehta}` })).toHaveAttribute("href", /\/app\/inbox\?mail=/);
  await expect(list(staff)).not.toContainText(shah);
  await expect(list(staff).getByRole("link", { name: /^See all/ })).toHaveCount(0);
  await expect(staff.locator(".page-head")).toContainText("4 things need you.");
  await expect(week(staff).getByRole("link", { name: /^Your returns this week 1 of 2 filed/ })).toBeVisible();
  await expect(week(staff).getByRole("link", { name: /^Waiting on clients 1 client/ })).toBeVisible();
  await expect(week(staff).getByRole("link", { name: /^Answered by InboxCA 0/ })).toBeVisible();
  // j and k move between the rows' buttons.
  await staff.keyboard.press("j");
  await expect(rows.nth(0).getByRole("link", { name: `See returns: ${mehta}` })).toBeFocused();
  await staff.keyboard.press("j");
  await expect(rows.nth(1).locator(".row-end > a, .row-end button").last()).toBeFocused();
  await staff.keyboard.press("k");
  await expect(rows.nth(0).getByRole("link", { name: `See returns: ${mehta}` })).toBeFocused();
  expect(await oneScreen(staff)).toBe(true);
  await shoot(staff, "staff");
  // Their full list holds the same, and nothing to remind in bulk.
  await staff.goto("/app/work?show=late");
  await expect(staff.locator("section[aria-labelledby=w-list]").getByRole("listitem")).toHaveCount(1);
  await expect(staff.getByRole("link", { name: "Remind all late clients" })).toHaveCount(0);
});
