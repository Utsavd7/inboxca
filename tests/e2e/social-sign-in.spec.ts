import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { appKey, emailStep, localSupabase, query, seedFirm, totp } from "./local-supabase";

// Continue with Google or Microsoft through the real pages, the real callback and Supabase's
// real code exchange. Google and Microsoft themselves are never called: the browser's trip to
// Supabase's authorize address is answered here, the way Supabase answers once the provider
// has signed the person in (or refused).
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ timeout: 90_000 });

// Made when a test runs, so the file loads where there is no local Supabase (the skip above).
const admin = () => createClient(local.url, local.secretKey, { auth: { persistSession: false } });
const names = { google: "Google", azure: "Microsoft" } as const;
type Via = keyof typeof names;
const tag = () => randomUUID().slice(0, 8);

// Answers Supabase's authorize address: with an error query, as Supabase sends one back, or with
// a code made the way Supabase makes one after the provider (an auth.flow_state row naming the
// person), which only this browser's PKCE verifier can exchange. Returns the addresses asked.
async function provider(page: Page, via: Via, answer: { user: string } | { error: Record<string, string> }) {
  const asked: URL[] = [];
  await page.route((url) => url.href.startsWith(`${local.url}/auth/v1/authorize?`), async (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const back = new URL(url.searchParams.get("redirect_to")!);
    if ("user" in answer) {
      const code = randomUUID();
      await query(
        local.dbUrl,
        "insert into auth.flow_state (id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, authentication_method, created_at, updated_at) values (gen_random_uuid(), $1, $2, 's256', $3, $4, '', '', 'oauth', now(), now())",
        [answer.user, code, url.searchParams.get("code_challenge"), via],
      );
      back.searchParams.set("code", code);
    } else for (const [key, value] of Object.entries(answer.error)) back.searchParams.set(key, value);
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await page.getByRole("button", { name: `Continue with ${names[via]}` }).click();
  return asked;
}

// What Supabase does when the provider signs in a confirmed address it already has: the
// provider's identity joins that same account.
const link = (userId: string, via: Via, email: string, verified = true) => {
  const sub = `${via}-${randomUUID()}`;
  return query(
    local.dbUrl,
    "insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values ($1, $2, $3, $4, now(), now(), now())",
    [sub, userId, { sub, email, email_verified: verified, provider_id: sub }, via],
  );
};

// What Supabase makes when the provider signs in an address it does not know: a confirmed login
// whose only identity is the provider's.
async function providerUser(email: string, via: Via) {
  const { data, error } = await admin().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  await query(local.dbUrl, "delete from auth.identities where user_id = $1", [data.user.id]);
  await query(local.dbUrl, "update auth.users set raw_app_meta_data = jsonb_build_object('provider', $2::text, 'providers', jsonb_build_array($2::text)) where id = $1", [data.user.id, via]);
  await link(data.user.id, via, email);
  return data.user.id;
}

const removeFirm = (name: string) =>
  query(local.dbUrl, "with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where name = $1 and exists (select 1 from gone)", [name]);

// A fresh code from the app, never the one used last: Supabase takes a code once.
async function freshTotp(secret: string, used: string) {
  let code = totp(secret);
  while (code === used) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    code = totp(secret);
  }
  return code;
}

test("Google and Microsoft lead sign in and sign up, and go to Supabase's sign in with PKCE", async ({ page, baseURL }) => {
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toBeVisible();
    await expect(page.getByText("or use your email")).toBeVisible();
    await expect(page.getByLabel("Your work email")).toBeVisible();
  }
  for (const via of ["google", "azure"] as const) {
    await page.goto("/sign-in");
    const asked = await provider(page, via, { error: { error: "access_denied", error_description: "The user denied access" } });
    await expect(page.locator(".auth-note")).toHaveText(`Sign in with ${names[via]} was cancelled. Try again, or use your email.`);
    expect(asked).toHaveLength(1);
    const [authorize] = asked;
    expect(authorize.searchParams.get("provider")).toBe(via);
    expect(authorize.searchParams.get("redirect_to")).toBe(`${baseURL}/auth/callback?via=${via}`);
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
    // Google's own default asks for email and profile; Microsoft's needs them asked for.
    expect(authorize.searchParams.get("scopes")).toBe(via === "azure" ? "email profile" : null);
  }
  // The verifier waits in this browser only.
  expect((await page.context().cookies()).some((cookie) => cookie.name.endsWith("-auth-token-code-verifier"))).toBe(true);
});

