import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { addPerson, appKey, connectTestMailbox, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// The links that leave InboxCA or come back to it: Dropbox's return after Connect, refused
// whenever it is not the owner's own Connect (no real Dropbox is asked), and an email opened in
// the firm's own mailbox. Skipped when local Supabase is not running.
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

// What Connect keeps in the browser for Dropbox's return: its state and the PKCE verifier.
const connectCookie = (value: string) => ({ name: "inboxca_drive_connect", value, domain: "127.0.0.1", path: "/api/drive", httpOnly: true });
const asConnect = (state: string) => Buffer.from(JSON.stringify({ state, verifier: "invented-verifier" })).toString("base64url");
const drives = async () => (await query(local.dbUrl, "select provider from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId])).length;

test.beforeAll(async ({ browser }) => {
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
    expect(await refused.text()).toBe("This email is not available.");
  }
  // Signed out, it asks for a sign in first.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/app/inbox/${mail}/open`);
  await expect(visitor).toHaveURL(/\/sign-in/);
  await visitor.context().close();
});
