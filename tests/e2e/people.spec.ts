import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { addPerson, appKey, latestEmail, localSupabase, query, seedFirm, signIn, totp } from "./local-supabase";

// Taking back what the owner set up on People: an invite sent by mistake is withdrawn, so its
// email no longer joins the firm, and a team is removed, which leaves its people without a
// team and drops the clients given to it. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `people-owner-${tag}@example.test`;
const ownerKey = appKey();
const invitedEmail = `people-invited-${tag}@example.test`;
const staffEmail = `people-staff-${tag}@example.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const logged = async (action: string) => (await query(local.dbUrl, "select actor_id from public.activity_log where firm_id = $1 and action = $2", [firm.firmId, action])).map((row) => row.actor_id);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`People Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
});
test.afterAll(() => firm.remove(invitedEmail, staffEmail));

test("an invite sent by mistake is withdrawn, and its email no longer joins the firm", async ({ browser, baseURL }) => {
  const sent = Date.now() - 1000;
  await owner.goto("/app/people?panel=invite");
  await owner.getByLabel("Their work email").fill(invitedEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${invitedEmail}`);
  const row = owner.getByRole("row").filter({ hasText: invitedEmail });
  await expect(row).toContainText("Invited");

  await row.getByRole("link", { name: `Change ${invitedEmail}` }).click();
  await owner.getByRole("dialog", { name: invitedEmail }).getByRole("button", { name: "Withdraw invite" }).click();
  await expect(row).toHaveCount(0);
  expect(await query(local.dbUrl, "select 1 from public.firm_members m join auth.users u on u.id = m.user_id where m.firm_id = $1 and u.email = $2", [firm.firmId, invitedEmail])).toEqual([]);
  expect(await logged("member.invite_withdrawn")).toEqual([firm.ownerId]);

  // The link in the invite still signs them in, but there is no firm to join.
  const { link } = await latestEmail(local.mailUrl, invitedEmail, sent);
  const target = new URL(link!);
  const invited = await (await browser.newContext()).newPage();
  await invited.goto(`${baseURL}${target.pathname}${target.search}`);
  await expect(invited.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  const key = (await invited.locator(".secret").textContent())!.trim();
  await invited.getByLabel("6 digit code from the app").fill(totp(key));
  await invited.getByRole("button", { name: "Continue" }).click();
  await expect(invited.locator(".page-head")).toContainText("You are not part of a firm yet.");
  await expect(invited.getByRole("button", { name: /^Join/ })).toHaveCount(0);
  await invited.close();
});

test("removing a team leaves its people without a team and drops the clients given to it", async () => {
  const staffId = await addPerson(firm.firmId, staffEmail, "staff", appKey());
  await owner.goto("/app/people?panel=groups");
  await owner.getByLabel("New team").fill("Audit team");
  await owner.getByRole("button", { name: "Add team" }).click();
  const teams = owner.locator("section[aria-labelledby=teams]").getByRole("listitem");
  await expect(teams.filter({ hasText: "Audit team" })).toContainText("0 people");
  const [{ id: team }] = await query(local.dbUrl, "select id from public.groups where firm_id = $1 and kind = 'team'", [firm.firmId]);
  const [{ id: client }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, `Audit Client ${tag}`]);
  await query(local.dbUrl, "update public.firm_members set team_id = $3 where firm_id = $1 and user_id = $2", [firm.firmId, staffId, team]);
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, team_id, role) values ($1, $2, $3, 'staff')", [firm.firmId, client, team]);
  await owner.reload();
  await expect(teams.filter({ hasText: "Audit team" })).toContainText("1 person");

  await owner.getByRole("button", { name: "Remove team Audit team" }).click();
  await expect(owner.locator("section[aria-labelledby=teams]")).toContainText("No teams yet.");
  expect(await query(local.dbUrl, "select team_id from public.firm_members where firm_id = $1 and user_id = $2", [firm.firmId, staffId])).toEqual([{ team_id: null }]);
  expect(await query(local.dbUrl, "select 1 from public.client_assignments where client_id = $1", [client])).toEqual([]);
  await owner.goto(`/app/clients/${client}?tab=team`);
  await expect(owner.getByRole("dialog", { name: "Looked after by" }).getByText("Nobody is assigned yet.")).toBeVisible();
});
