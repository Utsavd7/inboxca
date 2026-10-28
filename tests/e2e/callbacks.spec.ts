import { createHash, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Page } from "@playwright/test";
import { ONEDRIVE_TEST_URL } from "../../playwright.config";
import { serverCrypto } from "@/src/lib/crypto";
import { fakeOneDrive } from "../fake-onedrive";
import { pdf } from "../fixtures/pdf";
import { addPerson, appKey, connectTestMailbox, localSupabase, query, runJobs, seedFirm, signIn } from "./local-supabase";

// The links that leave InboxCA or come back to it: Dropbox's return after Connect, refused
// whenever it is not the owner's own Connect (no real Dropbox is asked), an email opened in
// the firm's own mailbox, and OneDrive's Connect, against the fake Microsoft in
// tests/fake-onedrive.ts. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const key = appKey();
const ownerEmail = `callbacks-owner-${tag}@example.test`;
const staffEmail = `callbacks-staff-${tag}@example.test`;
const office = `callbacks-office-${tag}@firm.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let other: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let staff: Page;
const onedrive = fakeOneDrive();

// What Connect keeps in the browser for Dropbox's return: its state and the PKCE verifier.
const connectCookie = (value: string) => ({ name: "inboxca_drive_connect", value, domain: "127.0.0.1", path: "/api/drive", httpOnly: true });
const asConnect = (state: string) => Buffer.from(JSON.stringify({ state, verifier: "invented-verifier" })).toString("base64url");
const drives = async () => (await query(local.dbUrl, "select provider from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId])).length;

test.beforeAll(async ({ browser }) => {
  await onedrive.listen(Number(new URL(ONEDRIVE_TEST_URL).port));
  firm = await seedFirm(`Callbacks Firm ${tag}`, ownerEmail, key);
  other = await seedFirm(`Callbacks Other Firm ${tag}`, `callbacks-other-${tag}@example.test`);
  await addPerson(firm.firmId, staffEmail, "staff", key);
  owner = await (await browser.newContext()).newPage();
  staff = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, key);
  await signIn(staff, staffEmail, key);
});
test.afterAll(async () => {
  await firm.remove(staffEmail);
  await other.remove();
  await onedrive.close();
});

test("Dropbox's return connects nothing unless it answers the owner's own Connect", async () => {
  const back = async (page: Page, search: string, message: string) => {
    await page.goto(`/api/drive/callback${search}`);
    await expect(page).toHaveURL(/\/app\/settings\?group=email&error=drive_(failed|denied)#drive$/);
    await expect(page.locator("section#drive").getByRole("alert")).toHaveText(message);
    // The connect cookie is gone, so the same return cannot be tried again.
    expect((await page.context().cookies()).filter((cookie) => cookie.name === "inboxca_drive_connect")).toEqual([]);
  };
  const failed = "The drive did not finish connecting. Try again.";
  // The owner pressed Cancel on Dropbox's page.
  await owner.context().addCookies([connectCookie(asConnect("state-one"))]);
  await back(owner, "?error=access_denied&state=state-one", "You did not allow InboxCA on your drive's sign in page, so the drive is not connected. Connect again and choose Allow.");
  // No Connect started in this browser.
  await back(owner, "?state=state-one&code=invented-code", failed);
  // Another Connect's state, or no code.
  await owner.context().addCookies([connectCookie(asConnect("state-two"))]);
  await back(owner, "?state=state-one&code=invented-code", failed);
  await owner.context().addCookies([connectCookie(asConnect("state-three"))]);
  await back(owner, "?state=state-three", failed);
  // A cookie changed by hand.
  await owner.context().addCookies([connectCookie("not-a-connect-cookie")]);
  await back(owner, "?state=state-four&code=invented-code", failed);
  // Only the owner connects the drive, even with a matching state and a code.
  await staff.context().addCookies([connectCookie(asConnect("state-five"))]);
  await staff.goto("/api/drive/callback?state=state-five&code=invented-code");
  await expect(staff).toHaveURL(/error=drive_failed#drive$/);
  expect((await staff.context().cookies()).filter((cookie) => cookie.name === "inboxca_drive_connect")).toEqual([]);
  expect(await drives()).toBe(0);
});

test("an email opens in the firm's own mailbox, and only the firm's own email opens", async ({ browser }) => {
  await connectTestMailbox(owner, office);
  const [{ id: account }] = await query(local.dbUrl, "select id from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm.firmId]);
  const messageId = `<invented-${tag}@client.test>`;
  const [{ id: mail }] = await query(local.dbUrl, "insert into public.email_events (firm_id, account_id, provider_message_id, sender_bidx, received_at) values ($1, $2, $3, 'invented', now()) returning id", [firm.firmId, account, messageId]);
  const open = (page: Page, id: string) => page.request.get(`/app/inbox/${id}/open`, { maxRedirects: 0 });

  // A mailbox with no web page of its own says where to look.
  const here = await open(owner, mail);
  expect(here.status()).toBe(404);
  expect(await here.text()).toContain("Open this email in your firm email&#39;s own website or app.");
  // Gmail opens at that one email, in the firm's own account.
  await query(local.dbUrl, "update public.connected_accounts set status = 'needs_reconnect', settings = jsonb_set(settings, '{imap,host}', '\"imap.gmail.com\"') where id = $1", [account]);
  const gmail = await open(staff, mail);
  expect(gmail.status()).toBe(307);
  expect(gmail.headers().location).toBe(`https://mail.google.com/mail/?authuser=${encodeURIComponent(office)}#search/${encodeURIComponent(`rfc822msgid:invented-${tag}@client.test`)}`);

  // Another firm's email, or none, is not there.
  const [{ id: theirs }] = await query(local.dbUrl, "insert into public.connected_accounts (firm_id, kind, provider, address_enc, credentials_enc, status) values ($1, 'mail', 'imap', 'invented', 'invented', 'needs_reconnect') returning id", [other.firmId]);
  const [{ id: theirMail }] = await query(local.dbUrl, "insert into public.email_events (firm_id, account_id, provider_message_id, sender_bidx, received_at) values ($1, $2, $3, 'invented', now()) returning id", [other.firmId, theirs, messageId]);
  for (const id of [theirMail, randomUUID(), "not-an-id"]) {
    const refused = await open(owner, id);
    expect(refused.status()).toBe(404);
    expect(await refused.text()).toContain("This email is not available.");
  }
  // Signed out, it asks for a sign in first.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/app/inbox/${mail}/open`);
  await expect(visitor).toHaveURL(/\/sign-in/);
  await visitor.context().close();
});

