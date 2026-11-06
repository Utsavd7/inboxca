import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { serverCrypto } from "@/src/lib/crypto";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Today by role (PLAN.md "Today by role"): one screen for each person in a firm of 1,200
// clients, their own list of at most 6 in its groups with See all for the rest, and the few
// numbers for their role. The owner sees the firm, the manager their team, staff their own
// clients. One count everywhere: the greeting, the list, its groups and See all.
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
const group = (page: Page, name: "late" | "week" | "waits" | "other") => page.locator(`section[aria-labelledby=g-${name}]`);
const week = (page: Page) => page.locator("section[aria-labelledby=t-week]");
const tile = (page: Page, href: string) => week(page).locator(`a[href="${href}"]`);
// Nothing on Today scrolls at 1440 by 900: the page's scroll area is no taller than its window.
const oneScreen = (page: Page) => page.locator(".stage-panel").evaluate((panel) => panel.scrollHeight <= panel.clientHeight + 1);

test.beforeAll(async ({ browser }) => {
  // Every date below counts from today in India, as Today does: a run that would cross midnight
  // there (the GSTR-3B due today turning late) starts just after it instead.
  const left = 86_400_000 - ((Date.now() + 19_800_000) % 86_400_000);
  if (left < 180_000) {
    test.setTimeout(left + 120_000);
    await new Promise((done) => setTimeout(done, left + 1_000));
  }
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
  // The email came 5 days ago through a mailbox that needs connecting again (so no job reads it):
  // it is given to Mehta's staff, and late, so the owner sees it too.
  loadEnvConfig(process.cwd());
  const crypto = serverCrypto();
  const account = randomUUID();
  await query(local.dbUrl, "insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc, status) values ($1, $2, 'mail', 'imap', $3, $4, 'needs_reconnect')", [account, firm.firmId, await crypto.encrypt(firm.firmId, `accounts/${account}/address`, "office@invented.test"), await crypto.encrypt(firm.firmId, `accounts/${account}/credentials`, "{}")]);
  const [{ id: mail }] = await query(local.dbUrl, "insert into public.email_events (firm_id, account_id, client_id, provider_message_id, sender_bidx, received_at) values ($1, $2, $3, $4, 'invented', now() - interval '5 days') returning id", [firm.firmId, account, mehtaId, `<today-${tag}@invented.test>`]);
  await query(local.dbUrl, "insert into public.requests (firm_id, client_id, kind, entity_type, entity_id, reason_code) values ($1, $2, 'team_reply', 'email', $3, 'no_rule')", [firm.firmId, mehtaId, mail]);
  // Shah's income tax return was filed 25 days ago and is not e-verified: its last day is in 5
  // days, so it is on the owner's list (and on the list of whoever looks after Shah).
  await query(local.dbUrl, `insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on, status, details) values ($1, $2, 'compliance', 'ITR_BIZ', '2026-03', '2026-08-31', 'filed', jsonb_build_object('filed_on', ${day(-25)}))`, [firm.firmId, shahId]);
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

test("the owner sees the whole firm: 6 rows in groups, See all, and the firm's numbers, on one screen", async () => {
  const owner = pages.owner!;
  await owner.goto("/app");
  const rows = list(owner).getByRole("listitem");
  await expect(rows).toHaveCount(6);
  // Every late client, then Shah's return to e-verify this week, Mehta's return due today and
  // the call waiting on Mehta, and the reply: one from each group, the rest of the room late.
  const all = BULK + 6;
  await expect(group(owner, "late").getByRole("listitem")).toHaveCount(3);
  await expect(group(owner, "late")).toContainText((BULK + 2).toLocaleString("en-IN"));
  await expect(group(owner, "late").getByRole("listitem").first()).toContainText("Invented Bulk Client");
  await expect(group(owner, "week")).toContainText(shah);
  await expect(group(owner, "waits").getByRole("listitem")).toHaveCount(1);
  await expect(group(owner, "waits")).toContainText("2");
  await expect(group(owner, "other")).toContainText(mehta);
  await expect(owner.locator(".page-head")).toContainText(all.toLocaleString("en-IN"));
  await expect(list(owner).locator(".app-card-head")).toContainText(all.toLocaleString("en-IN"));
  await expect(list(owner).getByRole("link", { name: `See all ${all.toLocaleString("en-IN")}` })).toHaveAttribute("href", "/app/work");
  await expect(tile(owner, "/app/calendar?view=month")).toBeVisible();
  await expect(tile(owner, "/app/work?show=late")).toContainText((BULK + 2).toLocaleString("en-IN"));
  await expect(tile(owner, "/app/clients?show=missing")).toContainText("1");
  await expect(week(owner).getByRole("navigation", { name: "Work by step" })).toBeVisible();
  expect(await oneScreen(owner)).toBe(true);
  // The return to e-verify opens on its own page at the File step.
  await expect(group(owner, "week").locator(".row-end a")).toHaveAttribute("href", /\/app\/clients\/[^/]+\/returns\/[^/]+\?step=file$/);
  // Nothing scrolls on a 1280 by 760 laptop either.
  await owner.setViewportSize({ width: 1280, height: 760 });
  await owner.goto("/app");
  await expect(rows).toHaveCount(6);
  expect(await oneScreen(owner)).toBe(true);
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await owner.setViewportSize({ width: 1440, height: 900 });
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
  await expect(shown).toContainText(mehta);
  await expect(owner.getByText("The 500 clients late the longest are here.")).toHaveCount(0);
  await filters.getByRole("link", { name: /^Late/ }).click();
  await expect(owner.getByText("The 500 clients late the longest are here.")).toBeVisible();
});

test("the manager sees their team's clients and the team's numbers", async () => {
  const manager = pages.manager!;
  await manager.goto("/app");
  const rows = list(manager).getByRole("listitem");
  // Mehta's late return, the call, and the GSTR-3B due today: returns due soon are pinned to
  // whoever looks after the client, so to a manager for their team's people (return_pins). The
  // reply is given to Mehta's staff; late ones go to the owner and partners only.
  await expect(rows.filter({ hasText: mehta })).toHaveCount(3);
  await expect(group(manager, "late").getByRole("listitem").filter({ hasText: mehta })).toHaveCount(1);
  // The GSTR-3B and the call both wait for Mehta's papers.
  await expect(group(manager, "waits").getByRole("listitem").filter({ hasText: mehta })).toHaveCount(2);
  await expect(group(manager, "waits").getByRole("listitem").filter({ hasText: "GSTR-3B" })).toHaveCount(1);
  await expect(group(manager, "waits")).toContainText("Sales bills");
  await expect(list(manager)).not.toContainText(shah);
  await expect(list(manager)).not.toContainText("Invented Bulk Client");
  await expect(manager.locator(".page-head")).toContainText("3");
  await expect(tile(manager, "/app/calendar?view=week")).toContainText(/1\D+2/);
  await expect(tile(manager, "/app/work?show=late")).toContainText("1");
  await expect(tile(manager, "/app/clients?show=missing")).toContainText("1");
  expect(await oneScreen(manager)).toBe(true);
  await shoot(manager, "manager");
});

test("staff see their own clients only, with a button for each, and their own numbers", async () => {
  const staff = pages.staff!;
  await staff.goto("/app");
  const rows = list(staff).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  // The late return first, the two waiting on Mehta's papers, then the reply.
  await expect(rows.nth(0)).toContainText(mehta);
  await expect(group(staff, "late").getByRole("link", { name: `See returns: ${mehta}` })).toBeVisible();
  await expect(group(staff, "waits").getByRole("listitem")).toHaveCount(2);
  const reply = group(staff, "other").locator(".row-end a[href^='/app/inbox?mail=']");
  await expect(reply).toBeVisible();
  await expect(list(staff)).not.toContainText(shah);
  await expect(list(staff).getByRole("link", { name: /^See all/ })).toHaveCount(0);
  await expect(staff.locator(".page-head")).toContainText("4");
  await expect(list(staff).locator(".app-card-head")).toContainText("4");
  await expect(tile(staff, "/app/calendar?view=week")).toContainText(/1\D+2/);
  await expect(tile(staff, "/app/clients?show=missing")).toContainText("1");
  // j and k move between the rows' buttons.
  const buttons = list(staff).locator(".row-end > a:last-child");
  await staff.keyboard.press("j");
  await expect(buttons.nth(0)).toBeFocused();
  await staff.keyboard.press("j");
  await expect(buttons.nth(1)).toBeFocused();
  await staff.keyboard.press("k");
  await expect(buttons.nth(0)).toBeFocused();
  expect(await oneScreen(staff)).toBe(true);
  await shoot(staff, "staff");
  // Their full list holds the same, and nothing to remind in bulk.
  await staff.goto("/app/work?show=late");
  await expect(staff.locator("section[aria-labelledby=w-list]").getByRole("listitem")).toHaveCount(1);
  await expect(staff.getByRole("link", { name: "Remind all late clients" })).toHaveCount(0);
});
