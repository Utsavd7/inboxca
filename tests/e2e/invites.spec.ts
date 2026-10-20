import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID, type ECDH } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { TEST_WORKER_SECRET } from "../../playwright.config";
import { financialYear } from "@/src/lib/drive";
import { laterBy } from "@/src/lib/hours";
import { pdf } from "@/tests/fixtures/pdf";
import { actionFields, askForCode, emailStep, latestEmail, localSupabase, query, seedFirm, totp } from "./local-supabase";

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
const mailboxEmail = "office@firm.test";
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

async function lastMail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  await imap.connect();
  await imap.mailboxOpen("INBOX");
  const message = await imap.fetchOne("*", { source: true });
  await imap.logout();
  return message && message.source ? ((await simpleParser(message.source)).text ?? "") : "";
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
});
test.afterAll(() => firm.remove(newEmail, emailOnly, deputyEmail, laptopEmail, mailboxEmail));

test("the owner invites a new person, who appears as invited", async () => {
  await emailStep(owner, ownerEmail);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "People" }).click();
  await expect(owner.getByText(ownerEmail)).toBeVisible();
  await owner.getByLabel("Their work email").fill(newEmail.toUpperCase());
  await owner.getByLabel("Role").selectOption("manager");
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${newEmail}`);
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).toContainText("Invited");

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
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
  await expect(page.locator(".page-head")).toContainText("Invite Test Firm");
  await expect(page.locator(".rail-me")).toContainText("Manager");
  // A manager's sidebar has People but not Settings, which is the owner's.
  await expect(page.getByRole("link", { name: "People" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByText(/has invited you/)).toHaveCount(0);

  // Only the owner invites.
  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).not.toContainText("Invited");
});

// #5: removing a person closes access on their next request.
test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  // A new role saves as soon as it is picked.
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByLabel(`Role for ${newEmail}`).selectOption("staff"),
  ]);
  await owner.reload();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("Removed");
  await row.getByRole("button", { name: "Bring back" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
});

// #1, #2, #3, #24, #25, #35, #37, #39, #40, #41, #49, #55: the same approved PC, fresh browsers and changed connections.
test("under Office only, staff need the office connection and an approved PC", async ({ browser }) => {
  // The test server reads each request's address from this header, as it would Cloudflare's.
  await owner.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await owner.goto("/app/settings#office");
  await owner.getByLabel("Yes, this is my office").check();
  await owner.getByRole("button", { name: "Turn on" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "On." })).toContainText("You are on your office internet connection now.");
  // No PC stays in the office yet, so the owner is told how to get a fixed connection, once.
  await expect(owner.getByText("ask your internet provider for a fixed address")).toBeVisible();
  await owner.getByRole("button", { name: "My provider doesn't offer it" }).click();
  await expect(owner.getByText("ask your internet provider for a fixed address")).toHaveCount(0);
  await expect(owner.getByText("mark one desktop in the office as Stays in the office")).toBeVisible();

  await person.setExtraHTTPHeaders({ "x-test-ip": "198.51.100.7" });
  await person.goto("/app");
  await expect(person.getByRole("heading", { name: "Use InboxCA from your office." })).toBeVisible();
  await person.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.10" });
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();

  await owner.goto("/app");
  await expect(owner.getByText("1 PC signed in from your office today:")).toBeVisible();
  await owner.goto("/app/settings#office");
  await expect(owner.getByText(/New on Chrome on Windows, first seen today/)).toBeVisible();
  await owner.getByRole("button", { name: "Stays in the office" }).click();
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
  await expect(second.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  expect((await secondContext.cookies()).some((cookie) => cookie.name === "inboxca_device")).toBe(true);
  expect(await query(local.dbUrl, "select status from public.devices where firm_id = $1 order by status", [firm.firmId])).toEqual([{ status: "approved" }, { status: "waiting" }]);
  await owner.reload();
  await owner.getByRole("button", { name: "Laptop" }).click();
  await expect(owner.getByRole("button", { name: "Laptop" })).toHaveCount(0);
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
  await person.getByRole("link", { name: "Clients" }).click();
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

  // A staff member without an authenticator app also uses an already approved office PC.
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data: emailOnlyUser, error: emailOnlyError } = await admin.auth.admin.createUser({ email: emailOnly, email_confirm: true });
  expect(emailOnlyError).toBeNull();
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'active')", [firm.firmId, emailOnlyUser.user!.id]);
  await person.getByRole("button", { name: "Sign out" }).click();
  await emailStep(person, emailOnly);
  await expect(person).toHaveURL(/\/app$/);
  await person.getByRole("link", { name: "Clients" }).click();
  await expect(person.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await person.getByRole("button", { name: "Sign out" }).click();
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
  await owner.getByRole("button", { name: "Sign out" }).click();
  await emailStep(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/sign-in\/two-step$/);
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  // Off again, staff reach the firm from anywhere.
  await owner.goto("/app/settings#office");
  await owner.getByRole("button", { name: "Turn off" }).click();
  await expect(owner.getByText("Are you in your office right now?")).toBeVisible();
  await person.getByLabel("6 digit code from the app").fill(totp(personKey));
  await person.getByRole("button", { name: "Continue" }).click();
  await person.getByRole("link", { name: "Clients" }).click();
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
  await owner.getByRole("button", { name: "Save deputies" }).click();
  await expect(owner.getByLabel(deputyEmail, { exact: true })).toBeChecked();
  await owner.getByRole("button", { name: "Turn on" }).click();

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
  await expect(laptop.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  const { deviceHash } = await import("../../src/lib/device");
  const laptopCookie = (await laptop.context().cookies()).find((cookie) => cookie.name === "inboxca_device")!;
  await query(local.dbUrl, "update public.devices set name = 'Travel laptop' where firm_id = $1 and token_hash = $2", [firm.firmId, await deviceHash(laptopCookie.value)]);
  await deputy.reload();
  const laptopRow = deputy.getByRole("listitem").filter({ hasText: "Travel laptop" });
  await laptopRow.getByRole("button", { name: "Laptop", exact: true }).click();
  await expect(laptopRow.getByRole("button", { name: "Laptop", exact: true })).toHaveCount(0);
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();

  // The signed browser secret identifies this approved PC, not the person using it.
  const deviceCookie = (await person.context().cookies()).find((cookie) => cookie.name === "inboxca_device")!;
  await query(local.dbUrl, "update public.devices set kind = 'office', name = 'Reception PC' where firm_id = $1 and token_hash = $2", [firm.firmId, await deviceHash(deviceCookie.value)]);
  // Without its own key a PC that stays in the office waits on a new connection like a laptop.
  await person.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.20" });
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "Waiting for your firm to confirm the office internet connection" })).toBeVisible();

  await laptop.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.30" });
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Waiting for your firm to confirm the office internet connection" })).toBeVisible();
  await deputy.goto("/app");
  const request = deputy.locator(".notice").filter({ hasText: "Travel laptop is on a new internet connection" });
  await expect(request).toBeVisible();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await query(local.dbUrl, "update public.firms set settings = settings || $2 where id = $1", [firm.firmId, { special_hours: [{ from: today, to: today, open: "00:00", close: "23:59" }] }]);
  await request.getByRole("button", { name: "Allow this network today" }).click();
  await expect(request).toHaveCount(0);
  await laptop.goto("/app/clients");
  await expect(laptop.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  const [{ lines }] = await query(local.dbUrl, "select settings -> 'office' -> 'lines' as lines from public.firms where id = $1", [firm.firmId]);
  expect(lines.find((line: { ipv4: string; until?: string }) => line.ipv4 === "203.0.113.30").until).toContain("18:29:00");

  await deputy.goto("/app/settings#office");
  await deputy.reload();
  await deputy.locator(".notice").filter({ hasText: "Reception PC is on a new internet connection" }).getByRole("button", { name: "This is my office", exact: true }).click();
  await expect(deputy.getByText("Reception PC is on a new internet connection", { exact: false })).toHaveCount(0);
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await owner.goto("/app/settings#office");
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
  await owner.getByRole("button", { name: "Turn on" }).click();
  await expect(owner.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();

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
  await expect(reception.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
  await owner.reload();
  const waitingPc = owner.getByRole("listitem").filter({ hasText: "Laptop on Chrome on Windows, first seen today" });
  await waitingPc.getByRole("button", { name: "Stays in the office" }).click();
  await expect(waitingPc).toHaveCount(0);

  await reception.goto("/app");
  await reception.getByRole("button", { name: "Set up this PC's key" }).click();
  await expect(reception.getByRole("button", { name: "Set up this PC's key" })).toHaveCount(0);
  expect(await query(local.dbUrl, "select count(*)::int as count from public.devices where firm_id = $1 and kind = 'office' and key_public is not null", [firm.firmId])).toEqual([{ count: 1 }]);

  // The office connection changes overnight: the PC confirms it with its key and the owner is told.
  await reception.setExtraHTTPHeaders({ "x-test-ip": "203.0.113.40" });
  await reception.goto("/app/clients");
  await reception.getByRole("button", { name: "Confirm with this PC's key" }).click();
  await expect(reception.getByRole("button", { name: "Confirm with this PC's key" })).toHaveCount(0);
  await reception.goto("/app/clients");
  await expect(reception.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await owner.goto("/app");
  const changed = owner.locator(".notice").filter({ hasText: "Your office internet connection changed today" });
  await expect(changed).toBeVisible();

  // Withdrawn by the owner, the connection goes and the PC waits again.
  await changed.getByRole("button", { name: "Not my office" }).click();
  await expect(changed).toHaveCount(0);
  await reception.goto("/app/clients");
  await expect(reception.getByRole("heading", { name: "Waiting for your firm to confirm the office internet connection" })).toBeVisible();
  await owner.goto("/app/settings#office");
  await owner.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(owner.getByText("Are you in your office right now?")).toBeVisible();
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
  await expect(person.getByRole("link", { name: "Upload a file" })).toHaveCount(0);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByRole("status")).toContainText("Asked.");
  // Within seconds the owner's browser gets it, sealed for that browser alone, naming no client.
  await expect.poll(() => pushes.length, { timeout: 15_000 }).toBe(1);
  expect(pushes[0].headers["content-encoding"]).toBe("aes128gcm");
  expect(String(pushes[0].headers.authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const message = JSON.parse(openPush(pushes[0].body, browserKey, auth));
  expect(message).toEqual({ title: "A question for you", body: "New asks to upload a file.", url: "/app/inbox" });
  pushService.close();
  await query(local.dbUrl, "delete from public.push_subscriptions where user_id = $1", [ownerId]);
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();

  // #19: an unanswered question expires, and the person can ask again.
  const [{ id: expired, expires_at: expires }] = await query(local.dbUrl, "select id, expires_at from public.requests where firm_id=$1 and kind='permission' and status='pending'", [firm.firmId]);
  expect(Date.parse(expires) - Date.now()).toBeGreaterThan(3.9 * 3_600_000);
  expect(Date.parse(expires) - Date.now()).toBeLessThanOrEqual(4 * 3_600_000);
  const staleFields = await actionFields(owner, "/app/inbox", { request: expired });
  await query(local.dbUrl, "update public.requests set expires_at=now()-interval '1 second' where id=$1", [expired]);
  await owner.request.post("/app/inbox", { multipart: { ...staleFields, intent: "allow" }, headers: { Origin: new URL(owner.url()).origin } });
  expect((await query(local.dbUrl, "select status from public.requests where id=$1", [expired]))[0].status).toBe("pending");
  await owner.goto("/app/inbox");
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  await person.goto(files);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();

  // The person has no team manager, so the question goes to the owner.
  await owner.goto("/app/inbox");
  const question = owner.locator("section[aria-labelledby=questions] li").filter({ hasText: "asks to upload a file" });
  await expect(question).toContainText(`Ask Client ${tag}`);
  // #42, #44, #57: copying an approval form or visiting its address cannot approve it.
  const fields = await actionFields(owner, "/app/inbox", { request: await question.locator('input[name="request"]').inputValue() });
  const [{ user_id: requester }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id=m.user_id where m.firm_id=$1 and u.email=$2", [firm.firmId, newEmail]);
  await query(local.dbUrl, "update public.firm_members set role='manager' where firm_id=$1 and user_id=$2", [firm.firmId, requester]);
  await person.request.post("/app/inbox", { multipart: { ...fields, intent: "allow" }, headers: { Origin: new URL(person.url()).origin } });
  await query(local.dbUrl, "update public.firm_members set role='staff' where firm_id=$1 and user_id=$2", [firm.firmId, requester]);
  await owner.request.get(`/app/inbox?request=${fields.request}&intent=allow`);
  expect((await query(local.dbUrl, "select status from public.requests where id=$1", [fields.request]))[0].status).toBe("pending");
  expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='approval.denied'", [firm.firmId, requester]))[0].n).toBe(1);
  await question.getByRole("button", { name: "Allow once" }).click();
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);

  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload a file" })).toBeVisible();

  const [{ expires_at: grantedUntil }] = await query(local.dbUrl, "select expires_at from public.requests where id=$1", [fields.request]);
  expect(Date.parse(grantedUntil) - Date.now()).toBeGreaterThan(0.9 * 3_600_000);
  expect(Date.parse(grantedUntil) - Date.now()).toBeLessThanOrEqual(3_600_000);

  // Once used the grant is gone. Asked again, the owner always allows it, then withdraws that.
  await query(local.dbUrl, "update public.requests set status = 'used' where firm_id = $1 and kind = 'permission' and status = 'approved'", [firm.firmId]);
  await person.goto(files);
  await person.getByRole("button", { name: "Ask to upload" }).click();
  await expect(person.getByText("Asked", { exact: true })).toBeVisible();
  await owner.goto("/app/inbox");
  await owner.locator("section[aria-labelledby=questions] li").filter({ hasText: "asks to upload a file" }).getByRole("button", { name: "Always allow" }).click();
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload a file" })).toBeVisible();
  await owner.goto("/app/settings#permissions");
  const standing = owner.getByRole("listitem").filter({ hasText: "may upload files without asking" });
  await standing.getByRole("button", { name: "Withdraw" }).click();
  await expect(standing).toHaveCount(0);
  await person.goto(files);
  await expect(person.getByRole("button", { name: "Ask to upload" })).toBeVisible();

  // #47: a changed role right is read on the next request, and reset removes it.
  await owner.getByLabel("Upload files: employees").check();
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("button", { name: "Save permissions", exact: true }).click()]);
  await person.goto(files);
  await expect(person.getByRole("link", { name: "Upload a file" })).toBeVisible();
  await Promise.all([owner.waitForResponse((response) => response.request().method() === "POST"), owner.getByRole("button", { name: "Reset to defaults", exact: true }).click()]);
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
  await owner.getByLabel("Yes, this is my office").check();
  await owner.getByRole("button", { name: "Turn on" }).click();

  const homeContext = await browser.newContext({ userAgent: pcUserAgent });
  const home = await homeContext.newPage();
  await home.setExtraHTTPHeaders({ "x-test-ip": "198.51.100.50" });
  await emailStep(home, laptopEmail);
  await home.getByLabel("6 digit code from the app").fill(totp(deputyKey));
  await home.getByRole("button", { name: "Continue" }).click();
  await expect(home.getByRole("heading", { name: "Use InboxCA from your office." })).toBeVisible();
  await home.getByRole("button", { name: "Ask to use this device away from the office" }).click();
  await expect(home.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();

  await owner.reload();
  const asked = owner.getByRole("listitem").filter({ hasText: "asks to use it away from the office" });
  await asked.getByRole("button", { name: "Allow" }).click();
  await expect(asked).toHaveCount(0);
  await home.goto("/app/clients");
  await expect(home.getByRole("status").filter({ hasText: "this device only views" })).toBeVisible();
  await home.getByRole("link", { name: `Ask Client ${tag}` }).click();
  await home.goto(`${home.url().split("?")[0]}?tab=files`);
  await expect(home.getByRole("button", { name: "Ask to upload" })).toHaveCount(0);
  await expect(home.getByRole("link", { name: "Upload a file" })).toHaveCount(0);

  // Withdrawn, the device is refused at once.
  await owner.reload();
  const personal = owner.getByRole("listitem").filter({ hasText: "away from the office until" });
  await personal.getByRole("button", { name: "Withdraw" }).click();
  await expect(personal).toHaveCount(0);
  await home.goto("/app");
  await expect(home.getByRole("heading", { name: "Your firm refused this PC." })).toBeVisible();
  await owner.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(owner.getByText("Are you in your office right now?")).toBeVisible();
  await owner.setExtraHTTPHeaders({});
  await homeContext.close();
});

// #14, #15, #16, #17: closing, extra time and season hours. Drafts move to M6.
test("the owner keeps people to office hours, and the person sees the firm is closed", async () => {
  await owner.getByRole("link", { name: "Settings" }).click();
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
    await owner.getByRole("row", { name: new RegExp(day) }).getByLabel("Open", { exact: true }).uncheck();
  await owner.getByLabel(/only during office hours/).check();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");

  await owner.getByLabel("Add a holiday").fill("2026-12-25");
  await owner.getByRole("button", { name: "Add holiday" }).click();
  await expect(owner.getByText("Friday, 25 December 2026")).toBeVisible();

  await person.goto("/app");
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm is closed now.");
  await owner.goto("/app");
  await expect(owner.locator(".page-head")).toContainText("Invite Test Firm");

  // Special hours for today open the firm again, closed weekdays or not.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await owner.goto("/app/settings");
  for (const [label, value] of [["From", today], ["To", today], ["Opens", "00:00"], ["Closes", "23:59"]])
    await owner.getByLabel(label, { exact: true }).fill(value);
  await owner.getByRole("button", { name: "Add special hours" }).click();
  await expect(owner.getByText("00:00 to 23:59")).toBeVisible();
  await person.reload();
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm");
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
  await owner.goto("/app/inbox");
  const question = owner.locator("section[aria-labelledby=questions] li").filter({ hasText: `asks to work until ${laterBy(close, 120)} today` });
  await question.getByRole("button", { name: "Allow today" }).click();
  await expect(owner.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  expect(await query(local.dbUrl, "select access -> 'extra_time' ->> 'until' as until from public.firm_members where user_id = $1", [personId])).toEqual([{ until: laterBy(close, 120) }]);
  await query(local.dbUrl, "update public.firms set settings = jsonb_set(settings, '{special_hours,0,close}', '\"23:59\"') where id = $1", [firm.firmId]);
  await query(local.dbUrl, "update public.firm_members set access = access - 'extra_time' where user_id = $1", [personId]);
});

test("in restricted mode a person sees only clients assigned to them or their team", async () => {
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill("Shared Client");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText("Shared Client");
  const client = owner.url();

  await owner.goto("/app/settings");
  await owner.getByLabel(/Only you, partners and the people assigned/).check();
  await owner.getByRole("button", { name: "Save who sees clients" }).click();
  await expect(owner.getByRole("status")).toHaveText("Who sees clients saved.");
  await person.goto("/app/clients");
  await expect(person.getByRole("heading", { name: "0 clients" })).toBeVisible();

  // A team: the person joins it, and the client is assigned to the whole team.
  await owner.goto("/app/people");
  await owner.getByLabel("New team").fill("GST team");
  await owner.getByRole("button", { name: "Add team" }).click();
  const row = owner.getByRole("row").filter({ hasText: newEmail });
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByLabel(`Team for ${newEmail}`).selectOption({ label: "GST team" }),
  ]);
  await expect(owner.locator("section[aria-labelledby=teams]").getByRole("listitem")).toContainText("1 person");
  await owner.goto(`${client}?tab=team`);
  await owner.getByLabel("Person or team").selectOption({ label: "Team: GST team" });
  await owner.getByRole("button", { name: "Assign" }).click();
  await expect(owner.getByRole("listitem").filter({ hasText: "Team: GST team" })).toContainText("Staff");
  await person.reload();
  await expect(person.getByRole("link", { name: "Shared Client" })).toBeVisible();
  await expect(person.getByRole("heading", { name: "1 client", exact: true })).toBeVisible();
});

// #3, #4: configured idle lock and the normal sign out control.
test("after the firm's idle limit, an unattended screen signs out", async () => {
  await owner.goto("/app/settings");
  await owner.getByLabel(/only during office hours/).uncheck();
  await owner.getByRole("button", { name: "Save office hours" }).click();
  await expect(owner.getByRole("status")).toHaveText("Office hours saved.");
  await owner.getByLabel("Sign out after no activity for").selectOption("15");
  await owner.getByRole("button", { name: "Save signing in limits" }).click();
  await expect(owner.getByRole("status")).toHaveText("Signing in limits saved.");

  await person.clock.install();
  await person.goto("/app");
  await expect(person.locator(".page-head")).toContainText("Invite Test Firm");
  await person.clock.fastForward("16:00");
  await expect(person).toHaveURL(/\/sign-in\?reason=idle$/);
  await expect(person.getByRole("status")).toContainText("signed out after a while without activity");
  await person.goto("/app");
  await expect(person).toHaveURL(/\/sign-in$/);
});

// #26, #55, #56: the shared mailbox cannot sign in; automation runs separately.
test("the owner connects the firm's mailbox; client mail is sorted, unclear mail waits for the team, a stranger's is skipped", async ({ request, browser }) => {
  // An address already on the team is refused as soon as it becomes the firm's mailbox.
  await owner.goto("/app/people");
  await owner.getByLabel("Their work email").fill(mailboxEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${mailboxEmail}`);
  await owner.goto("/app/settings");
  const card = owner.locator("section[aria-labelledby=mailbox]");
  await card.getByLabel("The firm's email address").fill(mailboxEmail);
  await card.getByLabel("Its password").fill("wrong");
  await card.getByText("Server settings, only if InboxCA asks").click();
  await card.getByLabel("Incoming (IMAP) server").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing (SMTP) server").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("alert")).toContainText("could not sign in");
  await card.getByLabel("Its password").fill("secret");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${mailboxEmail}`);

  const blocked = await browser.newPage();
  await blocked.goto("/sign-in");
  await blocked.getByLabel("Your work email").fill(mailboxEmail);
  await blocked.getByRole("button", { name: "Email me a code" }).click();
  await expect(blocked.getByRole("alert").filter({ hasText: "The firm's email address cannot be used to sign in." })).toBeVisible();
  await blocked.close();

  const [{ user_id: mailboxUser }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id = m.user_id where m.firm_id = $1 and u.email = $2", [firm.firmId, mailboxEmail]);
  await query(local.dbUrl, "delete from public.firm_members where firm_id = $1 and user_id = $2", [firm.firmId, mailboxUser]);
  await owner.goto("/app/people");
  await owner.getByLabel("Their work email").fill(mailboxEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "The firm's email address cannot be a team login." })).toBeVisible();

  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(mailClient);
  await owner.getByLabel("Email", { exact: true }).fill(`client-${tag}@patel.test`);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(mailClient);
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  for (const from of [`Client-${tag}@Patel.test`, `stranger-${tag}@else.test`])
    await smtp.sendMail({ from, to: mailboxEmail, subject: "Please send last year's ITR", text: "Thanks" });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const events = await query(local.dbUrl, "select (client_id is not null) as matched, label from public.email_events where firm_id = $1", [firm.firmId]);
  expect(events).toEqual([{ matched: true, label: "records_past" }]);

  // A second email the rules cannot place waits for the team, and a person corrects a label.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "Hello", text: "Can we meet next week?" });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.getByRole("link", { name: "Inbox" }).click();
  // The request for last year's ITR found no ITR in the drive, so it waits for the team too.
  const waiting = owner.locator("section[aria-labelledby=team-reply]").getByRole("listitem");
  await expect(waiting).toHaveCount(2);
  await expect(waiting.filter({ hasText: "Asks for a paper that is not in the drive" })).toHaveCount(1);
  for (const reason of ["InboxCA could not tell what it asks", "Asks for a paper that is not in the drive"])
    await waiting.filter({ hasText: reason }).getByRole("button", { name: "Done" }).click();
  await expect(owner.getByText("Nothing waits for the team.")).toBeVisible();
  const latest = owner.locator("section[aria-labelledby=latest] tbody tr");
  await expect(latest).toHaveCount(2);
  await latest.first().getByRole("combobox").selectOption({ label: "Asks for this year's records" });
  await expect(latest.filter({ hasText: "Corrected" })).toHaveCount(1);
});

test("the owner connects a drive only after agreeing to the Drive access terms", async () => {
  await owner.goto("/app/settings");
  const card = owner.locator("section#drive");
  await expect(card.getByLabel(/OneDrive/)).toBeDisabled();
  await card.getByLabel("Test drive on this computer").check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveCount(0);
  await card.getByLabel(/I have read this and I agree/).check();
  await card.getByRole("button", { name: "Connect drive" }).click();
  await expect(card.getByRole("status")).toHaveText("Connected: Test drive on this computer");
  const [consent] = await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'drive.consent'", [firm.firmId]);
  expect(consent.details).toEqual({ provider: "local", level: "whole_drive", terms_version: "2026-10-17" });
});

test("a client's attachments are filed into its folder in the drive; an unclear one waits under To check", async ({ request, browser }) => {
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  await smtp.sendMail({
    from: `client-${tag}@patel.test`,
    to: "office@firm.test",
    subject: "GST data",
    text: "Please find the bills attached.",
    attachments: [
      { filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" },
      { filename: "scan001.pdf", content: "%PDF-1.4 invented scan" },
    ],
  });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  // The first sweep reads the mail; the second files its attachments.
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  // Bills for September 2026 belong to FY 2026-27; the scan names no period, so it goes in the year it arrived.
  const drive = path.join(tmpdir(), "inboxca-test-drive", "InboxCA");
  expect(await readFile(path.join(drive, "FY 2026-27", mailClient, "GST", `${mailClient} - Purchase bills - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  const thisYear = financialYear(new Date().toISOString().slice(0, 7));
  expect(await readFile(path.join(drive, thisYear, mailClient, "GST", "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");

  await owner.goto("/app/clients");
  await owner.getByRole("link", { name: mailClient }).click();
  await owner.getByRole("link", { name: /^Files/ }).click();
  const rows = owner.locator("section[aria-labelledby=files] tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
  // A file opens in the viewer. Only the owner can get the original, sandboxed.
  await rows.getByRole("link", { name: `${mailClient} - Purchase bills - Sep 2026.pdf`, exact: true }).click();
  await expect(owner.getByText("View only. Your email and the time are shown across every page.")).toBeVisible();
  // A screenshot key blanks the pages for a moment, and each try is logged.
  await owner.keyboard.press("PrintScreen");
  await expect(owner.getByText("The document is hidden for a moment.")).toBeVisible();
  await expect.poll(async () => (await query(local.dbUrl, "select count(*)::int as n from public.activity_log where firm_id = $1 and action = 'capture_attempt'", [firm.firmId]))[0].n).toBe(1);
  const raw = owner.url().replace(/\/view$/, "");
  const file = await owner.request.get(raw);
  expect(await file.text()).toBe("%PDF-1.4 invented purchase bills");
  expect(file.headers()).toMatchObject({ "content-type": "application/pdf", "content-security-policy": "sandbox" });
  expect((await owner.request.get(`${raw}?view=1`, { headers: { "x-inboxca-viewer": "1" } })).headers()["content-type"]).toBe("application/pdf");
  await owner.goBack();

  // #46: corrections and undo are logged; a third rename tells the owner on Home.
  for (const attempt of [0, 1]) {
    await rows.getByRole("link", { name: `Change ${mailClient} - Document.pdf` }).click();
    await owner.getByLabel("Type", { exact: true }).selectOption("Other");
    await owner.getByLabel("Name for Other").fill("HDFC loan sanction letter");
    await owner.getByRole("button", { name: "Save", exact: true }).click();
    await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - HDFC loan sanction letter.pdf`);
    const gst = path.join(drive, thisYear, mailClient, "GST");
    expect(await readFile(path.join(gst, `${mailClient} - HDFC loan sanction letter.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");
    if (attempt === 1) {
      const back = owner.url();
      await owner.goto("/app");
      await expect(owner.getByRole("alert").filter({ hasText: `${ownerEmail} renamed 3 files today.` })).toBeVisible();
      await owner.goto(back);
    }
    await owner.getByRole("button", { name: "Undo" }).click();
    await expect(rows.filter({ hasText: `${mailClient} - Document.pdf` })).toContainText("To check");
    expect(await readFile(path.join(gst, "To check", `${mailClient} - Document.pdf`), "utf8")).toBe("%PDF-1.4 invented scan");
  }

  // The same bills sent again wait under To check beside the first copy, for the team to choose.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "Bills again", text: "Sending again.", attachments: [{ filename: "purchase_bills_sep_2026.pdf", content: "%PDF-1.4 invented purchase bills" }] });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.reload();
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");

  // The owner removes the second copy: it waits in the drive's Deleted and old versions folder and can be put back.
  await rows.filter({ hasText: "Same file as" }).getByRole("button", { name: /^Remove/ }).click();
  await expect(owner.getByRole("status")).toContainText("waits 30 days");
  expect(await readFile(path.join(drive, "Deleted and old versions", `${mailClient} - Purchase bills - Sep 2026.pdf`), "utf8")).toBe("%PDF-1.4 invented purchase bills");
  await expect(rows).toHaveCount(2);
  await owner.getByRole("button", { name: "Put back" }).first().click();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Same file as" })).toContainText("To check");

  // A manager or the owner uploads a file and types it; it is saved under its name in the client's folder.
  await owner.getByRole("link", { name: "Upload a file" }).click();
  await owner.getByLabel("File", { exact: true }).setInputFiles({ name: "IMG_2041.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 invented form 16") });
  await owner.getByLabel("Type", { exact: true }).selectOption("Form 16");
  await owner.getByLabel("Work", { exact: true }).selectOption("income_tax");
  await owner.getByLabel("Period", { exact: true }).selectOption({ label: "FY 2025-26" });
  await owner.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText(`Saved as ${mailClient} - Form 16 - FY 2025-26.pdf`);
  expect(await readFile(path.join(drive, "FY 2025-26", mailClient, "Income tax", `${mailClient} - Form 16 - FY 2025-26.pdf`), "utf8")).toBe("%PDF-1.4 invented form 16");

  // Asking the client for files emails them a private link; they upload with no sign in.
  await owner.getByRole("link", { name: "Ask for files" }).click();
  await owner.getByLabel("Sales bills").check();
  await owner.getByLabel("Anything else, by name").fill("Loan statement");
  await owner.getByRole("button", { name: "Ask for files" }).click();
  await expect(owner.getByRole("status")).toContainText("emailed a private upload link");
  const link = (await lastMail(`client-${tag}@patel.test`)).match(/http\S+\/u\/[\w-]+/)![0];
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("heading", { name: `Documents for ${mailClient}` })).toBeVisible();
  const loan = visitor.getByRole("listitem").filter({ hasText: "Loan statement" });
  const loanPdf = Buffer.from(pdf("Invented loan account 99231"));
  await loan.getByLabel("File for Loan statement").setInputFiles({ name: "IMG_77.pdf", mimeType: "application/pdf", buffer: loanPdf });
  await loan.getByRole("button", { name: "Upload" }).click();
  await expect(visitor.getByRole("status")).toContainText("Received: Loan statement");
  await expect(visitor.getByRole("listitem").filter({ hasText: "Loan statement" })).toContainText("1 file received");
  await owner.reload();
  await expect(owner.getByRole("list", { name: "Files asked for" })).toContainText("1 of 2 received");
  await expect(rows.filter({ hasText: "Loan statement" })).toContainText("Filed");

  // A filed document goes to the client as a secure link that stops after 5 downloads.
  await rows.getByRole("link", { name: `Send ${mailClient} - Loan statement`, exact: false }).click();
  await owner.getByRole("button", { name: "Send", exact: true }).click();
  await expect(owner.getByRole("status")).toContainText("works for 7 days and 5 downloads");
  const shared = (await lastMail(`client-${tag}@patel.test`)).match(/http\S+\/s\/[\w-]+/)![0];
  await visitor.goto(shared);
  await expect(visitor.getByRole("heading", { name: /Loan statement/ })).toBeVisible();
  // A loan statement is a private paper: it opens only with the code emailed to the same address.
  expect((await visitor.request.get(`${shared}/file`)).status()).toBe(403);
  await visitor.getByRole("button", { name: "Email me a code" }).click();
  await expect(visitor.getByRole("status")).toContainText("A code is on its way");
  const oneTime = (await lastMail(`client-${tag}@patel.test`)).match(/Your code is (\d{6})/)![1];
  await visitor.getByLabel("Code from the email").fill(oneTime === "000000" ? "111111" : "000000");
  await visitor.getByRole("button", { name: "Open" }).click();
  await expect(visitor.getByRole("status")).toContainText("That code is not right");
  await visitor.getByLabel("Code from the email").fill(oneTime);
  await visitor.getByRole("button", { name: "Open" }).click();
  await expect(visitor.getByRole("link", { name: "Download" })).toBeVisible();
  for (let download = 0; download < 5; download++) expect(Buffer.from(await (await visitor.request.get(`${shared}/file`)).body())).toEqual(loanPdf);
  expect((await visitor.request.get(`${shared}/file`)).status()).toBe(410);

  // Each file is read once after it is filed: a word inside the PDF finds it, as does the name it came with.
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.getByLabel("Find a file").fill("99231");
  await owner.getByRole("button", { name: "Find", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Loan statement");
  await owner.getByLabel("Find a file").fill("IMG_2041");
  await owner.getByRole("button", { name: "Find", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Form 16");
  await owner.getByRole("link", { name: "Show all" }).click();

  // A file removed in the drive itself is marked missing by the nightly check, and the owner is told.
  await unlink(path.join(drive, "FY 2025-26", mailClient, "Income tax", `${mailClient} - Form 16 - FY 2025-26.pdf`));
  await query(local.dbUrl, "select private.queue_drive_checks()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  await owner.reload();
  await expect(rows.filter({ hasText: "Form 16" })).toContainText("Missing in the drive");
  await owner.goto("/app");
  await expect(owner.getByRole("alert").filter({ hasText: "no longer in your drive" })).toBeVisible();

  // A client asks for papers by email: a routine ITR-V goes back at once as a secure link in
  // reply; private financial statements wait in the Inbox for one approval.
  for (const [type, period, content] of [["ITR-V", "FY 2024-25", "invented ITR-V"], ["Balance sheet", "FY 2025-26", "invented balance sheet"]]) {
    await owner.goto("/app/clients");
    await owner.getByRole("link", { name: mailClient }).click();
    await owner.getByRole("link", { name: /^Files/ }).click();
    await owner.getByRole("link", { name: "Upload a file" }).click();
    await owner.getByLabel("File", { exact: true }).setInputFiles({ name: `${type}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(pdf(content)) });
    await owner.getByLabel("Type", { exact: true }).selectOption(type);
    await owner.getByLabel("Period", { exact: true }).selectOption({ label: period });
    await owner.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(owner.getByRole("status")).toContainText("Saved as");
  }
  const ask = async (subject: string, text: string) => {
    await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject, text });
    await query(local.dbUrl, "select private.queue_mail_polls()");
    for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  };
  await ask("ITR copy", "Please send my ITR for AY 2025-26 for the loan.");
  const reply = await lastMail(`client-${tag}@patel.test`);
  expect(reply).toContain(`shared ${mailClient} - ITR-V - FY 2024-25.pdf with you`);
  expect(reply).toMatch(/Download it here: http\S+\/s\//);
  await ask("Financial statements", "Can you share the financial statements for FY 2025-26?");
  await owner.goto("/app/inbox");
  const papers = owner.locator("section[aria-labelledby=papers]");
  await expect(papers).toContainText(`${mailClient} - Balance sheet - FY 2025-26.pdf`);
  await papers.getByRole("button", { name: "Approve and send" }).click();
  await expect(owner.getByRole("status")).toContainText("Sent");
  expect(await lastMail(`client-${tag}@patel.test`)).toContain(`shared ${mailClient} - Balance sheet - FY 2025-26.pdf with you`);

  // A notice a client emails is recorded with what the rules found; its date is only a
  // suggestion until a person confirms it.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "Income tax notice", text: "Notice under section 148 of the Income-tax Act. DIN: ITBA/AST/F/148/2026-27/1050012345(1). Please respond on or before 24/12/2026.", attachments: [{ filename: "notice.pdf", content: Buffer.from(pdf("Invented notice under section 148")) }, { filename: "purchase_bills_jan_2025.csv", content: "Supplier,Amount\nInvented Supplier,1200" }] });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const [noticeFile] = await query(local.dbUrl, "select work_type,drive_file_id from public.documents where firm_id=$1 and document_type='Notice'", [firm.firmId]);
  expect(noticeFile.work_type).toBe("income_tax");
  expect(noticeFile.drive_file_id).toContain("/Income tax/");
  const [support] = await query(local.dbUrl, "select document_type,work_type from public.documents where firm_id=$1 and name like '%Jan 2025.csv'", [firm.firmId]);
  expect(support).toMatchObject({ document_type: "Purchase bills", work_type: "income_tax" });
  await owner.goto("/app");
  await expect(owner.getByRole("alert").filter({ hasText: `${mailClient}: a notice's review deadline` })).toBeVisible();
  await owner.goto("/app/notices");
  const notice = owner.locator("section[aria-labelledby=open-notices] tbody tr").filter({ hasText: mailClient });
  await expect(notice).toContainText("Notice u/s 148");
  await expect(notice).toContainText("ITBA/AST/F/148/2026-27/1050012345");
  await expect(notice).toContainText("Review by");
  await expect(notice.getByLabel(`Action date for ${mailClient}`)).toHaveValue("2026-12-24");
  await notice.getByRole("button", { name: "Confirm date" }).click();
  await expect(notice).toContainText("24 Dec 2026");
  await notice.getByLabel(`Status of the notice for ${mailClient}`).selectOption("replied");
  await expect(owner.locator("section[aria-labelledby=done-notices]")).toContainText(mailClient);

  // Reminders: a confirmed return due in 3 days gets one email; a second run that day sends nothing more.
  const code = `TR${tag.toUpperCase()}`;
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  const [{ id: clientId }] = await query(local.dbUrl, "select id from public.clients where firm_id = $1 and name = $2", [firm.firmId, mailClient]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-09', (now() at time zone 'Asia/Kolkata')::date + 3)", [firm.firmId, clientId, code]);
  await owner.goto("/app/settings");
  await owner.getByLabel("Email clients before their returns are due").check();
  await owner.getByLabel("Reply to clients when their files arrive, saying what was received").check();
  await owner.getByRole("button", { name: "Save reminders" }).click();
  await expect(owner.getByLabel("Reply to clients when their files arrive, saying what was received")).toBeChecked();
  // Files that arrive now get a short reply saying what was received.
  await smtp.sendMail({ from: `client-${tag}@patel.test`, to: "office@firm.test", subject: "August sales", text: "Attached.", attachments: [{ filename: "sales_bills_aug_2026.pdf", content: "%PDF-1.4 invented sales" }] });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  for (let sweep = 0; sweep < 2; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const thanks = await lastMail(`client-${tag}@patel.test`);
  expect(thanks).toContain("Thank you. We have received:\n- Sales bills, Aug 2026");
  // The files asked for earlier were asked 3 days ago now, so the same email follows them up.
  await query(local.dbUrl, "update public.requests set expires_at = now() + interval '27 days' where firm_id = $1 and kind = 'documents'", [firm.firmId]);
  for (let run = 0; run < 2; run++) {
    await query(local.dbUrl, "delete from public.jobs where kind = 'reminders' and firm_id = $1", [firm.firmId]);
    await query(local.dbUrl, "select private.queue_reminders()");
    await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  }
  const reminder = await lastMail(`client-${tag}@patel.test`);
  expect(reminder).toContain("- Test return for Sep 2026: due in 3 days");
  expect(reminder).toMatch(/still waiting for these documents.*: Sales bills\.\nUpload them here, no sign in needed: http\S+\/u\//);
  const [{ details }] = await query(local.dbUrl, "select details from public.tasks where client_id = $1 and code = $2", [clientId, code]);
  expect(details.reminded).toHaveLength(1);
  await query(local.dbUrl, "delete from public.tasks where code = $1", [code]);
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);

  // Old files already in the drive: final papers are sorted into the client's folder in
  // place after a preview, and can be put back.
  const old = path.join(tmpdir(), "inboxca-test-drive", `Old files ${tag}`);
  await mkdir(path.join(old, mailClient, "2025-26"), { recursive: true });
  await mkdir(path.join(old, "Someone else"), { recursive: true });
  await writeFile(path.join(old, mailClient, "2025-26", "ITR-V AY 2025-26.pdf"), "%PDF-1.4 invented ITR-V");
  await writeFile(path.join(old, mailClient, "2025-26", "working notes.txt"), "invented notes");
  await writeFile(path.join(old, "Someone else", "notice.pdf"), "%PDF-1.4 invented notice");
  await owner.goto("/app/import");
  await owner.getByLabel(`Old files ${tag}`).check();
  await owner.getByRole("button", { name: "Show what would move" }).click();
  await expect(owner.getByRole("heading", { name: /^2 files/ })).toBeVisible();
  await owner.getByRole("button", { name: "Move these files" }).click();
  await expect(owner.getByRole("status")).toContainText("Moving your files now");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const itrv = path.join(drive, "FY 2024-25", mailClient, "Income tax", `${mailClient} - ITR-V - FY 2024-25.pdf`);
  expect(await readFile(itrv, "utf8")).toBe("%PDF-1.4 invented ITR-V");
  await owner.reload();
  await owner.getByRole("button", { name: "Put them back" }).click();
  await expect(owner.getByRole("status")).toContainText("Putting the files back");
  for (let sweep = 0; sweep < 3; sweep++) await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  expect(await readFile(path.join(old, mailClient, "2025-26", "ITR-V AY 2025-26.pdf"), "utf8")).toBe("%PDF-1.4 invented ITR-V");
  expect(await readFile(path.join(old, "Someone else", "notice.pdf"), "utf8")).toBe("%PDF-1.4 invented notice");

  await owner.goto("/app/settings");
  for (const section of ["section[aria-labelledby=mailbox]", "section#drive"]) await owner.locator(section).getByRole("button", { name: "Disconnect" }).click();
  await expect(owner.locator("section#drive").getByRole("button", { name: "Connect drive" })).toBeVisible();
  await expect(owner.locator("section[aria-labelledby=mailbox]").getByLabel("The firm's email address")).toBeVisible();
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
    await boss.evaluate(() => Reflect.deleteProperty(window, "PushManager"));
    await boss.getByRole("button", { name: "Turn on notifications on this device" }).click();
    await expect(boss.getByText(/On an iPhone, add InboxCA to the home screen first/)).toBeVisible();
    await boss.goto("/app/settings#office");
    await boss.getByLabel("Yes, this is my office").check();
    await boss.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(boss.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
    await expect(boss.getByRole("heading", { name: "Doors InboxCA cannot close for you" })).toBeVisible();
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
      await expect(pc.getByRole("heading", { name: "This PC is waiting for your firm's approval." })).toBeVisible();
      if (n === 0) expect((await admin.auth.verifyOtp({ email: address, token: code, type: "email" })).error).not.toBeNull();
    }
    await boss.goto("/app");
    await expect(boss.locator(".alert").filter({ hasText: "5 PCs signed in from your office today:" })).toHaveCount(1);
    await boss.getByRole("link", { name: "approve", exact: true }).click();
    await boss.getByRole("button", { name: "Approve all as staying in the office" }).click();
    await expect(boss.getByRole("heading", { name: "PCs waiting for approval" })).toHaveCount(0);
    expect((await query(local.dbUrl, "select count(*)::int n from public.devices where firm_id=$1 and status='approved'", [batch.firmId]))[0].n).toBe(5);
    for (const pc of staff) {
      await pc.goto("/app/clients");
      await expect(pc.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    }
    const words = await boss.locator("section#office").innerText();
    expect(words).not.toMatch(/\bIP\b|cookie|token|passkey|watermark|device ID/i);

    // A manager copies the owner's forms. Both requests are refused and logged.
    const [{ user_id: manager }] = await query(local.dbUrl, "select user_id from public.firm_members m join auth.users u on u.id=m.user_id where m.firm_id=$1 and u.email=$2", [batch.firmId, emails[0]]);
    await query(local.dbUrl, "update public.firm_members set role='manager' where firm_id=$1 and user_id=$2", [batch.firmId, manager]);
    for (const [button, value] of [["Turn off", { intent: "off" }], ["Withdraw", { decision: "withdraw" }]] as const) {
      const form = boss.locator("section#office form").filter({ has: boss.getByRole("button", { name: button, exact: true }) }).first();
      const fields = await actionFields(boss, "/app/settings", button === "Turn off" ? { intent: "off" } : { device: await form.locator('input[name="device"]').inputValue() });
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
    const fields = await actionFields(boss, "/app/inbox", { request });
    await staff[0].request.post("/app/inbox", { multipart: { ...fields, intent: "always" }, headers: { Origin: new URL(staff[0].url()).origin } });
    expect((await query(local.dbUrl, "select status from public.requests where id=$1", [request]))[0].status).toBe("pending");
    expect((await query(local.dbUrl, "select access->'always' as rights from public.firm_members where firm_id=$1 and user_id=$2", [batch.firmId, asker]))[0].rights).toBeNull();
    expect((await query(local.dbUrl, "select count(*)::int n from public.activity_log where firm_id=$1 and actor_id=$2 and action='approval.denied' and details->>'kind'='always'", [batch.firmId, manager]))[0].n).toBe(1);

    // With a trusted PC present, three confirmation taps trigger the suggestion.
    await query(local.dbUrl, "update public.devices set key_id='test-key',key_public='test-public' where id=(select id from public.devices where firm_id=$1 limit 1)", [batch.firmId]);
    await boss.reload();
    await expect(boss.getByText("ask your internet provider for a fixed address")).toHaveCount(0);
    for (const ipv4 of ["203.0.113.71", "203.0.113.72", "203.0.113.73"]) await query(local.dbUrl, "select public.office_control($1,$2,'here',connection=>$3)", [batch.firmId, batch.ownerId, { ipv4 }]);
    await boss.reload();
    await expect(boss.getByText("ask your internet provider for a fixed address")).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await batch.remove(...emails);
  }
});
