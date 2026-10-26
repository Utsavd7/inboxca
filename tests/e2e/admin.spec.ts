import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { addDays, dueLabel } from "@/src/lib/calendar";
import { firmWith, govItems, indiaToday } from "./gov-items";
import { emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");
const newKey = () => Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");

// A listed Orelu admin signed in with a passkey, on localhost (passkeys need a domain).
async function signedInAdmin(browser: Browser, baseURL: string) {
  const key = newKey(), email = `orelu-admin-${randomUUID()}@invented.test`;
  const setup = await seedFirm("Invented Admin Setup", email, key);
  await query(local.dbUrl, "delete from public.firm_members where user_id = $1", [setup.ownerId]);
  await query(local.dbUrl, "insert into public.orelu_admins (user_id) values ($1)", [setup.ownerId]);
  const context = await browser.newContext({ baseURL: baseURL.replace("127.0.0.1", "localhost") });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Set up a passkey" }).click();
  await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();
  return { page, id: setup.ownerId, close: async () => { await context.close().catch(() => {}); await setup.remove(); } };
}

// A firm owner signed in with their 2 step code.
async function signedInOwner(browser: Browser, name: string) {
  const key = newKey(), email = `admin-owner-${randomUUID()}@invented.test`;
  const firm = await seedFirm(name, email, key);
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { page, email, firm, close: async () => { await context.close().catch(() => {}); await firm.remove(); } };
}

// The newest message in a GreenMail mailbox, or "" when none has come.
async function lastMail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX");
    const message = await imap.fetchOne("*", { source: true });
    return message && message.source ? await simpleParser(message.source) : null;
  } catch {
    return null;
  } finally {
    await imap.logout().catch(() => {});
  }
}

