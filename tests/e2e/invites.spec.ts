import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID, type ECDH } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { serverCrypto } from "@/src/lib/crypto";
import { TEST_DRIVE, TEST_WORKER_SECRET, TEST_WORKSPACE } from "../../playwright.config";
import { financialYear } from "@/src/lib/drive";
import { laterBy } from "@/src/lib/hours";
import { personName } from "@/src/lib/roles";
import { pdf } from "@/tests/fixtures/pdf";
import { actionFields, askForCode, emailStep, latestEmail, localSupabase, pollFirmMail, query, runJobs, seedFirm, totp } from "./local-supabase";

// The Office only switch sits under Change details in Settings' Access preset card.
const officeSwitch = async (page: Page) => {
  // An old #office link first opens the right group of Settings; a save just before may
  // still redraw the page, which closes the details again, so wait and retry until it stays open.
  await page.waitForLoadState("networkidle");
  await page.locator("#office details.office-switch > summary").waitFor();
  await expect(async () => {
    if (!(await page.locator("#office details.office-switch[open]").count())) await page.locator("#office details.office-switch > summary").click();
    await expect(page.locator("#office details.office-switch[open]")).toHaveCount(1, { timeout: 1000 });
  }).toPass();
};

// Turn on, retried until the click lands: the page may still be redrawing after a save.
const turnOn = async (page: Page) => {
  await expect(async () => {
    await officeSwitch(page);
    await page.getByRole("button", { name: "Turn on", exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
};

// The owner invites a new person, who signs in from the invite email, sets up a 2 step
// code and joins the firm. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `owner-${tag}@example.test`;
const newEmail = `new-${tag}@example.test`;
const deputyEmail = `deputy-${tag}@example.test`;
const emailOnly = `email-only-${tag}@example.test`;
const laptopEmail = `laptop-${tag}@example.test`;
// GreenMail makes a mailbox for every address it receives mail for, its password the address.
const mailboxEmail = `office-${tag}@firm.test`;
const mailClient = `Mail Client ${tag}`;
const pcUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

// The newest message in a test mailbox on the GreenMail server, which makes a mailbox for
// every address it receives mail for.
// What the owner's browser does with a push (RFC 8291): open the message sealed for it.
function openPush(body: Buffer, browser: ECDH, auth: Buffer) {
  const salt = body.subarray(0, 16);
  const server = body.subarray(21, 21 + body[20]);
  const ikm = Buffer.from(hkdfSync("sha256", browser.computeSecret(server), auth, Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), server]), 32));
  const derive = (label: string, length: number) => Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(`Content-Encoding: ${label}\0`), length));
  const sealed = body.subarray(21 + body[20]);
  const decipher = createDecipheriv("aes-128-gcm", derive("aes128gcm", 16), derive("nonce", 12));
  decipher.setAuthTag(sealed.subarray(-16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

// GreenMail makes a mailbox only when its first email arrives, so until then signing in to
// it fails; that reads as no mail yet, and a waiting expect.poll keeps trying.
async function lastMail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  try {
    await imap.connect();
    if (!(await imap.mailboxOpen("INBOX")).exists) return "";
    const message = await imap.fetchOne("*", { source: true });
    return message && message.source ? ((await simpleParser(message.source)).text ?? "") : "";
  } catch {
    return "";
  } finally {
    await imap.logout().catch(() => undefined);
  }
}
async function mailCount(address:string) {
  const imap=new ImapFlow({host:"127.0.0.1",port:3143,secure:false,auth:{user:address,pass:address},logger:false});
  try { await imap.connect(); return (await imap.mailboxOpen("INBOX")).exists; } catch { return 0; } finally { await imap.logout().catch(() => undefined); }
}
// A base32 authenticator key, given to the owner directly so their sign in is quick.
const deputyKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
const ownerKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let person: Page;
let personKey = "";

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Invite Test Firm", ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  person = await (await browser.newContext({ userAgent: pcUserAgent })).newPage();
  await nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true }).sendMail({ from: "setup@invented.test", to: mailboxEmail, subject: "Invented test setup", text: "Makes the test mailbox" });
});
test.afterAll(async () => {
  await firm.remove(newEmail, emailOnly, deputyEmail, laptopEmail, mailboxEmail);
  // Also the invented return types, even when a test stopped before removing its own.
  await query(local.dbUrl, "delete from public.compliance_types where code = any($1)", [[`HR${tag.toUpperCase()}`, `TR${tag.toUpperCase()}`]]);
});

