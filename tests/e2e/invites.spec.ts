import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import nodemailer from "nodemailer";
import { TEST_WORKER_SECRET } from "../../playwright.config";
import { emailStep, latestEmail, localSupabase, query, seedFirm, totp } from "./local-supabase";

// The owner invites a new person, who signs in from the invite email, sets up a 2 step
// code and joins the firm. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `owner-${tag}@example.test`;
const newEmail = `new-${tag}@example.test`;
// A base32 authenticator key, given to the owner directly so their sign in is quick.
const ownerKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let person: Page;

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm("Invite Test Firm", ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  person = await (await browser.newContext()).newPage();
});
test.afterAll(() => firm.remove(newEmail));

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
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
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
  const key = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Invite Test Firm has invited you as manager.")).toBeVisible();
  await page.getByRole("button", { name: "Join Invite Test Firm" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
  await expect(page.locator(".app-role")).toHaveText("You are signed in as manager.");
  await expect(page.getByText(/has invited you/)).toHaveCount(0);

  // Only the owner invites.
  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("manager");
  await expect(row).not.toContainText("Invited");
});

test("the owner changes the role, removes the person and brings them back", async () => {
  await owner.goto("/app/people");
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await row.getByLabel(`Role for ${newEmail}`).selectOption("staff");
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await owner.reload();
  await expect(row.getByLabel(`Role for ${newEmail}`)).toHaveValue("staff");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("Removed");
  await row.getByRole("button", { name: "Bring back" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();
});

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
  await expect(person.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm is closed now.");
  await owner.goto("/app");
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");

  // Special hours for today open the firm again, closed weekdays or not.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await owner.goto("/app/settings");
  for (const [label, value] of [["From", today], ["To", today], ["Opens", "00:00"], ["Closes", "23:59"]])
    await owner.getByLabel(label, { exact: true }).fill(value);
  await owner.getByRole("button", { name: "Add special hours" }).click();
  await expect(owner.getByText("00:00 to 23:59")).toBeVisible();
  await person.reload();
  await expect(person.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
  await expect(person.getByRole("heading", { level: 1 })).not.toContainText("closed");
});

test("in restricted mode a person sees only clients assigned to them or their team", async () => {
  await owner.goto("/app/clients");
  await owner.getByLabel("Name", { exact: true }).fill("Shared Client");
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Shared Client");
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
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await row.getByLabel(`Team for ${newEmail}`).selectOption({ label: "GST team" });
  await Promise.all([
    owner.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(owner.locator("section[aria-labelledby=teams]").getByRole("listitem")).toContainText("1 person");
  await owner.goto(client);
  await owner.getByLabel("Person or team").selectOption({ label: "Team: GST team" });
  await owner.getByRole("button", { name: "Assign" }).click();
  await expect(owner.getByRole("listitem").filter({ hasText: "Team: GST team" })).toContainText("Staff");
  await person.reload();
  await expect(person.getByRole("link", { name: "Shared Client" })).toBeVisible();
  await expect(person.getByRole("heading", { name: "1 client", exact: true })).toBeVisible();
});

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
  await expect(person.getByRole("heading", { level: 1 })).toContainText("Invite Test Firm");
  await person.clock.fastForward("16:00");
  await expect(person).toHaveURL(/\/sign-in\?reason=idle$/);
  await expect(person.getByRole("status")).toContainText("signed out after a while without activity");
  await person.goto("/app");
  await expect(person).toHaveURL(/\/sign-in$/);
});

test("the owner connects the firm's mailbox; mail from a client is noted, a stranger's is not", async ({ request }) => {
  await owner.goto("/app/settings");
  const card = owner.locator("section[aria-labelledby=mailbox]");
  await card.getByLabel("The firm's email address").fill("office@firm.test");
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
  await expect(card.getByRole("status")).toHaveText("Connected: office@firm.test");

  await owner.goto("/app/clients");
  await owner.getByLabel("Name", { exact: true }).fill("Mail Client");
  await owner.getByLabel("Email", { exact: true }).fill(`client-${tag}@patel.test`);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Mail Client");
  const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
  for (const from of [`Client-${tag}@Patel.test`, `stranger-${tag}@else.test`])
    await smtp.sendMail({ from, to: "office@firm.test", subject: "Please send last year's ITR", text: "Thanks" });
  await query(local.dbUrl, "select private.queue_mail_polls()");
  await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
  const events = await query(local.dbUrl, "select (client_id is not null) as matched from public.email_events where firm_id = $1", [firm.firmId]);
  expect(events).toEqual([{ matched: true }]);

  await owner.goto("/app/settings");
  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByLabel("The firm's email address")).toBeVisible();
});