test.describe("with no client IDs set", () => {
  // A second server from the same build, without the two client IDs.
  const port = Number(process.env.PORT || 3000) + 5;
  let server: ChildProcess;
  test.beforeAll(async () => {
    server = spawn("npx", ["next", "start", "-p", String(port)], {
      env: { ...process.env, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "", SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID: "" },
      stdio: "ignore",
    });
    for (let tries = 0; tries < 60; tries++) {
      if (await fetch(`http://127.0.0.1:${port}/sign-in`).then((response) => response.ok, () => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("The second server did not start");
  });
  test.afterAll(() => {
    server.kill();
  });

  test("the buttons stay hidden and the email code works as before", async ({ page }) => {
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(`http://127.0.0.1:${port}${path}`);
      await expect(page.getByLabel("Your work email")).toBeVisible();
      await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
      await expect(page.getByText("or use your email")).toHaveCount(0);
    }
  });
});

test("a cancel, a refusal, an unconfirmed address or an error each come back with one plain line", async ({ page }) => {
  const line = page.locator(".auth-note");
  for (const [answer, text] of [
    ["via=azure&error=access_denied&error_description=AADSTS65004%3A+User+declined+to+consent", "Sign in with Microsoft was cancelled. Try again, or use your email."],
    ["via=google&error=access_denied&error_code=provider_email_needs_verification", "Google has not confirmed this email address. Use your email instead."],
    ["via=google&error=server_error&error_description=Unable+to+exchange+external+code", "Sign in with Google did not work. Try again, or use your email."],
    ["via=azure&code=not-a-real-code", "Sign in with Microsoft did not work. Try again, or use your email."],
  ]) {
    await page.goto(`/auth/callback?${answer}`);
    await expect(page).toHaveURL(/\/sign-in\?reason=/);
    await expect(line).toHaveText(text);
  }

  // An address the provider has not confirmed is refused, even if Supabase let it through.
  const email = `unconfirmed-${tag()}@example.test`;
  const firm = await seedFirm(`Unconfirmed Firm ${tag()}`, email, appKey());
  try {
    await link(firm.ownerId, "azure", email, false);
    await page.goto("/sign-in");
    await provider(page, "azure", { user: firm.ownerId });
    await expect(line).toHaveText("Microsoft has not confirmed this email address. Use your email instead.");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await firm.remove();
  }
});

test("an account made by email signs in with Google as the same account, then the 2 step code", async ({ page }) => {
  const email = `google-${tag()}@example.test`;
  const firmName = `Google Firm ${tag()}`;
  const key = appKey();
  const firm = await seedFirm(firmName, email, key);
  try {
    await link(firm.ownerId, "google", email);
    await page.goto("/sign-in");
    await provider(page, "google", { user: firm.ownerId });
    await expect(page).toHaveURL(/\/sign-in\/two-step$/);
    await expect(page.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();
    // Firm data waits for the 2 step code, as after the email code.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\/two-step$/);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator(".rail-firm")).toContainText(firmName);
    const { data } = await admin().auth.admin.getUserById(firm.ownerId);
    expect(data.user!.identities!.map((identity) => identity.provider).sort()).toEqual(["email", "google"]);
    expect((await query(local.dbUrl, "select count(*)::int n from auth.users where email = $1", [email]))[0].n).toBe(1);
  } finally {
    await firm.remove();
  }
});

test("a new owner signs up with Google, and the email code later opens the same account", async ({ page }) => {
  const email = `new-owner-${tag()}@example.test`;
  const firmName = `Google Sign Up ${tag()}`;
  const userId = await providerUser(email, "google");
  try {
    await page.goto("/sign-up");
    await provider(page, "google", { user: userId });
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByText(`Signed in as ${email}. Now add your firm's details.`)).toBeVisible();
    await expect(page.getByLabel("Your work email")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
    await page.getByLabel("Firm name").fill(firmName);
    await page.getByLabel("State").selectOption({ label: "Gujarat" });
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Tick the box" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
    const secret = (await page.locator(".secret").textContent())!.trim();
    const first = totp(secret);
    await page.getByLabel("6 digit code from the app").fill(first);
    await page.getByRole("button", { name: "Continue" }).click();
    // Payments are on in tests: the new firm opens with its plan and payment step.
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByText(`${firmName} opens on InboxCA`)).toBeVisible();
    const rows = await query(local.dbUrl, "select f.status, f.state_code, m.role from public.firms f join public.firm_members m on m.firm_id = f.id where f.name = $1", [firmName]);
    expect(rows).toEqual([{ status: "pending", state_code: "24", role: "owner" }]);

    // The other order: the email code for the same address is the same account and firm, on the
    // same computer (a new one would wait for the owner's approval, D38).
    await page.context().clearCookies({ name: /^sb-/ });
    await emailStep(page, email);
    await expect(page.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();
    await page.getByLabel("6 digit code from the app").fill(await freshTotp(secret, first));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(`${firmName} opens on InboxCA`)).toBeVisible();
    expect(await query(local.dbUrl, "select id from auth.users where email = $1", [email])).toEqual([{ id: userId }]);
  } finally {
    await removeFirm(firmName);
    await query(local.dbUrl, "delete from auth.users where id = $1", [userId]);
  }
});

test("an invited person joins with Microsoft when the address matches the invite", async ({ page }) => {
  const firmName = `Invite Firm ${tag()}`;
  const staff = `invited-${tag()}@example.test`;
  const other = `other-${tag()}@example.test`;
  const firm = await seedFirm(firmName, `inviter-${tag()}@example.test`, appKey());
  try {
    // The owner's invite: a confirmed login for the address and a waiting place in the firm.
    const { data } = await admin().auth.admin.createUser({ email: staff, email_confirm: true });
    await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'staff', 'invited')", [firm.firmId, data.user!.id]);
    await link(data.user!.id, "azure", staff);
    await page.goto("/sign-in");
    await provider(page, "azure", { user: data.user!.id });
    await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
    const secret = (await page.locator(".secret").textContent())!.trim();
    await page.getByLabel("6 digit code from the app").fill(totp(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: `Join ${firmName}` }).click();
    await expect(page.locator(".rail-firm")).toContainText(firmName);

    // A Microsoft account with another address is someone else: no invite, so the firm's details.
    await page.context().clearCookies();
    const stranger = await providerUser(other, "azure");
    await page.goto("/sign-in");
    await provider(page, "azure", { user: stranger });
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByText(`Ask its owner to add ${other}, then sign in again.`)).toBeVisible();
    await page.getByRole("button", { name: "Use another account" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await firm.remove(staff, other);
  }
});
