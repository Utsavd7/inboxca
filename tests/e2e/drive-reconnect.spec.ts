import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { DROPBOX_TEST_URL } from "../../playwright.config";
import { addPerson, appKey, localSupabase, query, runJobs, seedFirm, signIn } from "./local-supabase";

// When the firm's drive cannot be reached: the status line says so to everyone while the drive
// check's alert is open, and the owner's Reconnect signs in to the same drive again, keeping
// its record, folders and papers. Dropbox here is a fake on this machine, never the real one.
// Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
// One worker, as the fake Dropbox has one port.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const key = appKey();
const ownerEmail = `reconnect-owner-${tag}@example.test`;
const staffEmail = `reconnect-staff-${tag}@example.test`;
// The fake's one account: its sign in page allows at once, and its API answers what Connect,
// the drive's setup and the drive check ask.
const account = { id: `dbid:AAInvented${tag}`, email: `dropbox-${tag}@invented.test` };
const fake = createServer((request, response) => {
  const url = new URL(request.url ?? "/", DROPBOX_TEST_URL);
  request.resume();
  if (url.pathname.endsWith("/oauth2/authorize"))
    return void response.writeHead(302, { Location: `${url.searchParams.get("redirect_uri")}?code=invented-code&state=${url.searchParams.get("state")}` }).end();
  const answers: Record<string, unknown> = {
    "/api.dropboxapi.com/oauth2/token": { access_token: "invented-access", refresh_token: `invented-refresh-${randomUUID()}` },
    "/api.dropboxapi.com/2/users/get_current_account": { email: account.email, account_id: account.id },
    "/api.dropboxapi.com/2/users/get_space_usage": { used: 0, allocation: { allocated: 1024 ** 4 } },
    "/api.dropboxapi.com/2/files/list_folder": { entries: [], has_more: false },
    "/content.dropboxapi.com/2/files/upload": { id: "id:invented" },
  };
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answers[url.pathname] ?? {}));
});
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
// The status line once it has arrived (its stand in shows while it loads).
const foot = (page: Page) => page.getByLabel("Status", { exact: true });
const drive = () => query(local.dbUrl, "select id, credentials_enc, settings ->> 'dropbox_account' as account from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId]);

test.beforeAll(async ({ browser }) => {
  await new Promise<void>((resolve) => fake.listen(Number(new URL(DROPBOX_TEST_URL).port), "127.0.0.1", resolve));
  firm = await seedFirm(`Reconnect Firm ${tag}`, ownerEmail, key);
  await addPerson(firm.firmId, staffEmail, "staff", key);
  owner = await (await browser.newContext()).newPage();
  staff = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, key);
  await signIn(staff, staffEmail, key);
});
test.afterAll(async () => {
  await firm.remove(staffEmail);
  await new Promise((resolve) => fake.close(resolve));
});

test("the status line says when the drive cannot be reached, and Reconnect keeps the drive", async ({ request }) => {
  await owner.goto("/app/settings?group=email");
  const card = owner.locator("section#drive");
  await card.getByLabel("Test drive on this computer").check();
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toContainText("Connected:");
  await runJobs(request, firm.firmId);
  const [connected] = await drive();
  // Five failed checks opened the alert, and a reading job used up its 7 days meanwhile.
  await query(local.dbUrl, "insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, status, details) values ($1, 'alert', 'drive_away', $1, 'drive_away', 'pending', '{}')", [firm.firmId]);
  const waited = `read_document:${randomUUID()}:1`;
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, 'read_document', 'document', gen_random_uuid(), $2, 'failed', 168, 'drive_unreachable')", [firm.firmId, waited]);

  // Everyone sees it at the foot of the page; the owner's words open the drive's settings.
  const away = "Drive cannot be reached, new files wait";
  await staff.goto("/app");
  await expect(foot(staff)).toContainText(away);
  await expect(foot(staff).getByRole("link", { name: away })).toHaveCount(0);
  await owner.goto("/app");
  await foot(owner).getByRole("link", { name: away }).click();
  await expect(card.getByRole("status")).toContainText("Cannot be reached:");

  // One click beside the drive: the same drive is checked again at once, and nothing is lost.
  await card.getByRole("button", { name: "Reconnect" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Drive connected again. InboxCA is checking it now." })).toBeVisible();
  expect(await drive()).toEqual([connected]);
  expect(await query(local.dbUrl, "select actor_id, details from public.activity_log where firm_id = $1 and action = 'drive.reconnected'", [firm.firmId])).toEqual([{ actor_id: firm.ownerId, details: { provider: "local" } }]);

  // The check reaches the drive: the alert clears, and the job that waited goes once more.
  await runJobs(request, firm.firmId);
  expect(await query(local.dbUrl, "select status from public.requests where firm_id = $1 and entity_type = 'drive_away'", [firm.firmId])).toEqual([{ status: "done" }]);
  expect(await query(local.dbUrl, "select state from public.jobs where idempotency_key = $1", [`${waited}:again`])).toEqual([{ state: "done" }]);
  expect(await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'drive.back'", [firm.firmId])).toEqual([{ details: { jobs: 1 } }]);
  for (const page of [owner, staff]) {
    await page.reload();
    await expect(foot(page)).toContainText("Drive linked");
  }
  await expect(card.getByRole("status")).toContainText("Connected:");
});

test("Reconnect signs in to the same Dropbox again, and saves its account for change notices", async () => {
  await owner.goto("/app/settings?group=email");
  const card = owner.locator("section#drive");
  await card.getByRole("button", { name: "Disconnect" }).click();
  await card.getByLabel("Dropbox").check();
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toContainText(`Connected: Dropbox, ${account.email}`);
  const [connected] = await drive();
  expect(connected.account).toBe(createHash("sha256").update(account.id).digest("hex"));

  // A drive connected before change notices kept no account; Reconnect saves it, and a new
  // sign in, on the same record.
  await query(local.dbUrl, "update public.connected_accounts set settings = settings - 'dropbox_account' where id = $1", [connected.id]);
  await card.getByRole("button", { name: "Reconnect" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Drive connected again." })).toBeVisible();
  const [again] = await drive();
  expect(again).toMatchObject({ id: connected.id, account: connected.account });
  expect(again.credentials_enc).not.toBe(connected.credentials_enc);

  // Another Dropbox account is refused, as this drive's papers are not in it.
  account.id = `dbid:AAInventedOther${tag}`;
  await card.getByRole("button", { name: "Reconnect" }).click();
  await expect(card.getByRole("alert")).toHaveText("That is a different Dropbox account. Sign in with the one already connected, or disconnect it first.");
  expect(await drive()).toEqual([again]);
});