test("OneDrive connects on Microsoft's own page, saves a paper in the client's folder, and keeps its sign in fresh", async ({ request }) => {
  const card = owner.locator("section#drive");
  const drive = async () => (await query(local.dbUrl, "select id, credentials_enc, settings ->> 'onedrive_account' as account from public.connected_accounts where firm_id = $1 and kind = 'drive' and provider = 'onedrive'", [firm.firmId]))[0];
  await owner.goto("/app/settings?group=email");
  await card.getByLabel("OneDrive").check();
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toContainText(`Connected: OneDrive, ${onedrive.drive.email}`);
  const connected = await drive();
  expect(connected.account).toBe(createHash("sha256").update(onedrive.drive.id).digest("hex"));
  expect(onedrive.file("/InboxCA")).toBeDefined();
  // InboxCA sets it up by itself, with a test file saved, read back and removed.
  await runJobs(request, firm.firmId);
  await owner.reload();
  await expect(card.getByRole("list", { name: "What InboxCA set up" })).toContainText("Saved a test file, read it back and removed it");

  // A paper uploaded on the client's page goes into their folder in the drive, under InboxCA's name.
  const client = `OneDrive Client ${tag}`;
  const [{ id }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'business') returning id", [firm.firmId, client]);
  const bills = Buffer.from(pdf("Invented sales bills"));
  await owner.goto(`/app/clients/${id}?tab=documents`);
  await owner.getByRole("link", { name: "Upload papers" }).click();
  await owner.getByRole("dialog").getByLabel("Files", { exact: true }).setInputFiles([{ name: "sales_bills_sep_2026.pdf", mimeType: "application/pdf", buffer: bills }]);
  await owner.getByRole("dialog").getByRole("button", { name: "Upload", exact: true }).click();
  const row = owner.locator("section[aria-labelledby=files] tbody tr").filter({ hasText: "Sales bills - Sep 2026.pdf" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("To check");
  const [paper] = await query(local.dbUrl, "select name, drive_file_id from public.documents where firm_id = $1", [firm.firmId]);
  expect(paper.name).toBe(`${client} - Sales bills - Sep 2026.pdf`);
  const saved = onedrive.file(`/InboxCA/FY 2026-27/${client}/GST/${paper.name}`);
  expect(saved?.id).toBe(paper.drive_file_id);
  expect(saved?.bytes?.equals(bills)).toBe(true);

  // Microsoft renews the refresh token at each use; the newest is saved once a day, and logged.
  loadEnvConfig(process.cwd());
  const crypto = serverCrypto();
  const sealed = JSON.parse(await crypto.decrypt(firm.firmId, `accounts/${connected.id}/credentials`, connected.credentials_enc));
  await query(local.dbUrl, "update public.connected_accounts set credentials_enc = $2 where id = $1", [connected.id, await crypto.encrypt(firm.firmId, `accounts/${connected.id}/credentials`, JSON.stringify({ ...sealed, at: 0 }))]);
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'drive_check', 'account', $2, $3)", [firm.firmId, connected.id, `drive_check:${randomUUID()}`]);
  await runJobs(request, firm.firmId);
  const renewed = JSON.parse(await crypto.decrypt(firm.firmId, `accounts/${connected.id}/credentials`, (await drive()).credentials_enc));
  expect(renewed.refreshToken).not.toBe(sealed.refreshToken);
  expect(renewed.at).toBeGreaterThan(0);
  expect(await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'drive.token_saved'", [firm.firmId])).toEqual([{ details: { provider: "onedrive" } }]);
  expect(await query(local.dbUrl, "select status from public.documents where firm_id = $1", [firm.firmId])).toEqual([{ status: "filed" }]);

  // Reconnect signs in to the same OneDrive again and keeps its record; another account is refused.
  await owner.goto("/app/settings?group=email");
  await card.getByRole("button", { name: "Connect again" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Drive connected again." })).toBeVisible();
  expect(await drive()).toMatchObject({ id: connected.id, account: connected.account });
  onedrive.drive.id = `invented-other-drive-${tag}`;
  await card.getByRole("button", { name: "Connect again" }).click();
  await expect(card.getByRole("alert")).toHaveText("That is a different account from the one connected. Sign in with the one already connected, or disconnect it first.");
  expect((await drive()).account).toBe(connected.account);
});