test("the owner invites a new person, who appears as invited", async () => {
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "People" }).click();
  await expect(owner.getByText(ownerEmail)).toBeVisible();
  await owner.getByRole("link", { name: "Invite person" }).click();
  await owner.getByLabel("Their work email").fill(newEmail.toUpperCase());
  await owner.getByLabel("Role").selectOption("manager");
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${newEmail}`);
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row).toContainText("Manager");
  await expect(row).toContainText("Invited");
  // Orelu's system email names the firm; the sign in code comes separately.
  await expect.poll(() => lastMail(newEmail), { timeout: 15_000 }).toContain("It has invited you to join its team.");
  expect(await lastMail(newEmail)).toMatch(/To join, go to http\S+\/sign-in and enter this email address/);

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already on your firm's list" })).toBeVisible();
});

test("the invited person signs in from the email, sets up 2 step and joins", async ({ baseURL }) => {
  const page = person;
  const { link } = await latestEmail(local.mailUrl, newEmail);
  const target = new URL(link!);
  await page.goto(`${baseURL}${target.pathname}${target.search}`);
  await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  personKey = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill(totp(personKey));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Invite Test Firm has invited you as manager.")).toBeVisible();
  await page.getByRole("button", { name: "Join Invite Test Firm" }).click();
  await expect(page.locator(".rail-firm")).toContainText("Invite Test Firm");
  await expect(page.locator(".rail-me")).toContainText("Manager");
  // A manager's sidebar has People but not Settings, which is the owner's.
  await expect(page.getByRole("link", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByText(/has invited you/)).toHaveCount(0);

  // Only the owner invites.
  await page.getByRole("link", { name: "People", exact: true }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite person" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Change/ })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row).toContainText("Manager");
  await expect(row).not.toContainText("Invited");
});

// #5: removing a person closes access on their next request.
test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  // Changes open in a panel beside the list.
  await row.getByRole("link", { name: `Change ${newEmail}` }).click();
  const panel = owner.getByRole("dialog", { name: personName(newEmail) });
  await panel.getByLabel("Role").selectOption("staff");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(row).toContainText("Staff");
  await expect(owner.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  await owner.reload();
  await expect(panel.getByLabel("Role")).toHaveValue("staff");

  // Removing asks once more before it takes access away.
  await panel.getByRole("link", { name: "Remove from the firm" }).click();
  await panel.getByRole("button", { name: "Yes, remove from the firm" }).click();
  await expect(row).toContainText("Removed");
  await panel.getByRole("button", { name: "Restore" }).click();
  await expect(panel.getByRole("link", { name: "Remove from the firm" })).toBeVisible();
  await expect(row).toContainText("Active");
});

// #1, #2, #3, #24, #25, #35, #37, #39, #40, #41, #49, #55: the same approved PC, fresh browsers and changed connections.
test("under Office only, staff need the office connection and an approved PC", async ({ browser }) => {
  // The test server reads each request's address from this header, as it would Cloudflare's.
  await owner.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await owner.goto("/app/settings#office");
  await officeSwitch(owner);
  // The switch asks nothing itself: Turn on sends the preset's answer.
  await expect(owner.getByText("Are you in your office right now?")).toHaveCount(0);
  await owner.getByLabel("Yes, I am in the office now").check();
  await officeSwitch(owner);
  await turnOn(owner);
  await expect(owner.getByRole("status").filter({ hasText: "On." })).toContainText("You are on your office internet connection now.");
  // No PC stays in the office yet, so the owner is told how to get a fixed connection, once.
  await expect(owner.getByText("ask your internet provider for a fixed internet address")).toBeVisible();
  await owner.getByRole("button", { name: "My provider doesn't offer it" }).click();
  await expect(owner.getByText("ask your internet provider for a fixed internet address")).toHaveCount(0);
  await expect(owner.getByText("approve one office desktop as an office PC")).toBeVisible();

  await person.setExtraHTTPHeaders({ "x-test-ip": "198.51.100.7" });
  await person.goto("/app");
  await expect(person.getByRole("heading", { name: "Use InboxCA from the office" })).toBeVisible();
  await person.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();

  await owner.goto("/app");
  await expect(owner.locator("section[aria-labelledby=t-list] li").filter({ hasText: "Approve 1 PC" })).toContainText("Signed in from your office today");
  await owner.goto("/app/settings#office");
  await expect(owner.getByText(/New on Chrome on Windows, first seen today/)).toBeVisible();
  await owner.getByRole("button", { name: "Approve as office PC" }).click();
  await expect(owner.getByText(/New on Chrome on Windows, first seen today/)).toHaveCount(0);
  expect(await query(local.dbUrl, "select status, kind from public.devices where firm_id = $1", [firm.firmId])).toEqual([{ status: "approved", kind: "office" }]);
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // The same person in another browser waits for its own approval.
  const secondContext = await browser.newContext({ userAgent: pcUserAgent });
  const second = await secondContext.newPage();
  await second.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await emailStep(second, newEmail);
  await second.getByLabel("6 digit code from the app").fill(totp(personKey));
  await second.getByRole("button", { name: "Continue" }).click();
  await expect(second.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();
  expect((await secondContext.cookies()).some((cookie) => cookie.name === "inboxca_device")).toBe(true);
  expect(await query(local.dbUrl, "select status from public.devices where firm_id = $1 order by status", [firm.firmId])).toEqual([{ status: "approved" }, { status: "waiting" }]);
  await owner.reload();
  await owner.getByRole("button", { name: "Approve as laptop" }).click();
  await expect(owner.getByRole("button", { name: "Approve as laptop" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select count(*)::int as count from public.activity_log where firm_id = $1 and action = 'device.approved'", [firm.firmId])).toEqual([{ count: 2 }]);
  await second.goto("/app/clients");
  await expect(second.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await secondContext.close();
  // Signing in on the second PC ended this person's session on the first.
  await person.goto("/app/clients");
  await expect(person).toHaveURL(/\/sign-in/);

  // The approved office PC replaces the phone code for staff.
  await emailStep(person, newEmail);
  await expect(person).toHaveURL(/\/app$/);
  await person.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // A staff member without an authenticator app also uses an already approved office PC.
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data: emailOnlyUser, error: emailOnlyError } = await admin.auth.admin.createUser({ email: emailOnly, email_confirm: true });
  expect(emailOnlyError).toBeNull();
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, emailOnlyUser.user!.id]);
  await person.locator(".rail-me").click();
  await person.getByRole("menuitem", { name: "Sign out" }).click();
  await emailStep(person, emailOnly);
  await expect(person).toHaveURL(/\/app$/);
  await person.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await person.locator(".rail-me").click();
  await person.getByRole("menuitem", { name: "Sign out" }).click();
  await emailStep(person, newEmail);
  await expect(person).toHaveURL(/\/app$/);

  // An approved laptop still loses access when it leaves the office connection.
  await query(local.dbUrl, "update public.devices set kind = 'laptop' where firm_id = $1 and kind = 'office'", [firm.firmId]);
  await person.setExtraHTTPHeaders({ "x-test-ip": "198.51.100.7" });
  await person.goto("/app/clients");
  await expect(person).toHaveURL(/\/sign-in\/two-step$/);
  await expect(person.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();

  // A new browser on the office connection still needs the phone code and sees no firm data.
  const waitingContext = await browser.newContext({ userAgent: pcUserAgent });
  const waiting = await waitingContext.newPage();
  await waiting.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await emailStep(waiting, newEmail);
  await expect(waiting).toHaveURL(/\/sign-in\/two-step$/);
  await waiting.goto("/app/clients");
  await expect(waiting).toHaveURL(/\/sign-in\/two-step$/);
  expect(await query(local.dbUrl, "select count(*)::int as count from public.devices where firm_id = $1 and status = 'waiting'", [firm.firmId])).toEqual([{ count: 1 }]);
  await waitingContext.close();

  // The owner still needs the phone code from the office.
  await owner.locator(".rail-me").click();
  await owner.getByRole("menuitem", { name: "Sign out" }).click();
  await emailStep(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/sign-in\/two-step$/);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  // Off again, staff reach the firm from anywhere.
  await owner.goto("/app/settings#office");
  await officeSwitch(owner);
  await owner.getByRole("button", { name: "Turn off" }).click();
  await expect(owner.getByText("are you in the office now?")).toBeAttached();
  await person.getByLabel("6 digit code from the app").fill(totp(personKey));
  await person.getByRole("button", { name: "Continue" }).click();
  await person.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await owner.setExtraHTTPHeaders({});
  await person.setExtraHTTPHeaders({});
});

// #7, #10, #18, #32, #33, #34, #36, #48, #51: deputies and temporary connections.
test("deputies approve PCs, office PCs confirm changes, and laptops wait for today's approval", async ({ browser }) => {
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email: deputyEmail, email_confirm: true });
  expect(error).toBeNull();
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'partner', 'active')", [firm.firmId, data.user!.id]);
  // The laptop is another staff member's: one person's sign in ends their other session.
  const { data: laptopUser } = await admin.auth.admin.createUser({ email: laptopEmail, email_confirm: true });
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, laptopUser.user!.id]);
  for (const [id, key] of [[data.user!.id, deputyKey], [laptopUser.user!.id, deputyKey]])
    await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())", [id, key]);
  await owner.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await owner.goto("/app/settings#office");
  await owner.reload();
  await expect(owner.getByLabel(deputyEmail, { exact: true })).toBeVisible();
  await owner.getByLabel(deputyEmail, { exact: true }).check();
  // Wait for the save, so the page it redraws is the one the switch opens on.
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("button", { name: "Save deputies" }).click()]);
  await expect(owner.getByLabel(deputyEmail, { exact: true })).toBeChecked();
  await officeSwitch(owner);
  await turnOn(owner);

  const deputy = await browser.newPage();
  await emailStep(deputy, deputyEmail);
  await expect(deputy).toHaveURL(/\/sign-in\/two-step$/);
  await deputy.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await deputy.getByRole("button", { name: "Continue" }).click();
  await expect(deputy).toHaveURL(/\/app$/);
  await deputy.goto("/app/settings#office");
  await expect(deputy.getByRole("heading", { name: "Office approvals", exact: true })).toBeVisible();
  await expect(deputy.getByLabel("The firm's email address")).toHaveCount(0);

  const laptop = await browser.newPage({ userAgent: pcUserAgent });
  await laptop.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await emailStep(laptop, laptopEmail);
  await laptop.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await laptop.getByRole("button", { name: "Continue" }).click();
  await expect(laptop.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();
  const { deviceHash } = await import("../../src/lib/device");
  const laptopCookie = (await laptop.context().cookies()).find((cookie) => cookie.name === "inboxca_device")!;
  await query(local.dbUrl, "update public.devices set name = 'Travel laptop' where firm_id = $1 and token_hash = $2", [firm.firmId, await deviceHash(laptopCookie.value)]);
  await deputy.reload();
  const laptopRow = deputy.getByRole("listitem").filter({ hasText: "Travel laptop" });
  await laptopRow.getByRole("button", { name: "Approve as laptop", exact: true }).click();
  await expect(laptopRow.getByRole("button", { name: "Approve as laptop", exact: true })).toHaveCount(0);
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();

  // The signed browser secret identifies this approved PC, not the person using it.
  const deviceCookie = (await person.context().cookies()).find((cookie) => cookie.name === "inboxca_device")!;
  await query(local.dbUrl, "update public.devices set kind = 'office', name = 'Reception PC' where firm_id = $1 and token_hash = $2", [firm.firmId, await deviceHash(deviceCookie.value)]);
  // Without its own key a PC that stays in the office waits on a new connection like a laptop.
  await person.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.20" });
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "Waiting for the office connection" })).toBeVisible();

  await laptop.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.30" });
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Waiting for the office connection" })).toBeVisible();
  await deputy.goto("/app");
  const request = deputy.locator("section[aria-labelledby=t-list] li").filter({ hasText: "Travel laptop is on a new internet connection" });
  await expect(request).toBeVisible();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await query(local.dbUrl, "update public.firms set settings = settings || $2 where id = $1", [firm.firmId, { special_hours: [{ from: today, to: today, open: "00:00", close: "23:59" }] }]);
  await request.getByRole("button", { name: /^Allow today/ }).click();
  await expect(request).toHaveCount(0);
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  const [{ lines }] = await query(local.dbUrl, "select settings -> 'office' -> 'lines' as lines from public.firms where id = $1", [firm.firmId]);
  expect(lines.find((line: { ipv4: string; until?: string }) => line.ipv4 === "203.0.113.30").until).toContain("18:29:00");

  await deputy.goto("/app/settings#office");
  await deputy.reload();
  await deputy.locator(".note").filter({ hasText: "Reception PC is on a new internet connection" }).getByRole("button", { name: "This is my office", exact: true }).click();
  await expect(deputy.getByText("Reception PC is on a new internet connection", { exact: false })).toHaveCount(0);
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await owner.goto("/app/settings#office");
  await officeSwitch(owner);
  await owner.getByRole("button", { name: "Turn off", exact: true }).click();
  await query(local.dbUrl, "update public.firms set settings = settings - 'special_hours' where id = $1", [firm.firmId]);
  await person.setExtraHTTPHeaders({});
  await owner.setExtraHTTPHeaders({});
  await deputy.close();
  await laptop.close();
});

// #32, #36, #38, #50: a real browser key, a changed line and withdrawal.
test("a PC that stays in the office sets up its own key, then confirms a new office connection with it", async ({ browser, baseURL }) => {
  await owner.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await owner.goto("/app/settings#office");
  await owner.reload();
  await officeSwitch(owner);
  await turnOn(owner);
  await expect(owner.getByRole("button", { name: "Turn off", exact: true, includeHidden: true })).toBeAttached();

  // Browsers make keys only for a named site, so this PC uses localhost; its key is Chrome's
  // virtual one, kept on the PC like Windows Hello's.
  const context = await browser.newContext({ baseURL: baseURL!.replace("127.0.0.1", "localhost"), userAgent: pcUserAgent, extraHTTPHeaders: { "x-test-ip": "203.0.113.10" } });
  const reception = await context.newPage();
  const cdp = await context.newCDPSession(reception);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await emailStep(reception, laptopEmail);
  await reception.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await reception.getByRole("button", { name: "Continue" }).click();
  await expect(reception.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();
  // Signing in again while it waits, the 2 step code is asked.
  await reception.goto("/auth/sign-out");
  await emailStep(reception, laptopEmail);
  await expect(reception).toHaveURL(/\/sign-in\/two-step$/);
  await expect(reception.getByRole("button", { name: "Sign in without the code" })).toHaveCount(0);
  await owner.reload();
  const waitingPc = owner.getByRole("listitem").filter({ hasText: "Laptop on Chrome on Windows, first seen today" });
  await waitingPc.getByRole("button", { name: "Approve as office PC" }).click();
  await expect(waitingPc).toHaveCount(0);

  // Approved while its 2 step page waits: in the office, the email code is then enough.
  await reception.reload();
  await reception.getByRole("button", { name: "Sign in without the code" }).click();
  await expect(reception).toHaveURL(/\/app$/);
  await reception.getByRole("button", { name: "Set up this office PC" }).click();
  await expect(reception.getByRole("button", { name: "Set up this office PC" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select count(*)::int as count from public.devices where firm_id = $1 and kind = 'office' and key_public is not null", [firm.firmId])).toEqual([{ count: 1 }]);

  // The office connection changes overnight: the PC confirms it with its key and the owner is told.
  await reception.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.40" });
  // Signed in with the email code alone, a connection the office does not know asks for the 2 step code.
  await reception.goto("/app/clients");
  await expect(reception).toHaveURL(/\/sign-in\/two-step$/);
  await reception.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await reception.getByRole("button", { name: "Continue" }).click();
  await expect(reception).toHaveURL(/\/app$/);
  await reception.goto("/app/clients");
  await reception.getByRole("button", { name: "Confirm from this PC" }).click();
  await expect(reception.getByRole("button", { name: "Confirm from this PC" })).toHaveCount(0);
  await reception.goto("/app/clients");
  await expect(reception.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await owner.goto("/app");
  const changed = owner.locator("section[aria-labelledby=t-list] li").filter({ hasText: "Your office internet connection changed today" });
  await expect(changed).toBeVisible();

  // Withdrawn by the owner, the connection goes and the PC waits again.
  await changed.getByRole("button", { name: "Not my office" }).click();
  await expect(changed).toHaveCount(0);
  await reception.goto("/app/clients");
  await expect(reception.getByRole("heading", { name: "Waiting for the office connection" })).toBeVisible();
  await owner.goto("/app/settings#office");
  await officeSwitch(owner);
  await owner.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(owner.getByText("are you in the office now?")).toBeAttached();
  await owner.setExtraHTTPHeaders({});
  await context.close();
});

// #19, #21, #27, #45, #47: request routing, one use, Always allow and withdrawal.
test("a staff member asks to upload; the owner allows it once from the Inbox", async () => {
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(`Ask Client ${tag}`);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(`Ask Client ${tag}`);
  const files = `${owner.url().split("?")[0]}?tab=files`;

  // The owner turned on phone notifications in one browser: here, a local push service.
  const browserKey = createECDH("prime256v1");
  const auth = randomBytes(16);
  const pushes: { headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];
  const pushService = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk)).on("end", () => {
      pushes.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => pushService.listen(0, "127.0.0.1", resolve));
  const [{ id: ownerId }] = await query(local.dbUrl, "select id from auth.users where email = $1", [ownerEmail]);
  await query(local.dbUrl, "insert into public.push_subscriptions (user_id, endpoint, keys) values ($1, $2, $3)", [
    ownerId, `http://127.0.0.1:${(pushService.address() as { port: number }).port}/push`, { p256dh: browserKey.generateKeys("base64url"), auth: auth.toString("base64url") },
  ]);

  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload papers" })).toHaveCount(0);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByRole("status")).toContainText("Permission asked.");
  // Within seconds the owner's browser gets it, sealed for that browser alone, naming no client.
  // Only the question counts: the note about the PCs added above, a minute after the first of
  // them, can fall due in the same sweep.
  const questions = () => pushes.filter((push) => JSON.parse(openPush(push.body, browserKey, auth)).title !== "PCs to approve");
  await expect.poll(() => questions().length, { timeout: 15_000 }).toBe(1);
  const [push] = questions();
  expect(push.headers["content-encoding"]).toBe("aes128gcm");
  expect(String(push.headers.authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const message = JSON.parse(openPush(push.body, browserKey, auth));
  expect(message).toEqual({ title: "A permission request for you", body: "New asks to upload a paper.", url: "/app/inbox" });
  // #20, #57: an email copy too, whose link only opens the Inbox.
  await expect.poll(() => lastMail(ownerEmail), { timeout: 15_000 }).toContain("New asks to upload a paper.");
  expect(await lastMail(ownerEmail)).toMatch(/Open InboxCA to see it: http\S+\/app\/inbox\n\nThis link only opens InboxCA\. Nothing changes until you sign in and choose\./);
  pushService.close();
  await query(local.dbUrl, "delete from public.push_subscriptions where user_id = $1", [ownerId]);
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();

  // #19: an unanswered question expires, and the person can ask again.
  const [{ id: expired, expires_at: expires }] = await query(local.dbUrl, "select id, expires_at from public.requests where firm_id=$1 and kind='permission' and status='pending'", [firm.firmId]);
  expect(Date.parse(expires) - Date.now()).toBeGreaterThan(3.9 * 3_600_000);
  expect(Date.parse(expires) - Date.now()).toBeLessThanOrEqual(4 * 3_600_000);
  const staleFields = await actionFields(owner, `/app/inbox?answer=${expired}`, { request: expired });
  await query(local.dbUrl, "update public.requests set expires_at=now()-interval '1 second' where id=$1", [expired]);
  await owner.request.post("/app/inbox", { multipart: { ...staleFields, intent: "allow" }, headers: { Origin: new URL(owner.url()).origin } });
  expect((await query(local.dbUrl, "select status from public.requests where id=$1", [expired]))[0].status).toBe("pending");
  await owner.goto("/app/inbox?panel=asks");
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  await person.goto(files);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();

  // The person has no team manager, so the question goes to the owner.
  await owner.goto("/app/inbox?panel=asks");
  const question = owner.locator("section[aria-labelledby=questions] li").filter({ hasText: "New asks to upload a paper" });
  await expect(question).toContainText(`Ask Client ${tag}`);
  // #42, #44, #57: copying an approval form or visiting its address cannot approve it.
  const [{ id: asked }] = await query(local.dbUrl, "select id from public.requests where firm_id=$1 and kind='permission' and status='pending' and expires_at>now()", [firm.firmId]);
  const fields = await actionFields(owner, `/app/inbox?answer=${asked}`, { request: asked });
  const [{ user_id: requester }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id=m.user_id where m.firm_id=$1 and u.email=$2", [firm.firmId, newEmail]);
  await query(local.dbUrl, "update public.firm_members set role='manager' where firm_id=$1 and user_id=$2", [firm.firmId, requester]);
  await person.request.post("/app/inbox", { multipart: { ...fields, intent: "allow" }, headers: { Origin: new URL(person.url()).origin } });
  await query(local.dbUrl, "update public.firm_members set role='staff' where firm_id=$1 and user_id=$2", [firm.firmId, requester]);
  await owner.request.get(`/app/inbox?request=${fields.request}&intent=allow`);
  expect((await query(local.dbUrl, "select status from public.requests where id=$1", [fields.request]))[0].status).toBe("pending");
  expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='approval.denied'", [firm.firmId, requester]))[0].n).toBe(1);
  // Answer opens the question beside the list, by name; the toast can undo the answer.
  await question.getByRole("link", { name: "Answer" }).click();
  const answer = owner.getByRole("dialog", { name: `New asks to upload a paper for Ask Client ${tag}` });
  await answer.getByRole("button", { name: "Refuse" }).click();
  const toast = owner.getByRole("status").filter({ hasText: "Refused." });
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select status from public.requests where id=$1", [fields.request]))[0].status).toBe("pending");
  await owner.goto("/app/inbox?panel=asks");
  await question.getByRole("link", { name: "Answer" }).click();
  await answer.getByRole("button", { name: "Allow once" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "New may upload a paper once, within an hour." })).toBeVisible();
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);

  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload papers" })).toBeVisible();

  const [{ expires_at: grantedUntil }] = await query(local.dbUrl, "select expires_at from public.requests where id=$1", [fields.request]);
  expect(Date.parse(grantedUntil) - Date.now()).toBeGreaterThan(0.9 * 3_600_000);
  expect(Date.parse(grantedUntil) - Date.now()).toBeLessThanOrEqual(3_600_000);

  // Once used the grant is gone. Asked again, the owner always allows it, then withdraws that.
  await query(local.dbUrl, "update public.requests set status = 'used' where firm_id = $1 and kind = 'permission' and status = 'approved'", [firm.firmId]);
  await person.goto(files);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();
  await owner.goto("/app/inbox?panel=asks");
  await owner.locator("section[aria-labelledby=questions] li").filter({ hasText: "asks to upload a paper" }).getByRole("link", { name: "Answer" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Always allow New" }).click();
  // The answer lands before the request leaves the panel; then the person may upload.
  await expect(owner.getByText("asks to upload a paper")).toHaveCount(0);
  await expect(async () => {
    await person.goto(files);
    await expect(person.getByRole("link", { name: "Upload papers" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await owner.goto("/app/settings#permissions");
  const standing = owner.getByRole("listitem").filter({ hasText: /may upload papers.*without asking/ });
  await standing.getByRole("button", { name: "Withdraw" }).click();
  await expect(standing).toHaveCount(0);
  await person.goto(files);
  await expect(person.getByRole("button", { name: "Ask to upload" })).toBeVisible();

  // #47: a changed role right is read on the next request, and reset removes it.
  await owner.getByLabel("Upload papers: staff").check();
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("button", { name: "Save permissions", exact: true }).click()]);
  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload papers" })).toBeVisible();
  // Reset asks once more before it clears the firm's choices.
  await owner.getByRole("link", { name: "Reset to defaults" }).click();
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("button", { name: "Yes, reset", exact: true }).click()]);
  await person.goto(files);
  await expect(person.getByRole("button", { name: "Ask to upload" })).toBeVisible();

  // #21: ten unanswered questions stop an eleventh, even through the normal form.
  await query(local.dbUrl, `with ids as (select gen_random_uuid() id from generate_series(1,10))
    insert into public.requests (id,firm_id,kind,entity_type,entity_id,reason_code,expires_at,details)
    select id,$1,'permission','permission',id,'send',now()+interval '4 hours',jsonb_build_object('by',$2::text,'fixture',$3::text) from ids`, [firm.firmId, requester, tag]);
  await Promise.all([person.waitForResponse((response) => response.request().method() === "POST"), person.getByRole("button", { name: "Ask to upload" }).click()]);
  expect((await query(local.dbUrl, "select count(*)::int n from public.requests where firm_id=$1 and kind='permission' and status='pending' and expires_at>now()", [firm.firmId]))[0].n).toBe(10);
  await query(local.dbUrl, "delete from public.requests where firm_id=$1 and details->>'fixture'=$2", [firm.firmId, tag]);

});

// #28, #48, #51: personal access is for one person, has an end date and only views.
test("away from the office, the owner allows a staff member's own device to view only, until a day", async ({ browser }) => {
  await owner.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await owner.goto("/app/settings#office");
  await officeSwitch(owner);
  await owner.getByLabel("Yes, I am in the office now").check();
  await officeSwitch(owner);
  await turnOn(owner);

  const homeContext = await browser.newContext({ userAgent: pcUserAgent });
  const home = await homeContext.newPage();
  await home.setExtraHTTPHeaders({ "x-test-ip": "198.51.100.50" });
  await emailStep(home, laptopEmail);
  await home.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await home.getByRole("button", { name: "Continue" }).click();
  await expect(home.getByRole("heading", { name: "Use InboxCA from the office" })).toBeVisible();
  await home.getByRole("button", { name: "Ask to use this device away from the office" }).click();
  await expect(home.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();

  await owner.reload();
  const asked = owner.getByRole("listitem").filter({ hasText: "asks to use it away from the office" });
  await asked.getByRole("button", { name: "Approve" }).click();
  await expect(asked).toHaveCount(0);
  await home.goto("/app/clients");
  await expect(home.getByRole("status").filter({ hasText: "can only view papers until" })).toBeVisible();
  await home.getByRole("link", { name: `Ask Client ${tag}` }).click();
  await home.goto(`${home.url().split("?")[0]}?tab=files`);
  await expect(home.getByRole("button", { name: "Ask to upload" })).toHaveCount(0);
  await expect(home.getByRole("link", { name: "Upload papers" })).toHaveCount(0);

  // Withdrawn, the device is refused at once.
  await owner.reload();
  const personal = owner.getByRole("listitem").filter({ hasText: "away from the office until" });
  await personal.getByRole("button", { name: "Withdraw" }).click();
  await expect(personal).toHaveCount(0);
  await home.goto("/app");
  await expect(home.getByRole("heading", { name: "This PC was refused" })).toBeVisible();
  await officeSwitch(owner);
  await owner.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(owner.getByText("are you in the office now?")).toBeAttached();
  await owner.setExtraHTTPHeaders({});
  await homeContext.close();
});

// #14, #15, #16, #17: closing, extra time and season hours. Drafts move to M6.
test("the owner keeps people to office hours, and the person sees the firm is closed", async () => {
  await owner.getByRole("link", { name: "Settings" }).click();
  await owner.getByRole("link", { name: "Hours and holidays" }).click();
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
    await owner.getByRole("row", { name: new RegExp(day) }).getByLabel("Open", { exact: true }).uncheck();
  await owner.getByLabel(/only during office hours/).check();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");

  await owner.getByLabel("Add a holiday").fill("2026-12-25");
  await owner.getByRole("button", { name: "Add holiday" }).click();
  await expect(owner.getByText("Friday, 25 December 2026")).toBeVisible();

  await person.goto("/app");
  await expect(person.getByRole("heading", { name: "Invite Test Firm is closed now" })).toBeVisible();
  await owner.goto("/app");
  await expect(owner.locator(".rail-firm")).toContainText("Invite Test Firm");

  // Special hours for today open the firm again, closed weekdays or not.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await owner.goto("/app/settings?group=hours");
  for (const [label, value] of [["From", today], ["To", today], ["Opens", "00:00"], ["Closes", "23:59"]])
    await owner.getByLabel(label, { exact: true }).fill(value);
  await owner.getByRole("button", { name: "Add special hours" }).click();
  await expect(owner.getByText("00:00 to 23:59")).toBeVisible();
  await person.reload();
  await expect(person.locator(".rail-firm")).toContainText("Invite Test Firm");
  await expect(person.getByRole("heading", { level: 1 })).not.toContainText("closed");

  // Ten minutes before closing the person is warned and may stay one more hour, once.
  const close = new Date(Date.now() + 5 * 60_000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const [{ id: personId }] = await query(local.dbUrl, "select id from auth.users where email = $1", [newEmail]);
  await query(local.dbUrl, "update public.firms set settings = jsonb_set(settings, '{special_hours,0,close}', to_jsonb($2::text)) where id = $1", [firm.firmId, close]);
  await person.reload();
  const warning = person.getByRole("alert").filter({ hasText: `InboxCA closes for you at ${close}` });
  await warning.getByRole("button", { name: "Stay 1 more hour" }).click();
  await expect(warning).toHaveCount(0);
  expect(await query(local.dbUrl, "select access -> 'extra_time' ->> 'until' as until from public.firm_members where user_id = $1", [personId])).toEqual([{ until: laterBy(close, 60) }]);

  // Longer is a question for the owner, who allows it for today.
  await query(local.dbUrl, "update public.firm_members set access = jsonb_set(access, '{extra_time,until}', to_jsonb($2::text)) where user_id = $1", [personId, close]);
  await person.reload();
  await expect(warning.getByRole("button", { name: "Stay 1 more hour" })).toHaveCount(0);
  await warning.getByLabel("How much more time").selectOption("2");
  await warning.getByRole("button", { name: "Ask the owner" }).click();
  await expect(person.getByRole("status").filter({ hasText: "The owner is asked for more time today." })).toBeVisible();
  await owner.goto("/app/inbox?panel=asks");
  const question = owner.locator("section[aria-labelledby=questions] li").filter({ hasText: `asks to work until ${laterBy(close, 120)} today` });
  await question.getByRole("link", { name: "Answer" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Allow today" }).click();
  // The answer saves before the panel lets the question go.
  await expect.poll(async () => await query(local.dbUrl, "select access -> 'extra_time' ->> 'until' as until from public.firm_members where user_id = $1", [personId]), { timeout: 15_000 }).toEqual([{ until: laterBy(close, 120) }]);
  await expect(question).toHaveCount(0);
  await query(local.dbUrl, "update public.firms set settings = jsonb_set(settings, '{special_hours,0,close}', '\"23:59\"') where id = $1", [firm.firmId]);
  await query(local.dbUrl, "update public.firm_members set access = access - 'extra_time' where user_id = $1", [personId]);
});

test("in restricted mode a person sees only clients assigned to them or their team", async () => {
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill("Shared Client");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText("Shared Client");
  const client = owner.url();

  await owner.goto("/app/settings?group=people");
  await owner.getByLabel(/Only you, partners and the people assigned/).check();
  await owner.getByRole("button", { name: "Save who sees clients" }).click();
  await expect(owner.getByRole("status")).toHaveText("Who sees clients saved.");
  await person.goto("/app/clients");
  await expect(person.locator(".page-head")).toContainText("0 clients.");
  // Today's late returns are those of the clients the person can see: none yet.
  await query(local.dbUrl, "insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,'GSTR1_M','2026-01',current_date-30)", [firm.firmId, client.split("/").at(-1)]);
  await person.goto("/app");
  await expect(person.locator("section[aria-labelledby=t-list]")).toBeVisible();
  await expect(person.locator("section[aria-labelledby=t-list]")).not.toContainText("Shared Client");

  // A team: the person joins it, and the client is assigned to the whole team.
  await owner.goto("/app/people?panel=groups");
  await owner.getByLabel("New team").fill("GST team");
  await owner.getByRole("button", { name: "Add team" }).click();
  await expect(owner.locator("section[aria-labelledby=teams]").getByRole("listitem")).toContainText("0 people");
  await owner.getByRole("link", { name: "Close" }).click();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await row.getByRole("link", { name: `Change ${newEmail}` }).click();
  await owner.getByRole("dialog", { name: personName(newEmail) }).getByLabel("Team").selectOption({ label: "GST team" });
  await owner.getByRole("button", { name: "Save changes" }).click();
  await expect(row).toContainText("GST team");
  await owner.goto("/app/people?panel=groups");
  await expect(owner.locator("section[aria-labelledby=teams]").getByRole("listitem")).toContainText("1 person");
  await owner.goto(`${client}?tab=team`);
  await owner.getByLabel("Person or team").selectOption({ label: "Team: GST team" });
  await owner.getByRole("button", { name: "Assign" }).click();
  await expect(owner.getByRole("dialog", { name: "Looked after by" }).getByRole("listitem").filter({ hasText: "Team: GST team" })).toContainText("Staff");
  await person.reload();
  await expect(person.locator("section[aria-labelledby=t-list] li").filter({ hasText: "Shared Client" }).filter({ hasText: /days? late/ }).filter({ visible: true })).toContainText("GSTR-1 (monthly) for Jan 2026");
  await person.goto("/app/clients");
  await expect(person.getByRole("link", { name: "Shared Client" })).toBeVisible();
  await expect(person.locator(".page-head")).toContainText("1 client.");
});

// #3, #4: configured idle lock and the normal sign out control.
test("after the firm's idle limit, an unattended screen signs out", async () => {
  await owner.goto("/app/settings?group=hours");
  await owner.getByLabel(/only during office hours/).uncheck();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");
  await owner.getByRole("link", { name: "Office and sign in" }).click();
  await owner.getByLabel("Sign out after no activity for").selectOption("15");
  await owner.getByRole("button", { name: "Save signing in limits" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Signing in limits saved." })).toBeVisible();

  await person.clock.install();
  await person.goto("/app");
  await expect(person.locator(".rail-firm")).toContainText("Invite Test Firm");
  // A minute before, the screen says so.
  await person.clock.fastForward("14:30");
  await expect(person.getByRole("alert").getByRole("button", { name: "Stay signed in" })).toBeVisible();
  await person.clock.fastForward("01:30");
  await expect(person).toHaveURL(/\/sign-in\?reason=idle$/);
  await expect(person.getByRole("status")).toContainText("signed out after a while without activity");
  await person.goto("/app");
  await expect(person).toHaveURL(/\/sign-in$/);
});

// #26, #55, #56: the shared mailbox cannot sign in; automation runs separately.
test("the owner connects the firm's mailbox; client mail is sorted, unclear mail waits for the team, a stranger's is skipped", async ({ request, browser }) => {
  // An address already on the team is refused as soon as it becomes the firm's mailbox.
  await owner.goto("/app/people?panel=invite");
  await owner.getByLabel("Their work email").fill(mailboxEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${mailboxEmail}`);
  await owner.goto("/app/settings");
  const card = owner.locator("section#mailbox");
  await card.getByLabel("The firm's email address").fill(mailboxEmail);
  await card.getByLabel("Its password").fill("wrong");
  await card.getByText("Change server settings").click();
  await card.getByLabel("Incoming mail server (IMAP)").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing mail server (SMTP)").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("alert")).toContainText("could not sign in");
  await card.getByLabel("Its password").fill(mailboxEmail);
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${mailboxEmail}`);

  const blocked = await browser.newPage();
  await blocked.goto("/sign-in");
  await blocked.getByLabel("Your work email").fill(mailboxEmail);
  await blocked.getByRole("button", { name: "Email me a code" }).click();
  await expect(blocked.getByRole("alert").filter({ hasText: "This is your firm email, which InboxCA reads. Sign in with your own work email instead." })).toBeVisible();
  await blocked.close();

  const [{ user_id: mailboxUser }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id = m.user_id where m.firm_id = $1 and u.email = $2", [firm.firmId, mailboxEmail]);
  await query(local.dbUrl, "delete from public.firm_members where firm_id = $1 and user_id = $2", [firm.firmId, mailboxUser]);
  await owner.goto("/app/people?panel=invite");
  await owner.getByLabel("Their work email").fill(mailboxEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "This is the firm email. Invite each person with their own email address." })).toBeVisible();

  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(mailClient);
  await owner.getByLabel("Email", { exact: true }).fill(`client-${tag}@patel.test`);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(mailClient);
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  // M5 acceptance: an unregistered sender gets nothing, including no refusal email.
  await smtp.sendMail({from:mailboxEmail,to:`stranger-${tag}@else.test`,subject:"Invented test mailbox",text:"Test setup"});
  for (const from of [`Client-${tag}@Patel.test`, `stranger-${tag}@else.test`])
    await smtp.sendMail({ from, to: mailboxEmail, subject: "Please send last year's ITR", text: "Thanks" });
  await pollFirmMail(request, firm.firmId);
  const events = await query(local.dbUrl, "select (client_id is not null) as matched, label from public.email_events where firm_id = $1", [firm.firmId]);
  expect(events).toEqual([{ matched: true, label: "records_past" }]);
  expect(await mailCount(`stranger-${tag}@else.test`)).toBe(1);

  // A second email the rules cannot place waits for the team, and a person corrects a label.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: mailboxEmail, subject: "Hello", text: "Can we meet next week?" });
  await pollFirmMail(request, firm.firmId);
  await owner.getByRole("link", { name: "Inbox" }).click();
  // The request for last year's ITR found no ITR in the drive, so it waits for the team too.
  await owner.getByRole("link", { name: /^Needs reply/ }).click();
  const waiting = owner.getByRole("list", { name: "Emails" }).getByRole("listitem");
  const open = owner.getByRole("article", { name: "Open email" });
  await expect(waiting).toHaveCount(2);
  const reasons = [];
  for (const subject of ["Hello", "Please send last year's ITR"]) {
    await waiting.getByText(subject, { exact: true }).click();
    // The shared test mailbox holds thousands of emails, so a live read can take seconds.
    await expect(open.getByRole("heading", { name: subject })).toBeVisible({ timeout: 15_000 });
    reasons.push(await open.locator(".ib-did").textContent());
    await open.getByRole("button", { name: "Mark done" }).click();
    await expect(open.getByRole("button", { name: "Mark done" })).toHaveCount(0, { timeout: 15_000 });
  }
  // Each waiting email is given to someone; here the owner is the only person.
  expect(reasons.sort()).toEqual(["Asks for a paper that is not in the drive. Given to you.", "Asks something InboxCA could not answer. Given to you."]);
  await owner.goto("/app/inbox?show=reply");
  await expect(owner.getByText("No email needs a reply")).toBeVisible();
  await owner.goto("/app/inbox?show=in");
  await expect(waiting).toHaveCount(2);
  await waiting.first().locator(".ib-subject").click();
  await open.getByLabel("Change label").click();
  await open.getByRole("form", { name: "What this email is" }).getByRole("button", { name: "Asks for this year's papers" }).click();
  await expect(open.getByText("Corrected")).toBeVisible({ timeout: 15_000 });
});

// M3 acceptance: reconnect preserves unread mail and resumes a waiting send.
test("repeated mailbox failures ask the owner to reconnect, then pending mail resumes", async ({ request }) => {
  loadEnvConfig(process.cwd());
  const crypto=serverCrypto(),clients=[randomUUID(),randomUUID()],code=`HR${tag.toUpperCase()}`;
  const addresses=[`health-reminder-${tag}@invented.test`,`health-cursor-${tag}@invented.test`];
  const [{id:account,sync_cursor:cursor}]=await query(local.dbUrl,"select id,sync_cursor from public.connected_accounts where firm_id=$1 and kind='mail'",[firm.firmId]);
  for (let n=0;n<2;n++) await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind,email_enc,email_bidx) values ($1,$2,$3,'individual',$4,$5)",[clients[n],firm.firmId,`Health Test ${n}`,await crypto.encrypt(firm.firmId,`clients/${clients[n]}/email`,addresses[n]),await crypto.blindIndex(firm.firmId,"email",addresses[n])]);
  await query(local.dbUrl,`insert into public.compliance_types(code,name,frequency,due_rule,source_url,verified_on,approved_by) values ($1,'Health test return','monthly','{"for":"pan"}','https://example.test/test',current_date,'test')`,[code]);
  await query(local.dbUrl,"insert into public.tasks(firm_id,client_id,code,period_key,due_on) values ($1,$2,$3,'2026-09',(now() at time zone 'Asia/Kolkata')::date+3)",[firm.firmId,clients[0],code]);
  await query(local.dbUrl,`update public.firms set settings=settings || '{"reminders":true}' where id=$1`,[firm.firmId]);
  const smtp=nodemailer.createTransport({host:"127.0.0.1",port:3025,secure:false,ignoreTLS:true});
  await smtp.sendMail({from:mailboxEmail,to:addresses[0],subject:"Invented test setup",text:"Test setup"});
  await query(local.dbUrl,"update public.connected_accounts set credentials_enc=$2 where id=$1",[account,await crypto.encrypt(firm.firmId,`accounts/${account}/credentials`,JSON.stringify({password:"invented wrong password"}))]);
  for(let n=0;n<3;n++) {
    await query(local.dbUrl,"select private.queue_mail_polls()");
    await query(local.dbUrl,"update public.jobs set run_at=now() where firm_id=$1 and kind='mail_poll' and state='pending'",[firm.firmId]);
    await runJobs(request,firm.firmId);
  }
  expect((await query(local.dbUrl,"select status,sync_cursor from public.connected_accounts where id=$1",[account]))[0]).toEqual({status:"needs_reconnect",sync_cursor:cursor});
  expect((await query(local.dbUrl,"select count(*)::int n from public.jobs where firm_id=$1 and kind='mailbox_reconnect'",[firm.firmId]))[0].n).toBe(1);
  await owner.goto("/app");
  await expect(owner.getByRole("alert").filter({hasText:"Connect your firm's email again"})).toBeVisible();
  await query(local.dbUrl,"delete from public.jobs where firm_id=$1 and kind='reminders'",[firm.firmId]);
  await query(local.dbUrl,"insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values ($1,'reminders','firm',$1,$2)",[firm.firmId,`health-reminder-${tag}`]);
  await runJobs(request,firm.firmId);
  expect((await query(local.dbUrl,"select state,last_error_code from public.jobs where firm_id=$1 and kind='reminders'",[firm.firmId]))[0]).toMatchObject({state:"pending",last_error_code:"mail_not_connected"});
  expect(await mailCount(addresses[0])).toBe(1);
  await smtp.sendMail({from:addresses[1],to:mailboxEmail,subject:"Last year's ITR",text:"Please send last year's ITR."});
  await owner.goto("/app/settings");
  const card=owner.locator("section#mailbox");
  await expect(card.getByLabel("The firm's email address")).toHaveValue(mailboxEmail);
  await card.getByLabel("Its password").fill(mailboxEmail);
  await card.getByRole("button",{name:"Connect email again"}).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${mailboxEmail}`);
  await runJobs(request,firm.firmId);
  expect((await query(local.dbUrl,"select id,status from public.connected_accounts where firm_id=$1 and kind='mail'",[firm.firmId]))[0]).toEqual({id:account,status:"connected"});
  await expect.poll(async()=>(await query(local.dbUrl,"select count(*)::int n from public.email_events where firm_id=$1 and client_id=$2",[firm.firmId,clients[1]]))[0].n,{timeout:15_000}).toBe(1);
  await expect.poll(()=>mailCount(addresses[0]),{timeout:15_000}).toBe(2);
  expect(await lastMail(addresses[0])).toContain("Health test return");
  await owner.goto("/app");
  await expect(owner.getByRole("link",{name:"Connect email again"})).toHaveCount(0);
  await query(local.dbUrl,"delete from public.tasks where code=$1",[code]);
  await query(local.dbUrl,"delete from public.compliance_types where code=$1",[code]);
  await query(local.dbUrl,"update public.firms set settings=settings || '{\"reminders\":false}' where id=$1",[firm.firmId]);
});

test("the owner connects a drive only after agreeing to the Drive access terms", async () => {
  await owner.goto("/app/settings");
  const card = owner.locator("section#drive");
  // The test server has OneDrive's invented app keys (tests/fake-onedrive.ts), so it is offered.
  await expect(card.getByLabel(/OneDrive/)).toBeEnabled();
  await card.getByLabel("Test drive on this computer").check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveCount(0);
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveText("Connected: Test drive on this computer");
  const [consent] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'drive.consent'", [firm.firmId]);
  expect(consent.details).toEqual({ provider: "local", level: "whole_drive", terms_version: "2026-10-17" });
  // InboxCA then sets the drive up by itself, with a tick for each thing it did.
  const ticks = card.getByRole("list", { name: "What InboxCA set up" });
  await expect(async () => {
    await owner.reload();
    await expect(ticks).toContainText("Saved a test file, read it back and removed it", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(ticks.getByRole("listitem")).toHaveCount(6);
  await expect(ticks).toContainText("Made the InboxCA folder");
  await expect(ticks).toContainText("The InboxCA folder is shared with nobody");
  await expect(ticks).toContainText("GB free in your drive");
  await expect(ticks).toContainText("Changes made in the drive show here the next morning");
  await expect(ticks.getByLabel("Needs a look")).toHaveCount(0);
});

test("a client's attachments are filed into its folder in the drive; an unclear one waits under To check", async ({ request, browser }) => {
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  await smtp.sendMail({
    from: `client-${tag}@patel.test`,
    to: mailboxEmail,
    subject: "GST data",
    text: "Please find the bills attached.",
    attachments: [
      { filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" },
      { filename: "scan001.pdf", content: "%PDF-1.4 invented scan" },
    ],
  });
  // The worker reads the mail, then files its attachments.
  await pollFirmMail(request, firm.firmId);
  // Bills for September 2026 belong to FY 2026-27; the scan names no period, so it goes in the year it arrived.
  const drive = path.join(TEST_DRIVE, "InboxCA");
  expect(await readFile(path.join(drive, "FY 2026-27", mailClient, "GST", `${mailClient} - Purchase bills - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  const thisYear = financialYear(new Date().toISOString().slice(0, 7));
  expect(await readFile(path.join(drive, thisYear, mailClient, "GST", "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");

  await owner.goto("/app/clients");
  await owner.getByRole("link", { name: mailClient }).click();
  await owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: /^Documents/ }).click();
  const rows = owner.locator("section[aria-labelledby=files] tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
  // Each paper says how it came in; the unclear one says why it waits, and its email opens in the Inbox.
  await expect(rows.filter({ hasText: "Purchase bills" })).toContainText(`Saved by InboxCA from ${mailClient}'s email, `);
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("Waiting to be checked: InboxCA could not tell its type and period.");
  const docsTab = owner.url();
  await owner.goto("/app/documents?view=papers");
  await owner.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /To check/ }).click();
  const waiting = owner.getByRole("complementary", { name: "Paper" });
  await expect(waiting).toContainText(`Saved by InboxCA from ${mailClient}'s email, `);
  await expect(waiting).toContainText("Waiting to be checked: InboxCA could not tell its type and period.");
  await waiting.getByRole("link", { name: "Open the email" }).click();
  await expect(owner.getByRole("heading", { name: "GST data" })).toBeVisible();
  await owner.goto(docsTab);
  // A file opens in the viewer. Only the owner can get the original, sandboxed.
  await rows.getByRole("link", { name: `${mailClient} - Purchase bills - Sep 2026.pdf`, exact: true }).click();
  await expect(owner.getByText("View only, with your email on every page.")).toBeVisible();
  // A screenshot key blanks the pages for a moment, and each try is logged.
  await owner.keyboard.press("PrintScreen");
  await expect(owner.getByText("The pages are hidden. They show again in a few seconds, or when you come back to this window.")).toBeVisible();
  await expect.poll(async () => (await query(local.dbUrl, "select count(*)::int as n from public.activity_log where firm_id = $1 and action = 'capture_attempt'", [firm.firmId]))[0].n).toBe(1);
  const raw = owner.url().replace(/\/view$/, "");
  const file = await owner.request.get(raw);
  expect(await file.text()).toBe("%PDF-1.4 invented purchase bills");
  expect(file.headers()).toMatchObject({ "content-type": "application/pdf", "content-security-policy": "sandbox" });
  expect((await owner.request.get(`${raw}?view=1`, { headers: { "x-inboxca-viewer": "1" } })).headers()["content-type"]).toBe("application/pdf");
  await owner.goBack();

  // #46: corrections and undo are logged; a third rename tells the owner on Home.
  for (const attempt of [0, 1]) {
    await rows.getByRole("link", { name: `Check ${mailClient} - Document.pdf` }).click();
    // Name shows only once Type is Other.
    await expect(owner.getByRole("dialog").getByLabel("Name", { exact: true })).toBeHidden();
    await owner.getByLabel("Paper type", { exact: true }).selectOption("Other");
    await owner.getByRole("dialog").getByLabel("Name", { exact: true }).fill("HDFC loan sanction letter");
    if (attempt === 0) await owner.getByLabel("Add to our list of paper types").check();
    await owner.getByRole("button", { name: "Save", exact: true }).click();
    await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - HDFC loan sanction letter.pdf`);
    const gst = path.join(drive, thisYear, mailClient, "GST");
    expect(await readFile(path.join(gst, `${mailClient} - HDFC loan sanction letter.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");
    if (attempt === 1) {
      const back = owner.url();
      await owner.goto("/app/work");
      await expect(owner.locator("section[aria-labelledby=w-list] li").filter({ hasText: `Check what ${ownerEmail} renamed` })).toContainText("Renamed 3 files today");
      await owner.goto(back);
    }
    await owner.getByRole("button", { name: "Undo" }).click();
    await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
    expect(await readFile(path.join(gst, "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");
  }
  // The kept name is offered as a type from now on.
  await owner.getByRole("link", { name: "Upload papers" }).click();
  await owner.getByLabel("Files", { exact: true }).setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 not uploaded") });
  await expect(owner.getByLabel("Paper type", { exact: true }).locator("option", { hasText: "HDFC loan sanction letter" })).toHaveCount(1);
  // Activity names each rename's old and new name; a manager or the owner puts back the latest in one click.
  await owner.goto(`${owner.url().split("?")[0]}?tab=activity`);
  await expect(owner.locator("section[aria-labelledby=client-activity]")).toContainText(`${mailClient} - HDFC loan sanction letter.pdf to ${mailClient} - Document.pdf`);
  await owner.getByRole("button", { name: `Undo rename of ${mailClient} - Document.pdf` }).click();
  await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - HDFC loan sanction letter.pdf`);
  await owner.getByRole("button", { name: "Undo" }).click();
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");

  // M5 acceptance: a duplicate attachment is flagged. The same bills sent again wait under To check beside the first copy, for the team to choose.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: mailboxEmail, subject: "Bills again", text: "Sending again.", attachments: [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }] });
  await pollFirmMail(request, firm.firmId);
  await owner.reload();
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");

  // The owner removes the second copy: it waits in the drive's Removed papers folder and can be restored.
  await rows.filter({ hasText: "Same file as" }).getByRole("link", { name: /^Check/ }).click();
  await expect(owner.getByRole("dialog")).toContainText("InboxCA also keeps its own locked copy for 30 days.");
  await owner.getByRole("dialog").getByRole("button", { name: /^Remove/ }).click();
  await expect(owner.getByRole("status")).toContainText("Removed papers folder of your firm's drive for 30 days");
  const removedFile = path.join(drive, "Removed papers", `${mailClient} - Purchase bills - Sep 2026.pdf`);
  expect(await readFile(removedFile, "utf8")).toBe("%PDF-1.4 invented purchase bills");
  await expect(rows).toHaveCount(2);
  // InboxCA's own safety copy is sealed with the firm's key. With the Deleted folder emptied
  // in the drive, Restore brings the file back from that copy.
  const [{ id: removedId }] = await query(local.dbUrl, "select id from public.documents where firm_id = $1 and status = 'deleted' and name = $2", [firm.firmId, path.basename(removedFile)]);
  expect((await readFile(path.join(TEST_WORKSPACE, "safety", firm.firmId, removedId))).includes("invented purchase bills")).toBe(false);
  await unlink(removedFile);
  await owner.getByRole("button", { name: "Restore" }).first().click();
  await expect(owner.getByRole("status").filter({ hasText: "Restored " })).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");
  const [putBack] = await query(local.dbUrl, "select drive_file_id from public.documents where id = $1", [removedId]);
  expect(await readFile(path.join(TEST_DRIVE, putBack.drive_file_id), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  expect((await query(local.dbUrl, "select action from public.activity_log where entity_id = $1 and action like 'document.safety%' order by at", [removedId])).map((line) => line.action)).toEqual(["document.safety_copy", "document.safety_restored"]);

  // A manager or the owner uploads a file and types it; it is saved under its name in the client's folder.
  await owner.getByRole("link", { name: "Upload papers" }).click();
  await owner.getByLabel("Files", { exact: true }).setInputFiles({ name: "IMG_2041.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 invented form 16") });
  await owner.getByLabel("Paper type", { exact: true }).selectOption("Form 16");
  await owner.getByLabel("Type of work", { exact: true }).selectOption("income_tax");
  await owner.getByLabel("Period", { exact: true }).selectOption({ label: "FY 2025-26" });
  await owner.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - Form 16 - FY 2025-26.pdf`);
  expect(await readFile(path.join(drive, "FY 2025-26", mailClient, "Income tax", `${mailClient} - Form 16 - FY 2025-26.pdf`), "utf8")).toBe("%PDF-1.4 invented form 16");
  await expect(rows.filter({ hasText: "Form 16" })).toContainText("Uploaded by Owner, ");

  // Asking the client for files emails them a private link; they upload with no sign in.
  await owner.getByRole("link", { name: "Ask for papers" }).click();
  // The five usual papers for an individual come first, each once; the rest wait under More papers.
  const askList = owner.getByRole("group", { name: "Papers" });
  await expect(askList.getByRole("checkbox", { name: "Bank statement" })).toHaveCount(1);
  await expect(askList.getByRole("checkbox", { name: "Sales bills" })).toBeHidden();
  await askList.getByText("More papers").click();
  await owner.getByLabel("Sales bills").check();
  await owner.getByLabel("Anything else, by name").fill("Loan statement");
  await owner.getByRole("button", { name: "Ask for papers" }).click();
  await expect(owner.getByRole("status")).toContainText("emailed a private upload link");
  const link = (await lastMail(`client-${tag}@patel.test`)).match(/http\S+\/u\/[\w-]+/)![0];
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  // The firm's name leads: what it needs, by when, and how much has arrived.
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(/ needs 2 papers\. This link works until \d{1,2} \w{3} \d{4}\.$/);
  await expect(visitor.getByText(`Papers for ${mailClient}`)).toBeVisible();
  await expect(visitor.getByRole("region", { name: "Progress" })).toContainText("0 of 2 papers received");
  await expect(visitor.getByText(`Questions? Email ${mailboxEmail}`)).toBeVisible();
  // This month's downloads through InboxCA are used up (D26, 5.14); what the client sends still arrives.
  const [{ most }] = await query(local.dbUrl, "select (value #>> '{plans,0,maxReturns}')::int * (value #>> '{fairUse,downloadsAMonthPerReturn}')::int most from public.platform_settings where key = 'plan_formula'");
  await query(local.dbUrl, "insert into public.activity_log (firm_id, action, entity_type) select $1, 'document.downloaded', 'document' from generate_series(1, $2)", [firm.firmId, most]);
  // One button an item: choosing files sends them at once, with no second step.
  const loan = visitor.getByRole("listitem").filter({ hasText: "Loan statement" });
  const loanPdf = Buffer.from(pdf("Invented loan account 99231"));
  await expect(loan.getByLabel("Add Loan statement from camera or files")).toHaveAttribute("accept", "image/*,application/pdf");
  await loan.getByLabel("Add Loan statement from camera or files").setInputFiles({ name: "IMG_77.pdf", mimeType: "application/pdf", buffer: loanPdf });
  await expect(loan.getByRole("status")).toHaveText("Received: 1 file");
  await expect(loan.getByRole("img", { name: "Received" })).toBeVisible();
  await expect(visitor.getByRole("region", { name: "Progress" })).toContainText("1 of 2 papers received");
  await owner.reload();
  await expect(owner.getByRole("list", { name: "Papers asked for" })).toContainText("1 of 2 received");
  await expect(rows.filter({ hasText: "Loan statement" })).not.toContainText("To check");
  await expect(rows.filter({ hasText: "Loan statement" })).toContainText("Sent by the client through their upload link, ");
  // The team checks what arrived. Ask again clears an item, so the client's link asks for it once more.
  // Several files chosen together all arrive before the request closes.
  const sales = visitor.getByRole("listitem").filter({ hasText: "Sales bills" });
  await sales.getByLabel("Add Sales bills from camera or files").setInputFiles([
    { name: "IMG_78.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented sales bills")) },
    { name: "IMG_79.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invented photo of a sales bill") },
  ]);
  // After the last paper the page thanks them.
  await expect(visitor.getByRole("heading", { name: "All 2 papers received" })).toBeVisible();
  await expect(visitor.getByText("Everything asked for has arrived.")).toBeVisible();
  await expect(sales.getByRole("status")).toHaveText("Received: 2 files");
  await expect(visitor.getByLabel(/^Add /)).toHaveCount(0);
  await owner.reload();
  const asks = owner.getByRole("list", { name: "Papers asked for" });
  await asks.getByRole("button", { name: "Loan statement is right" }).click();
  await expect(asks.getByRole("button", { name: "Loan statement is right" })).toHaveCount(0);
  await asks.getByRole("button", { name: "Ask again for Sales bills" }).click();
  await expect(asks).toContainText("1 of 2 received");
  await visitor.reload();
  await expect(visitor.getByRole("listitem").filter({ hasText: "Sales bills" })).not.toContainText("Received");
  await expect(visitor.getByRole("listitem").filter({ hasText: "Loan statement" })).toContainText("Received: 1 file");
  // A link copied wrong names nothing of the firm.
  await visitor.goto(`${link}x`);
  await expect(visitor.getByRole("heading")).toHaveText("This link has ended or was copied wrong.");
  await expect(visitor.getByText("Questions?")).toHaveCount(0);

  // A filed document goes to the client as a secure link that stops after 5 downloads.
  await rows.getByRole("link", { name: `Open ${mailClient} - Loan statement`, exact: false }).click();
  await owner.getByRole("link", { name: "Send this paper" }).click();
  // Sending is its own step that names the paper and the address.
  await expect(owner.getByRole("dialog")).toContainText(`Send Loan statement to client-${tag}@patel.test?`);
  await owner.getByRole("button", { name: "Send", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText("works for 7 days and 5 downloads");
  const shared = (await lastMail(`client-${tag}@patel.test`)).match(/http\S+\/s\/[\w-]+/)![0];
  await visitor.goto(shared);
  await expect(visitor.getByRole("heading", { name: /Loan statement/ })).toBeVisible();
  // A loan statement is a private paper: it opens only with the code emailed to the same address.
  expect((await visitor.request.get(`${shared}/file`)).status()).toBe(403);
  await visitor.getByRole("button", { name: "Email me a code" }).click();
  await expect(visitor.getByRole("status")).toHaveText("We sent a code to c•••@patel.test. It works for 10 minutes.");
  await expect(visitor.getByLabel("Code from the email")).toBeFocused();
  const first = (await lastMail(`client-${tag}@patel.test`)).match(/Your code is (\d{6})/)![1];
  // A new code replaces the first.
  await visitor.getByRole("button", { name: "Send a new code" }).click();
  await expect(visitor.getByRole("status")).toHaveText("We sent a code to c•••@patel.test. It works for 10 minutes.");
  await expect.poll(async () => (await lastMail(`client-${tag}@patel.test`)).match(/Your code is (\d{6})/)![1]).not.toBe(first);
  const oneTime = (await lastMail(`client-${tag}@patel.test`)).match(/Your code is (\d{6})/)![1];
  await visitor.getByLabel("Code from the email").fill(oneTime === "000000" ? "111111" : "000000");
  await visitor.getByRole("button", { name: "Open" }).click();
  await expect(visitor.getByRole("status")).toContainText("That code is not right");
  await visitor.getByLabel("Code from the email").fill(oneTime);
  await visitor.getByRole("button", { name: "Open" }).click();
  await expect(visitor.getByRole("link", { name: "Download" })).toBeVisible();
  // The page says what the paper is, how big, until when the link works and how many downloads are left.
  const paper = visitor.getByRole("region", { name: "The paper" });
  await expect(paper).toContainText(`PDF file${Math.ceil(loanPdf.length / 1024)} KB`);
  await expect(paper).toContainText(/Link works until \d{1,2} \w{3} \d{4}/);
  await expect(paper).toContainText("5 downloads left");
  // A link emails at most 5 codes a day, so its 5 tries a code cannot be repeated without end.
  await query(local.dbUrl, "insert into public.activity_log(firm_id,action,entity_type,entity_id) select firm_id,'share.code_sent','share',id from public.shares, generate_series(1,4) where link_token_hash=encode(sha256(convert_to($1,'utf8')),'hex')", [shared.split("/s/")[1]]);
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(shared);
  await stranger.getByRole("button", { name: "Email me a code" }).click();
  await expect(stranger.getByRole("status")).toContainText("Too many codes asked for today");
  await stranger.close();
  // Until the owner allows more downloads this month the link waits, with none of its 5 spent.
  expect((await visitor.request.get(`${shared}/file`)).status()).toBe(429);
  await visitor.reload();
  await expect(paper).toContainText("5 downloads left");
  const page = owner.url();
  await owner.goto("/app");
  await owner.getByRole("link", { name: "Allow more downloads" }).click();
  await owner.getByRole("button", { name: "Allow more downloads this month" }).click();
  await expect(owner.getByRole("button", { name: "Allow more downloads this month" })).toHaveCount(0);
  await owner.goto(page);
  for (let download = 0; download < 5; download++) expect(Buffer.from(await (await visitor.request.get(`${shared}/file`)).body())).toEqual(loanPdf);
  expect((await visitor.request.get(`${shared}/file`)).status()).toBe(410);

  // Each file is read once after it is filed: a word inside the PDF finds it, as does the name it came with.
  await runJobs(request, firm.firmId);
  await owner.getByLabel("Find a paper").fill("99231");
  await owner.getByRole("button", { name: "Find", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Loan statement");
  await owner.getByLabel("Find a paper").fill("IMG_2041");
  await owner.getByRole("button", { name: "Find", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Form 16");
  await owner.getByRole("link", { name: "Show all" }).click();

  // A file removed in the drive itself is marked missing by the nightly check, and the owner is told.
  await unlink(path.join(drive, "FY 2025-26", mailClient, "Income tax", `${mailClient} - Form 16 - FY 2025-26.pdf`));
  // This firm's check only: private.queue_drive_checks() queues one a day for every drive in the
  // shared database, so another run's call may already have used today's for this one.
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) select firm_id, 'drive_check', 'account', id, 'drive_check:test:' || gen_random_uuid() from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm.firmId]);
  await runJobs(request, firm.firmId);
  await owner.reload();
  await expect(rows.filter({ hasText: "Form 16" })).toContainText("Missing in the drive");
  await owner.goto("/app/work");
  await expect(owner.locator("section[aria-labelledby=w-list] li").filter({ hasText: "1 paper is missing from your drive" })).toBeVisible();
  // It opens the Documents page with only the missing papers.
  await owner.getByRole("link", { name: "See missing papers" }).click();
  await expect(owner).toHaveURL(/\/app\/documents\?year=all&show=missing$/);
  await expect(owner.getByRole("region", { name: "Papers" }).getByRole("row")).toHaveCount(2);
  await expect(owner.getByRole("region", { name: "Papers" }).getByRole("row").nth(1)).toContainText("Form 16");

  // M5 acceptance: the registered request gets the right year, and private papers wait.
  // A client asks for papers by email: a routine ITR-V goes back at once as a secure link in
  // reply; private financial statements wait in the Inbox for one approval.
  for (const [type, period, content] of [["ITR-V", "FY 2024-25", "invented ITR-V"], ["Balance sheet", "FY 2025-26", "invented balance sheet"]]) {
    await owner.goto("/app/clients");
    await owner.getByRole("link", { name: mailClient }).click();
    await owner.getByRole("navigation", { name: "Client", exact: true }).getByRole("link", { name: /^Documents/ }).click();
    await owner.getByRole("link", { name: "Upload papers" }).click();
    await owner.getByLabel("Files", { exact: true }).setInputFiles({ name: `${type}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(pdf(content)) });
    await owner.getByLabel("Paper type", { exact: true }).selectOption(type);
    await owner.getByLabel("Period", { exact: true }).selectOption({ label: period });
    await owner.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(owner.getByRole("status")).toContainText("Saved as");
  }
  const ask = async (subject: string, text: string) => {
    await smtp.sendMail({ from: `client-${tag}@patel.test`, to: mailboxEmail, subject, text });
    await pollFirmMail(request, firm.firmId);
  };
  await ask("ITR copy", "Please send my ITR for AY 2025-26 for the loan.");
  const reply = await lastMail(`client-${tag}@patel.test`);
  expect(reply).toContain("shared ITR-V for FY 2024-25 with you");
  expect(reply).toMatch(/Download it here: http\S+\/s\//);
  const routineLink=reply.match(/Download it here: (http\S+)/)![1];
  const opened=await request.get(routineLink);
  expect(await opened.text()).toContain("Download");
  expect((await (await request.get(`${routineLink}/file`)).body()).toString()).toContain("invented ITR-V");
  await ask("Financial statements", "Can you share the financial statements for FY 2025-26?");
  await owner.goto("/app/inbox?panel=papers");
  const papers = owner.locator("section[aria-labelledby=papers]:not([role=dialog])");
  await expect(papers).toContainText(`${mailClient} - Balance sheet - FY 2025-26.pdf`);
  await papers.getByRole("button", { name: "Approve and send" }).click();
  await expect(owner.getByRole("status")).toContainText("Sent");
  expect(await lastMail(`client-${tag}@patel.test`)).toContain("shared Balance sheet for FY 2025-26 with you");

  // A notice a client emails is recorded with what the rules found; its date is only a
  // suggestion until a person confirms it.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: mailboxEmail, subject: "Income tax notice", text: "Notice under section 148 of the Income-tax Act. DIN: ITBA/AST/F/148/2026-27/1050012345(1). Please respond on or before 24/12/2026.", attachments: [{ filename: "notice.pdf", content: Buffer.from(pdf("Invented notice under section 148")) }, { filename: "purchase_bills_jan_2025.csv", content: "Supplier,Amount\nInvented Supplier,1200" }] });
  await pollFirmMail(request, firm.firmId);
  const [noticeFile] = await query(local.dbUrl, "select work_type,drive_file_id from public.documents where firm_id=$1 and document_type='Notice'", [firm.firmId]);
  expect(noticeFile.work_type).toBe("income_tax");
  expect(noticeFile.drive_file_id).toContain("/Income tax/");
  const [support] = await query(local.dbUrl, "select document_type,work_type from public.documents where firm_id=$1 and name like '%Jan 2025.csv'", [firm.firmId]);
  expect(support).toMatchObject({ document_type: "Purchase bills", work_type: "income_tax" });
  await owner.goto("/app/work");
  await expect(owner.locator("section[aria-labelledby=w-list] li").filter({ hasText: `Review the notice for ${mailClient}` })).toContainText("review deadline");
  await owner.goto("/app/notices");
  const notice = owner.locator("section[aria-label=Notices] tbody tr").filter({ hasText: mailClient });
  await expect(notice).toContainText("Notice u/s 148");
  await expect(notice).toContainText("ITBA/AST/F/148/2026-27/1050012345");
  await expect(notice).toContainText("Check by");
  await notice.getByRole("link", { name: `Update the notice for ${mailClient}` }).click();
  const noticePanel = owner.getByRole("dialog", { name: "Notice u/s 148" });
  await expect(noticePanel.getByLabel("Action date, as the notice states it")).toHaveValue("2026-12-24");
  await noticePanel.getByRole("button", { name: "Mark date checked" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Action date checked." })).toBeVisible();
  await expect(notice).toContainText("24 Dec 2026");
  await notice.getByRole("link", { name: `Update the notice for ${mailClient}` }).click();
  // The panel names who confirmed the date.
  await expect(noticePanel.locator(".props")).toContainText("Checked byOwner");
  await noticePanel.getByRole("button", { name: "Mark replied" }).click();
  await owner.getByRole("link", { name: /^Replied or closed/ }).click();
  await expect(owner.locator("section[aria-label=Notices]")).toContainText(mailClient);

  // Reminders: a confirmed return due in 3 days gets one email; a second run that day sends nothing more.
  const code = `TR${tag.toUpperCase()}`;
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  const [{ id: clientId }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, mailClient]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-09', (now() at time zone 'Asia/Kolkata')::date + 3)", [firm.firmId, clientId, code]);
  await owner.goto("/app/settings?group=reminders");
  await owner.getByLabel("Email clients before their returns are due").check();
  await owner.getByLabel("1 day before", { exact: true }).uncheck();
  await owner.getByRole("button", { name: "Save reminders" }).click();
  await expect(owner.getByLabel("1 day before", { exact: true })).not.toBeChecked();
  await owner.getByLabel("Papers received").selectOption("auto");
  await owner.getByRole("button", { name: "Save replies" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Replies saved." })).toBeVisible();
  // Files that arrive now get a short reply saying what was received, once its 5 minutes for Undo pass.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: mailboxEmail, subject: "August sales", text: "Attached.", attachments: [{ filename: "sales_bills_aug_2026.pdf", content: "%PDF-1.4 invented sales" }] });
  await pollFirmMail(request, firm.firmId);
  await query(local.dbUrl, "update public.jobs set run_at = now() where firm_id = $1 and kind = 'answer_mail' and state = 'pending'", [firm.firmId]);
  await runJobs(request, firm.firmId);
  const thanks = await lastMail(`client-${tag}@patel.test`);
  expect(thanks).toContain("Thank you. We received these papers:\n- Sales bills: saved under GST, Aug 2026");
  // The files asked for earlier were asked 3 days ago now, so the same email follows them up.
  await query(local.dbUrl, "update public.requests set expires_at = now() + interval '27 days' where firm_id = $1 and kind = 'documents'", [firm.firmId]);
  for (let run = 0; run < 2; run++) {
    await query(local.dbUrl, "delete from public.jobs where kind = 'reminders' and firm_id = $1", [firm.firmId]);
    await query(local.dbUrl, "select private.queue_reminders()");
    await runJobs(request, firm.firmId);
  }
  const reminder = await lastMail(`client-${tag}@patel.test`);
  expect(reminder).toContain("- Test return for Sep 2026: due in 3 days");
  expect(reminder).toMatch(/still waiting for these documents.*: Sales bills\.\nUpload them here, no sign in needed: http\S+\/u\//);
  const [{ details }] = await query(local.dbUrl, "select details from public.tasks where client_id = $1 and code = $2", [clientId, code]);
  expect(details.reminded).toHaveLength(1);
  await query(local.dbUrl, "update public.tasks set due_on=(now() at time zone 'Asia/Kolkata')::date-3 where client_id=$1 and code=$2", [clientId,code]);
  await owner.goto("/app/work?show=late");
  // This file makes more than one client with this name, so the row is found by the client's link.
  // While the page streams in, a hidden copy of the row can exist for a moment; only the shown one counts.
  const late = owner.locator("section[aria-labelledby=w-list] li").filter({ has: owner.locator(`a[href="/app/clients/${clientId}?tab=due"]`) }).filter({ visible: true });
  await expect(late).toBeVisible();
  // M5 acceptance: filing removes this return from the pending firm's reminder run.
  await query(local.dbUrl, "update public.tasks set status='filed',details=(details-'reminder') || jsonb_build_object('filed_on',current_date) where client_id=$1 and code=$2", [clientId,code]);
  await query(local.dbUrl, "delete from public.jobs where kind='reminders' and firm_id=$1", [firm.firmId]);
  await query(local.dbUrl, "select private.queue_reminders()");
  await runJobs(request, firm.firmId);
  const [filedReminder] = await query(local.dbUrl, "select details from public.tasks where client_id=$1 and code=$2", [clientId,code]);
  expect(filedReminder.details.reminder).toBeUndefined();
  await owner.goto("/app/work?show=late");
  await expect(owner.locator("section[aria-labelledby=w-list]")).toBeVisible();
  await expect(late).toHaveCount(0);
  await query(local.dbUrl, "delete from public.tasks where code = $1", [code]);
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);

  // Old files already in the drive: final papers are sorted into the client's folder in
  // place after a preview, and can be put back. This ITR-V is for another year than the one uploaded above.
  const old = path.join(TEST_DRIVE, `Old files ${tag}`);
  await mkdir(path.join(old, mailClient, "2025-26"), { recursive: true });
  await mkdir(path.join(old, "Someone else"), { recursive: true });
  await writeFile(path.join(old, mailClient, "2025-26", "ITR-V AY 2024-25.pdf"), "%PDF-1.4 invented ITR-V");
  await writeFile(path.join(old, mailClient, "2025-26", "working notes.txt"), "invented notes");
  await writeFile(path.join(old, "Someone else", "notice.pdf"), "%PDF-1.4 invented notice");
  // Past the first 14 days, when older files may come in too.
  await query(local.dbUrl, "update public.firms set created_at = now() - interval '15 days' where id = $1", [firm.firmId]);
  await owner.goto("/app/import");
  await owner.getByLabel(`Old files ${tag}`).check();
  await owner.getByRole("button", { name: "Show what would move" }).click();
  await expect(owner.getByRole("heading", { name: /^2 files/ })).toBeVisible();
  await owner.getByRole("button", { name: "Move these files" }).click();
  await expect(owner.getByRole("status")).toContainText("Moving your files now");
  await runJobs(request, firm.firmId);
  const itrv = path.join(drive, "FY 2023-24", mailClient, "Income tax", `${mailClient} - ITR-V - FY 2023-24.pdf`);
  expect(await readFile(itrv, "utf8")).toBe("%PDF-1.4 invented ITR-V");
  await owner.reload();
  await owner.getByRole("button", { name: "Undo the move" }).click();
  await expect(owner.getByRole("status")).toContainText("Putting the files back");
  await runJobs(request, firm.firmId);
  expect(await readFile(path.join(old, mailClient, "2025-26", "ITR-V AY 2024-25.pdf"), "utf8")).toBe("%PDF-1.4 invented ITR-V");
  expect(await readFile(path.join(old, "Someone else", "notice.pdf"), "utf8")).toBe("%PDF-1.4 invented notice");

});

test("a client who uploads gets one emailed receipt a sitting, from the firm's mailbox", async ({ request, browser }) => {
  const client = `client-${tag}@patel.test`;
  const jobs = () => runJobs(request, firm.firmId);
  const [{ id: clientId }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, mailClient]);
  await owner.goto(`/app/clients/${clientId}?tab=files&ask=1`);
  await owner.getByRole("group", { name: "Papers" }).getByRole("checkbox", { name: "Bank statement" }).check();
  await owner.getByLabel("Anything else, by name").fill("Rent receipts");
  await owner.getByRole("button", { name: "Ask for papers" }).click();
  await expect(owner.getByRole("status")).toContainText("emailed a private upload link");
  const link = (await lastMail(client)).match(/http\S+\/u\/[\w-]+/)![0];
  const [{ id: asked }] = await query(local.dbUrl, "select id from public.requests where details->>'link_hash' = encode(sha256(convert_to($1, 'utf8')), 'hex')", [link.split("/u/")[1]]);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  const bank = visitor.getByRole("listitem").filter({ hasText: "Bank statement" });
  await bank.getByLabel("Add Bank statement from camera or files").setInputFiles({ name: "bank.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("Invented bank statement")) });
  await expect(bank.getByRole("status")).toHaveText("Received: 1 file");
  // The receipt waits 10 minutes for more files from the same sitting.
  await jobs();
  expect(await lastMail(client)).not.toContain("We have received these papers");
  // Then it goes from the firm's mailbox, naming what arrived and what is still needed.
  await query(local.dbUrl, "update public.jobs set run_at = now() where kind = 'upload_receipt' and entity_id = $1 and state = 'pending'", [asked]);
  await jobs();
  const first = await lastMail(client);
  expect(first).toContain(`Dear ${mailClient},`);
  expect(first).toContain("- Bank statement: 1 file\n\nStill needed:\n- Rent receipts");
  // The last paper sends its receipt at once: two photos picked together make one receipt.
  const rent = visitor.getByRole("listitem").filter({ hasText: "Rent receipts" });
  await rent.getByLabel("Add Rent receipts from camera or files").setInputFiles([
    { name: "rent-1.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invented photo of a rent receipt") },
    { name: "rent-2.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invented photo of another rent receipt") },
  ]);
  await expect(visitor.getByRole("heading", { name: "All 2 papers received" })).toBeVisible();
  await jobs();
  await expect.poll(() => lastMail(client)).toContain("- Bank statement: 1 file\n- Rent receipts: 2 files\n\nThat is everything we asked for.");
  expect(await lastMail(client)).not.toMatch(/InboxCA/);
  // Three files in two sittings: two receipts, each in the client's activity.
  expect(await query(local.dbUrl, "select 1 from public.activity_log where entity_id = $1 and action = 'request.receipt_sent'", [asked])).toHaveLength(2);
  await visitor.close();
});

test("bulk papers go as links, private papers wait, missing papers and addresses are skipped", async ({ request, browser }) => {
  // Bulk sends keep the existing rule: partners and managers need the owner's send permission.
  const lead=await browser.newPage();
  await emailStep(lead,deputyEmail);
  await lead.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await lead.getByRole("button",{name:"Continue"}).click();
  await expect(lead).toHaveURL(/\/app(?:\?|$)/);
  await lead.goto("/app/clients");
  await expect(lead.locator(".rail-me")).toContainText("Partner");
  await expect(lead.locator("#bulk-send")).toHaveCount(0);
  const fields=await actionFields(owner,"/app/clients",{type:""});
  const [{id: chosenClient}]=await query(local.dbUrl,"select id from public.clients where firm_id=$1 and name=$2",[firm.firmId,mailClient]);
  await lead.request.post("/app/clients",{multipart:{...fields,client:chosenClient,type:"ITR-V",period:"2025"},headers:{Origin:new URL(lead.url()).origin}});
  expect((await query(local.dbUrl,"select count(*)::int n from public.requests where firm_id=$1 and kind='bulk_send'",[firm.firmId]))[0].n).toBe(0);
  await lead.close();
  const noEmail=`No Email ${tag}`;
  await query(local.dbUrl,"insert into public.clients(firm_id,name,kind) values ($1,$2,'individual')",[firm.firmId,noEmail]);
  const send = async (type:string,period:string,names=[mailClient]) => {
    await owner.goto("/app/clients");
    for (const name of names) await owner.getByLabel(`Choose ${name}`,{exact:true}).check();
    const bar=owner.locator("#bulk-send");
    await expect(bar.getByLabel("Paper",{exact:true})).toHaveValue("");
    await bar.getByLabel("Paper",{exact:true}).selectOption(type);
    await bar.getByLabel("Year",{exact:true}).selectOption(period);
    // The button names what happens; a second step lists who gets what.
    const label=`Send ${type} to ${names.length} client${names.length===1 ? "" : "s"}`;
    await bar.getByRole("button",{name:label}).click();
    for (const name of names) await expect(bar).toContainText(name);
    await bar.getByRole("button",{name:label}).click();
    await expect(owner).toHaveURL(/\/app\/clients\?bulk=/);
    await request.post("/api/jobs",{headers:{Authorization:`Bearer ${TEST_WORKER_SECRET}`}});
    try {
      await expect.poll(async()=>{await owner.reload();return owner.locator("section[aria-labelledby=send-progress]").textContent();}).toContain("Done. Each client below shows what happened.");
    } catch(error) {
      const jobs=await query(local.dbUrl,"select state,last_error_code from public.jobs where firm_id=$1 and kind='bulk_send'",[firm.firmId]);
      throw new Error(`${String(error)}. Jobs: ${JSON.stringify(jobs)}`);
    }
  };
  await send("ITR-V","2025",[mailClient,noEmail]);
  const progress=owner.locator("section[aria-labelledby=send-progress]");
  await expect(progress).toContainText(`${mailClient}: Sent`);
  await expect(progress).toContainText(`${noEmail}: Skipped. No email address`);
  // Resuming after the mail went but before the list saved its progress sends nothing twice.
  const batch=new URL(owner.url()).searchParams.get("bulk")!;
  const before=await mailCount(`client-${tag}@patel.test`);
  await query(local.dbUrl,"update public.requests set status='pending',details=jsonb_set(details,'{clients,0}',(details#>'{clients,0}')-'state') where id=$1",[batch]);
  await query(local.dbUrl,"update public.jobs set state='pending',run_at=now() where kind='bulk_send' and entity_id=$1",[batch]);
  await runJobs(request,firm.firmId);
  expect(await mailCount(`client-${tag}@patel.test`)).toBe(before);
  await owner.reload();
  await expect(progress).toContainText(`${mailClient}: Sent`);
  const sentBefore=await mailCount(`client-${tag}@patel.test`);
  await owner.goto("/app/clients");
  const again=await actionFields(owner,"/app/clients",{type:""});
  await Promise.all([0,1].map(()=>owner.request.post("/app/clients",{multipart:{...again,client:chosenClient,type:"ITR-V",period:"2025"},headers:{Origin:new URL(owner.url()).origin}})));
  await request.post("/api/jobs",{headers:{Authorization:`Bearer ${TEST_WORKER_SECRET}`}});
  await query(local.dbUrl,"update public.jobs set run_at=now() where firm_id=$1 and kind='bulk_send' and state='pending'",[firm.firmId]);
  await runJobs(request,firm.firmId);
  expect(await mailCount(`client-${tag}@patel.test`)).toBe(sentBefore);
  expect(await lastMail(`client-${tag}@patel.test`)).toMatch(/Download it here: http\S+\/s\//);
  await send("Audit report","2025");
  await expect(progress).toContainText("Skipped. No saved paper of this type for this year");
  await send("Balance sheet","2026");
  await expect(progress).toContainText("Waiting for approval in the Inbox");
  await owner.goto("/app/inbox?panel=papers");
  await owner.locator("section[aria-labelledby=papers]:not([role=dialog])").getByRole("button",{name:"Approve and send"}).click();
  await expect(owner.getByRole("status")).toContainText("Sent");
  const [{id:client}] = await query(local.dbUrl,"select id from public.clients where firm_id=$1 and name=$2",[firm.firmId,mailClient]);
  const [{id:doc,name}] = await query(local.dbUrl,"select id,name from public.documents where client_id=$1 and document_type='ITR-V' and status='filed'",[client]);
  await owner.goto(`/app/clients/${client}?tab=files&edit=${doc}`);
  // The paper's own sending choice waits under More.
  await expect(owner.getByLabel("Sending this paper")).toBeHidden();
  await owner.getByRole("dialog").getByText("More",{exact:true}).click();
  await owner.getByLabel("Sending this paper").selectOption("internal");
  await owner.getByRole("button",{name:"Save sending choice"}).click();
  await expect.poll(async()=>(await query(local.dbUrl,"select share_policy from public.documents where id=$1",[doc]))[0].share_policy).toBe("internal");
  await owner.reload();
  await expect(owner.getByLabel("Sending this paper")).toHaveValue("internal");
  await expect(owner.getByRole("dialog").getByRole("link",{name:"Send this paper"})).toHaveCount(0);
  await send("ITR-V","2025");
  await expect(progress).toContainText("Skipped. Kept inside your firm");
  const [{n}] = await query(local.dbUrl,"select count(*)::int n from public.shares where document_id=$1 and status='sent'",[doc]);
  expect(n).toBe(0);
  // M5 acceptance: an internal paper cannot leave through a records request either.
  const smtp=nodemailer.createTransport({host:"127.0.0.1",port:3025,secure:false,ignoreTLS:true});
  await smtp.sendMail({from:`client-${tag}@patel.test`,to:mailboxEmail,subject:"ITR copy",text:"Please send my ITR for AY 2025-26."});
  await pollFirmMail(request,firm.firmId);
  await owner.goto("/app/inbox?show=reply");
  await owner.getByRole("list", { name: "Emails" }).getByText("ITR copy").first().click();
  await expect(owner.getByRole("article", { name: "Open email" })).toContainText("Asks for a paper kept inside your firm");
  expect(name).toContain("ITR-V");
  await owner.goto("/app/settings");
  for (const section of ["section#mailbox", "section#drive"]) {
    await owner.locator(section).getByRole("link", { name: "Disconnect" }).click();
    await owner.locator(section).getByRole("button", { name: "Yes, disconnect" }).click();
  }
  await expect(owner.locator("section#drive").getByRole("button", { name: "Connect drive" })).toBeVisible();
  await expect(owner.locator("section#mailbox").getByLabel("The firm's email address")).toBeVisible();

});

// #1, #2, #20, #31, #35, #37, #44, #52, #56 and M7 acceptance: five staff, one batch approval.
test("five office PCs need one batch approval, and managers cannot forge office approvals", async ({ browser }) => {
  const email = `batch-${randomUUID()}@example.test`;
  const batch = await seedFirm("Batch Office Firm", email, ownerKey);
  const contexts = [await browser.newContext({ extraHTTPHeaders: { "x-test-ip": "203.0.113.70" } })];
  const staff: Page[] = [];
  const emails: string[] = [];
  const boss = await contexts[0].newPage();
  try {
    await emailStep(boss, email);
    await boss.getByLabel("6 digit code from the app").fill(totp(ownerKey));
    await boss.getByRole("button", { name: "Continue" }).click();
    await expect(boss).toHaveURL(/\/app$/);
    // Notices on this computer are a choice in Settings, off until turned on.
    await boss.goto("/app/settings?group=access#notices");
    await boss.evaluate(() => Reflect.deleteProperty(window, "PushManager"));
    await boss.getByRole("button", { name: "Turn on notices on this computer" }).click();
    await expect(boss.getByText("This browser cannot show notices.", { exact: false })).toBeVisible();
    await boss.goto("/app/settings#office");
    await officeSwitch(boss);
    await boss.getByLabel("Yes, I am in the office now").check();
    await officeSwitch(boss);
    await turnOn(boss);
    await expect(boss.getByRole("button", { name: "Turn off", exact: true, includeHidden: true })).toBeAttached();
    await expect(boss.getByRole("heading", { name: "Risks InboxCA cannot stop for you" })).toBeVisible();
    const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
    for (let n = 0; n < 5; n++) {
      const address = `batch-staff-${n}-${randomUUID()}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({ email: address, email_confirm: true });
      expect(error).toBeNull();
      emails.push(address);
      await query(local.dbUrl, "insert into public.firm_members (firm_id,user_id,role,status) values ($1,$2,'staff','active')", [batch.firmId, data.user!.id]);
      await query(local.dbUrl, "insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values (gen_random_uuid(),$1,'Test app','totp','verified',$2,now(),now())", [data.user!.id, deputyKey]);
      const context = await browser.newContext({ userAgent: pcUserAgent, extraHTTPHeaders: { "x-test-ip": "203.0.113.70" } });
      contexts.push(context);
      const pc = await context.newPage();
      staff.push(pc);
      let { code } = await askForCode(pc, address);
      if (n === 0) {
        await query(local.dbUrl, "update auth.users set confirmation_sent_at=now()-interval '11 minutes',recovery_sent_at=now()-interval '11 minutes' where id=$1", [data.user!.id]);
        expect((await admin.auth.verifyOtp({ email: address, token: code, type: "email" })).error).not.toBeNull();
        code = (await askForCode(pc, address)).code;
      }
      await pc.getByLabel("Code from the email").fill(code);
      await pc.getByRole("button", { name: "Continue", exact: true }).click();
      await pc.getByLabel("6 digit code from the app").fill(totp(deputyKey));
      await pc.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(pc.getByRole("heading", { name: "This PC is waiting for approval" })).toBeVisible();
      if (n === 0) expect((await admin.auth.verifyOtp({ email: address, token: code, type: "email" })).error).not.toBeNull();
    }
    await boss.goto("/app");
    await expect(boss.locator("section[aria-labelledby=t-list] li").filter({ hasText: "Approve 5 PCs" })).toContainText("Signed in from your office today");
    await boss.getByRole("link", { name: "Approve 5 PCs" }).click();
    await boss.getByRole("button", { name: "Approve all as office PCs" }).click();
    await expect(boss.getByRole("heading", { name: "PCs waiting for approval" })).toHaveCount(0);
    expect((await query(local.dbUrl, "select count(*)::int n from public.devices where firm_id=$1 and status='approved'", [batch.firmId]))[0].n).toBe(5);
    for (const pc of staff) {
      await pc.goto("/app/clients");
      await expect(pc.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    }
    const words = await boss.locator("#office").innerText();
    expect(words).not.toMatch(/\bIP\b|cookie|token|passkey|watermark|device ID/i);

    // A manager copies the owner's forms. Both requests are refused and logged.
    const [{ user_id: manager }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id=m.user_id where m.firm_id=$1 and u.email=$2", [batch.firmId, emails[0]]);
    await query(local.dbUrl, "update public.firm_members set role='manager' where firm_id=$1 and user_id=$2", [batch.firmId, manager]);
    for (const [button, value] of [["Turn off", { intent: "off" }], ["Withdraw", { decision: "withdraw" }]] as const) {
      const form = boss.locator("#office form").filter({ has: boss.getByRole("button", { name: button, exact: true }) }).first();
      const fields = await actionFields(boss, "/app/settings?group=access", button === "Turn off" ? { intent: "off" } : { device: await form.locator('input[name="device"]').inputValue() });
      await staff[0].request.post("/app/settings", { multipart: { ...fields, ...value }, headers: { Origin: new URL(staff[0].url()).origin } });
    }
    expect((await query(local.dbUrl, "select settings->'office'->>'on' as on from public.firms where id=$1", [batch.firmId]))[0].on).toBe("true");
    expect((await query(local.dbUrl, "select count(*)::int n from public.devices where firm_id=$1 and status='approved'", [batch.firmId]))[0].n).toBe(5);
    expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='approval.denied'", [batch.firmId, manager]))[0].n).toBe(2);

    // #44: a manager may answer their team, but can never give Always allow.
    const [{ id: team }] = await query(local.dbUrl, "insert into public.groups (firm_id,kind,name) values ($1,'team','Test team') returning id", [batch.firmId]);
    const [{ id: client }] = await query(local.dbUrl, "insert into public.clients (firm_id,name,kind) values ($1,'Test approval client','individual') returning id", [batch.firmId]);
    const [{ user_id: asker }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id=m.user_id where m.firm_id=$1 and u.email=$2", [batch.firmId, emails[1]]);
    await query(local.dbUrl, "update public.firm_members set team_id=$3 where firm_id=$1 and user_id in ($2,$4)", [batch.firmId, manager, team, asker]);
    const request = randomUUID();
    await query(local.dbUrl, "insert into public.requests (id,firm_id,kind,client_id,entity_type,entity_id,reason_code,expires_at,details) values ($1,$2,'permission',$3,'permission',$1,'upload',now()+interval '4 hours',jsonb_build_object('by',$4::text,'route','manager','team_id',$5::text))", [request, batch.firmId, client, asker, team]);
    const fields = await actionFields(boss, `/app/inbox?answer=${request}`, { request });
    await staff[0].request.post("/app/inbox", { multipart: { ...fields, intent: "always" }, headers: { Origin: new URL(staff[0].url()).origin } });
    expect((await query(local.dbUrl, "select status from public.requests where id=$1", [request]))[0].status).toBe("pending");
    expect((await query(local.dbUrl, "select access->'always' as rights from public.firm_members where firm_id=$1 and user_id=$2", [batch.firmId, asker]))[0].rights).toBeNull();
    expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='approval.denied' and details->>'kind'='always'", [batch.firmId, manager]))[0].n).toBe(1);

    // With a trusted PC present, three confirmation taps trigger the suggestion.
    await query(local.dbUrl, "update public.devices set key_id='test-key',key_public='test-public' where id=(select id from public.devices where firm_id=$1 limit 1)", [batch.firmId]);
    await boss.reload();
    await expect(boss.getByText("ask your internet provider for a fixed internet address")).toHaveCount(0);
    for (const ipv4 of ["203.0.113.71", "203.0.113.72", "203.0.113.73"]) await query(local.dbUrl, "select public.office_control($1,$2,'here',connection=>$3)", [batch.firmId, batch.ownerId, { ipv4 }]);
    await boss.reload();
    await expect(boss.getByText("ask your internet provider for a fixed internet address")).toBeVisible();
  } finally {
    // A context the test already closed is gone; closing it again is not a failure.
    for (const context of contexts) await context.close().catch(() => {});
    await batch.remove(...emails);
  }
});