// M11: Orelu's admin console shows firm health to a listed admin, never client data, and a
// firm owner cannot open it.
test("an Orelu admin signs in with a passkey, sees firm health and retries a failed job; a firm owner is refused", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const ownerEmail = `admin-owner-${randomUUID()}@invented.test`, adminEmail = `orelu-admin-${randomUUID()}@invented.test`, otherEmail = `orelu-admin-${randomUUID()}@invented.test`;
  const name = `Invented Admin Firm ${randomUUID().slice(0, 8)}`;
  const firm = await seedFirm(name, ownerEmail, key), setup = await seedFirm("Invented Admin Setup", adminEmail, key), lostAdmin = await seedFirm("Invented Admin Lost", otherEmail);
  const context = await browser.newContext(), owner = await context.newPage();
  const adminContext = await browser.newContext({ baseURL: baseURL!.replace("127.0.0.1", "localhost") });
  try {
    await query(local.dbUrl, "delete from public.firm_members where user_id = any($1)", [[setup.ownerId, lostAdmin.ownerId]]);
    await query(local.dbUrl, "insert into public.orelu_admins (user_id) values ($1), ($2)", [setup.ownerId, lostAdmin.ownerId]);
    await query(local.dbUrl, "insert into public.admin_passkeys (id, user_id, public_key) values ($1, $2, 'invented')", [randomUUID(), lostAdmin.ownerId]);
    await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, 'Invented Admin Secret Client', 'business')", [firm.firmId]);
    const [{ id: job }] = await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, 'mail_poll', 'account', $2, $3, 'failed', 5, 'mail_unreachable') returning id", [firm.firmId, randomUUID(), `admin-e2e:${randomUUID()}`]);

    await emailStep(owner, ownerEmail);
    await owner.getByLabel("6 digit code from the app").fill(totp(key));
    await owner.getByRole("button", { name: "Continue" }).click();
    await expect(owner).toHaveURL(/\/app$/);
    expect((await owner.goto("/admin/firms"))?.status()).toBe(404);
    await expect(owner.getByText(name)).toHaveCount(0);
    // A page that is not there says so and leads back: to Today when signed in, inside the app's frame for its own pages.
    await expect(owner.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(owner.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/app");
    await owner.goto(`/app/clients/${randomUUID()}`);
    await expect(owner.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(owner.getByRole("navigation", { name: "InboxCA" })).toBeVisible();
    await owner.getByRole("link", { name: "Go to Today" }).click();
    await expect(owner).toHaveURL(/[/]app$/);
    expect((await page.goto("/no-such-page"))?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");

    // PLAN.md 8.1: after the email and 2 step codes an admin sets up a passkey, here a virtual
    // authenticator in Chrome on localhost (passkeys need a domain, not an address).
    page = await adminContext.newPage();
    const cdp = await adminContext.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const options = { protocol: "ctap2", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } as const;
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { ...options, transport: "internal" } });
    await emailStep(page, adminEmail);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up a passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Set up a passkey" }).click();
    await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();

    // A second passkey on a security key, then the console asks again once the hour's proof is gone.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { ...options, transport: "usb" } });
    await page.getByRole("link", { name: "Admins" }).click();
    const me = page.locator(".admin-row").filter({ hasText: adminEmail });
    await expect(me).toContainText("1 passkey");
    await me.getByRole("button", { name: "Add a passkey" }).click();
    await expect(me).toContainText("2 passkeys");
    await adminContext.clearCookies({ name: "orelu_admin_proof" });
    await page.goto("/admin/firms");
    await expect(page.getByRole("heading", { name: "Confirm with your passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Use my passkey" }).click();
    await expect(page.getByRole("heading", { name: "Today's changes" })).toBeVisible();
    expect(await query(local.dbUrl, "select max(counter) > 0 as counted from public.admin_passkeys where user_id = $1", [setup.ownerId])).toEqual([{ counted: true }]);

    // Recovery: another admin who lost their passkey has it removed, which is logged.
    await page.getByRole("link", { name: "Admins" }).click();
    const lost = page.locator(".admin-row").filter({ hasText: otherEmail });
    await expect(lost).toContainText("1 passkey");
    await lost.getByRole("button", { name: "Remove passkeys" }).click();
    await expect(lost).toContainText("0 passkeys");
    expect(await query(local.dbUrl, "select actor_id, firm_id from public.activity_log where action = 'admin.passkeys_removed' and entity_id = $1", [lostAdmin.ownerId])).toEqual([{ actor_id: setup.ownerId, firm_id: null }]);

    await page.getByRole("link", { name: "Firms" }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Not connected");
    await expect(page.getByText("Invented Admin Secret Client")).toHaveCount(0);

    await page.getByRole("link", { name: "Failed jobs" }).click();
    const failed = page.getByRole("row").filter({ hasText: name });
    await expect(failed).toContainText("mail_unreachable");
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    expect((await query(local.dbUrl, "select state from public.jobs where id = $1", [job]))[0].state).not.toBe("failed");

    await page.getByRole("link", { name: "Due dates" }).click();
    await expect(page.getByRole("row").filter({ hasText: "GSTR1_M" })).toBeVisible();
  } finally {
    await context.close().catch(() => {});
    await adminContext.close().catch(() => {});
    await query(local.dbUrl, "delete from public.jobs where firm_id = $1", [firm.firmId]);
    await firm.remove();
    await setup.remove();
    await lostAdmin.remove();
  }
});

// PLAN.md 5.17 #43: the public status page, and an incident from posted to fixed, with the
// outage email to firm owners (the test server's system mail is the local GreenMail).
test("anyone sees each part's status with no sign in and no firm; an admin's incident runs from posted to fixed and emails the owners", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const title = `Invented outage ${randomUUID().slice(0, 8)}`, ownerEmail = `status-owner-${randomUUID()}@invented.test`, name = `Invented Status Firm ${randomUUID().slice(0, 8)}`;
  const firm = await seedFirm(name, ownerEmail);
  const admin = await signedInAdmin(browser, baseURL!);
  const parts = page.locator(".status-parts li");
  try {
    expect((await page.goto("/status"))?.status()).toBe(200);
    await expect(parts).toHaveCount(4);
    for (const part of ["The app", "Mail reading", "File worker", "Reminders"]) await expect(parts.filter({ hasText: part })).toContainText(/Working|Slow|Down|Not set up yet/);
    expect(await page.content()).not.toContain(name);

    await admin.page.getByRole("link", { name: "Status" }).click();
    await admin.page.getByLabel("What is wrong, in words for firms").fill(title);
    await admin.page.getByLabel("The app").check();
    await admin.page.getByRole("button", { name: "Post" }).click();
    const row = admin.page.locator(".admin-incident").filter({ hasText: title });
    await expect(row).toContainText("Down");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Some parts of InboxCA are down" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Now" })).toContainText(title);
    await expect(parts.filter({ hasText: "The app" })).toContainText("Down");

    await row.getByRole("button", { name: "Email the firms" }).click();
    await expect(row).toContainText("Emailed");
    await expect.poll(async () => (await lastMail(ownerEmail))?.subject, { timeout: 30_000 }).toBe(`InboxCA: ${title}`);
    const mail = await lastMail(ownerEmail);
    expect(mail?.text).toContain("/status");
    expect(mail?.text).not.toContain(name);

    await row.getByLabel("Note").fill("Back to normal");
    await row.getByRole("button", { name: "Close as fixed" }).click();
    await expect(row).toContainText("Fixed");
    await page.reload();
    await expect(page.getByRole("region", { name: "Now" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Past incidents" })).toContainText(`${title}`);
    await expect(page.getByRole("region", { name: "Past incidents" })).toContainText("Back to normal");
    await expect(parts.filter({ hasText: "The app" })).toContainText("Working");
  } finally {
    const incidents = await query(local.dbUrl, "select id from public.incidents where title = $1", [title]);
    for (const { id } of incidents) {
      await query(local.dbUrl, "delete from public.jobs where kind = 'outage_email' and entity_id = $1", [id]);
      await query(local.dbUrl, "delete from public.incidents where id = $1", [id]);
    }
    await admin.close();
    await firm.remove();
  }
});

