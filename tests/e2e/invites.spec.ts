import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { latestEmail, localSupabase, totp } from "./local-supabase";

// The owner invites a new person, who signs in from the invite email, sets up a 2 step
// code and joins the firm. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const admin = () =>
  createClient(local.url, local.secretKey, { auth: { persistSession: false } });
const tag = randomUUID().slice(0, 8);
const ownerEmail = `owner-${tag}@example.test`;
const newEmail = `new-${tag}@example.test`;
// A base32 authenticator key, given to the owner directly so their sign in is quick.
const ownerKey = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
let ownerId = "";
let firmId = "";
let owner: Page;

async function db<T>(fn: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: local.dbUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async ({ browser }) => {
  const { data, error } = await admin().auth.admin.createUser({ email: ownerEmail, email_confirm: true });
  if (error) throw error;
  ownerId = data.user.id;
  await db(async (client) => {
    firmId = (
      await client.query(
        "insert into public.firms (name, state_code, status) values ('Invite Test Firm', '27', 'active') returning id",
      )
    ).rows[0].id;
    await client.query(
      "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
      [firmId, ownerId],
    );
    await client.query(
      "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())",
      [ownerId, ownerKey],
    );
  });
  owner = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  // The firm's log lines go with it, which the log allows only with the purge flag set.
  await db(async (client) => {
    await client.query("begin");
    await client.query("select set_config('app.log_purge', 'on', true)");
    await client.query("delete from public.firms where id = $1", [firmId]);
    await client.query("commit");
    await client.query("delete from auth.users where email in ($1, $2)", [ownerEmail, newEmail]);
  });
});

test("the owner invites a new person, who appears as invited", async () => {
  const sent = Date.now() - 1000;
  await owner.goto("/sign-in");
  await owner.getByLabel("Your work email").fill(ownerEmail);
  await owner.getByRole("button", { name: "Email me a code" }).click();
  await owner.getByLabel("Code from the email").fill((await latestEmail(local.mailUrl, ownerEmail, sent)).code);
  await owner.getByRole("button", { name: "Continue" }).click();
  await owner.getByLabel("6 digit code from the app").fill(totp(ownerKey));
  await owner.getByRole("button", { name: "Continue" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "People" }).click();
  await expect(owner.getByText(ownerEmail)).toBeVisible();
  await owner.getByLabel("Their work email").fill(newEmail.toUpperCase());
  await owner.getByLabel("Role").selectOption("manager");
  await owner.getByRole("button", { name: "Invite" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invited ${newEmail}`);
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await expect(row).toContainText("manager");
  await expect(row).toContainText("invited");

  await owner.getByLabel("Their work email").fill(newEmail);
  await owner.getByRole("button", { name: "Invite" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "already on your firm's list" })).toBeVisible();
});

test("the invited person signs in from the email, sets up 2 step and joins", async ({ page, baseURL }) => {
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
  await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);

  await owner.reload();
  const row = owner.getByRole("listitem").filter({ hasText: newEmail });
  await expect(row).toContainText("manager");
  await expect(row).not.toContainText("invited");
});