// M11: one firm's page (a failed job tried again, support access the owner allows for an
// hour) and a CA's check of a due date rule, which clears the * on the firm's calendar.
test("an admin retries a firm's failed job, looks only in the hour its owner allows, and a CA's check clears the calendar's mark", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const code = `ZE${randomBytes(4).toString("hex").toUpperCase()}`, client = `Invented Calendar Client ${randomUUID().slice(0, 8)}`, name = `Invented Admin Firm ${randomUUID().slice(0, 8)}`;
  const owner = await signedInOwner(browser, name);
  const admin = await signedInAdmin(browser, baseURL!);
  try {
    await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule) values ($1, $2, 'monthly', '{\"for\": \"pan\", \"after\": 1, \"day\": 11}')", [code, `Invented return ${code}`]);
    const [{ id: clientId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [owner.firm.firmId, client]);
    await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-10', (now() at time zone 'Asia/Kolkata')::date + 3)", [owner.firm.firmId, clientId, code]);
    const [{ id: job }] = await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, state, attempts, last_error_code) values ($1, 'mail_poll', 'account', $2, $3, 'failed', 5, 'mail_unreachable') returning id", [owner.firm.firmId, randomUUID(), `admin-e2e:${randomUUID()}`]);

    await owner.page.goto("/app/calendar");
    await expect(owner.page.getByRole("row").filter({ hasText: client })).toContainText("*");

    await admin.page.getByRole("link", { name: "Firms" }).click();
    await admin.page.getByRole("link", { name }).click();
    await expect(admin.page.getByRole("heading", { name })).toBeVisible();
    const failed = admin.page.getByRole("region", { name: "Failed jobs" }).locator(".admin-row").filter({ hasText: "mail_unreachable" });
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    expect((await query(local.dbUrl, "select state from public.jobs where id = $1", [job]))[0].state).not.toBe("failed");

    const support = admin.page.getByRole("region", { name: "Support access" });
    await expect(support).not.toContainText(client);
    await support.getByRole("button", { name: "Ask the owner" }).click();
    await expect(support).toContainText("Waiting for the owner to approve in Settings.");
    await owner.page.goto("/app/settings?group=data");
    const card = owner.page.locator("#support");
    await card.getByRole("button", { name: "Allow for 1 hour" }).click();
    await expect(card).toContainText("Orelu support can look until");
    await admin.page.reload();
    await expect(support).toContainText(owner.email);
    await expect(support).toContainText(client);
    await card.getByRole("button", { name: "End now" }).click();
    await expect(card).toContainText("You ended it");
    await expect(card).toContainText("Orelu support looked at your people and client names");
    await admin.page.reload();
    await expect(support).not.toContainText(client);

    await admin.page.getByRole("link", { name: "Due dates" }).click();
    const check = admin.page.locator(`form[id="${code}-"]`);
    await check.getByLabel("Notification link").fill("https://example.test/invented-notification");
    await check.getByLabel("Checked by (CA)").fill("CA Invented Person");
    await check.getByRole("button", { name: "Mark checked" }).click();
    await expect(check).toHaveCount(0);
    await expect(admin.page.getByRole("row").filter({ hasText: code })).toContainText("CA Invented Person");
    await owner.page.goto("/app/calendar");
    await expect(owner.page.getByRole("row").filter({ hasText: client })).not.toContainText("*");
  } finally {
    await admin.close();
    await owner.close();
    await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
  }
});

// M11: a government extension entered in the console moves a firm's open return only once a
// CA has checked it; the office thresholds and a change from the daily forms check are saved
// from the console too, each with the admin's name on it.
test("an admin records an extension a CA then checks, saves the office thresholds and marks a forms change reviewed", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const tag = randomUUID().slice(0, 8), code = `ZX${randomBytes(4).toString("hex").toUpperCase()}`, client = `Invented Extension Client ${tag}`, name = `Invented Extension Firm ${tag}`;
  const later = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const change = { source: `invented-${tag}`, name: `Invented form ${tag}`, url: "https://example.test/invented-form", at: new Date().toISOString(), status: "draft" };
  const [thresholds] = await query(local.dbUrl, "select value from public.platform_settings where key = 'office'");
  const owner = await signedInOwner(browser, name);
  const admin = await signedInAdmin(browser, baseURL!);
  const logged = (action: string) => query(local.dbUrl, "select actor_id, details from public.activity_log where firm_id is null and actor_id = $1 and action = $2", [admin.id, action]);
  try {
    await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, $2, 'monthly', '{\"for\": \"pan\", \"after\": 1, \"day\": 11}', 'https://example.test/invented-rule', current_date, 'CA Invented')", [code, `Invented return ${code}`]);
    const [{ id: clientId }] = await query(local.dbUrl, "insert into public.clients (firm_id, name, kind) values ($1, $2, 'individual') returning id", [owner.firm.firmId, client]);
    await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-10', $4)", [owner.firm.firmId, clientId, code, later(3)]);
    const dueOn = async () => (await query(local.dbUrl, "select due_on::text from public.tasks where client_id = $1", [clientId]))[0].due_on;

    await admin.page.getByRole("link", { name: "Due dates" }).click();
    const record = admin.page.getByRole("region", { name: "Record an extension" });
    await record.getByLabel("Return").selectOption(code);
    await record.getByLabel("Period, its last month").fill("2026-10");
    await record.getByLabel("New due date").fill(later(20));
    await record.getByLabel("Notification link").fill("https://example.test/invented-extension");
    await record.getByRole("button", { name: "Save for a CA to check" }).click();
    const check = admin.page.locator(`form[id="${code}-2026-10"]`);
    await expect(check).toContainText(`Extension for 2026-10 to ${dueLabel(later(20))}: moves 1 return at 1 firm.`);
    expect(await logged("admin.extension_added")).toEqual([{ actor_id: admin.id, details: { code, period: "2026-10", on: later(20) } }]);
    // Until a CA checks it against the notification, the return keeps its date.
    await admin.page.getByRole("link", { name: "Today's changes" }).click();
    await expect(admin.page.getByRole("region", { name: "Due date changes" }).locator(".admin-row").filter({ hasText: code })).toContainText(`Touches 1 open return at 1 firm: ${name}.`);
    expect(await dueOn()).toBe(later(3));
    await admin.page.getByRole("link", { name: "Due dates" }).click();
    await expect(check.getByLabel("Notification link")).toHaveValue("https://example.test/invented-extension");
    await check.getByLabel("Checked by (CA)").fill("CA Invented Person");
    await check.getByRole("button", { name: "Mark checked" }).click();
    await expect(check).toHaveCount(0);
    expect(await dueOn()).toBe(later(20));
    expect(await logged("admin.rule_verified")).toEqual([{ actor_id: admin.id, details: { code, period: "2026-10", by: "CA Invented Person" } }]);

    // A change the daily check found waits until an admin marks it reviewed.
    await query(local.dbUrl, "insert into public.platform_settings (key, value) values ('watch', jsonb_build_object('changes', jsonb_build_array($1::jsonb))) on conflict (key) do update set value = jsonb_set(public.platform_settings.value, '{changes}', coalesce(public.platform_settings.value -> 'changes', '[]') || jsonb_build_array($1::jsonb))", [change]);
    await admin.page.getByRole("link", { name: "Today's changes" }).click();
    const row = admin.page.getByRole("region", { name: "Changes to review" }).locator(".admin-row").filter({ hasText: change.name });
    await expect(row).toContainText("Touches no firm's open returns.");
    await row.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(row).toHaveCount(0);
    const [{ reviewed }] = await query(local.dbUrl, "select c as reviewed from public.platform_settings, jsonb_array_elements(value -> 'changes') c where key = 'watch' and c ->> 'source' = $1", [change.source]);
    expect(reviewed).toMatchObject({ status: "reviewed", reviewed_by: admin.id });

    // The fixed connection suggestion's thresholds, shared by every firm, so they are put back after.
    await admin.page.getByRole("link", { name: "Office connections" }).click();
    const rule = admin.page.getByRole("region", { name: "Fixed connection suggestion" });
    await rule.getByLabel("Confirmations").fill("4");
    await rule.getByLabel("In days").fill("21");
    await rule.getByRole("button", { name: "Save" }).click();
    await expect(admin.page.locator(".page-head")).toContainText("over the last 21 days");
    await admin.page.reload();
    await expect(rule.getByLabel("Confirmations")).toHaveValue("4");
    await expect(rule.getByLabel("In days")).toHaveValue("21");
    expect(await logged("admin.office_thresholds")).toEqual([{ actor_id: admin.id, details: { taps: 4, days: 21 } }]);
  } finally {
    if (thresholds) await query(local.dbUrl, "update public.platform_settings set value = $1 where key = 'office'", [thresholds.value]);
    else await query(local.dbUrl, "delete from public.platform_settings where key = 'office'");
    await query(local.dbUrl, "update public.platform_settings set value = jsonb_set(value, '{changes}', (select coalesce(jsonb_agg(c), '[]') from jsonb_array_elements(value -> 'changes') c where c ->> 'source' <> $1)) where key = 'watch'", [change.source]);
    await admin.close();
    await owner.close();
    await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
  }
});

test("an admin adds the one line firms see under a new government item, and ends a form version only with its official link", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const id = randomBytes(8).toString("hex"), title = `Invented GSTR-1 workbook ${id}`, form = `ZZ${id.slice(0, 8).toUpperCase()}`;
  // Seen yesterday, so another test's items from today stay first on Today.
  await govItems.add([{ id, source: "gst_offline_tools", area: "gst", title, link: "https://www.gst.gov.in/download/returns", seen: addDays(indiaToday(), -1) }]);
  await query(local.dbUrl, "insert into public.templates (form_code, version, valid_from, status, source, mappings) values ($1, '1.0', '2026-04-01', 'active', $2, $3)", [form, { file: "invented.xlsx", url: "https://tutorial.gst.gov.in/invented.zip" }, { format: "xlsx" }]);
  const admin = await signedInAdmin(browser, baseURL!);
  const owner = await firmWith(browser, "gstin", ["GSTR1_M"]);
  const logged = async (action: string) => query(local.dbUrl, "select details from public.activity_log where action = $1 and actor_id = $2", [action, admin.id]);
  try {
    const row = admin.page.getByRole("region", { name: "New from the government" }).locator(".admin-row").filter({ hasText: title });
    await expect(row).toContainText("GST. GST portal offline tools, seen on");
    await row.getByRole("button", { name: "Save the line" }).click();
    await expect(admin.page.locator("p.alert")).toContainText("Give either the date");
    await row.getByLabel("InboxCA uses this from").fill("2026-11-01");
    await row.getByRole("button", { name: "Save the line" }).click();
    await expect(row).toContainText("InboxCA uses this from 1 Nov 2026.");
    expect(await logged("admin.update_noted")).toEqual([{ details: { item: id, uses: "2026-11-01", keeps: null } }]);
    // The firm sees the line with the item, in the government's own words.
    await owner.page.goto("/app/government");
    await expect(owner.page.locator(".app-row").filter({ hasText: title })).toContainText(`GST portal offline tools, seen on ${dueLabel(addDays(indiaToday(), -1))}. InboxCA uses this from 1 Nov 2026.`);

    // A version ends only with the official notice that discontinues it.
    await admin.page.getByRole("link", { name: "Form versions" }).click();
    const version = admin.page.locator(".admin-row").filter({ hasText: `${form} version 1.0` });
    await expect(version).toContainText("For Apr 2026 onwards.");
    await version.getByLabel("Last period").fill("2026-09");
    await version.getByLabel("Official link that discontinues it").fill("https://cbic-gst.gov.in/invented-notice.pdf");
    await version.getByRole("button", { name: "Set last period" }).click();
    await expect(version).toContainText("For Apr 2026 to Sep 2026.");
    await expect(version.getByRole("link", { name: "The notice that ends it" })).toHaveAttribute("href", "https://cbic-gst.gov.in/invented-notice.pdf");
    expect(await logged("admin.template_ended")).toEqual([{ details: { form, version: "1.0", until: "2026-10-01", link: "https://cbic-gst.gov.in/invented-notice.pdf" } }]);
  } finally {
    await govItems.remove([id]);
    await query(local.dbUrl, "delete from public.templates where form_code = $1", [form]);
    await admin.close();
    await owner.close();
  }
});
