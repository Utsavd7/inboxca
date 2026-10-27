import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addPerson, appKey, emailStep, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Passkeys for firm people (PLAN.md 5.17, 8.5), with a virtual authenticator in Chrome on
// localhost (passkeys need a domain, not an address). Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ timeout: 120_000 });

test("anyone in the firm adds a passkey, signs in with it in place of the 6 digit code and removes it; removing a person can take theirs", async ({ browser, baseURL }) => {
  const tag = randomUUID().slice(0, 8);
  const ownerEmail = `passkey-owner-${tag}@invented.test`, staffEmail = `passkey-staff-${tag}@invented.test`;
  const ownerKey = appKey(), staffKey = appKey();
  const firm = await seedFirm(`Invented Passkey Firm ${tag}`, ownerEmail, ownerKey);
  const context = await browser.newContext({ baseURL: baseURL!.replace("127.0.0.1", "localhost") });
  const staffContext = await browser.newContext();
  const logged = async (action: string) => query(local.dbUrl, "select actor_id, entity_id, details from public.activity_log where firm_id = $1 and action = $2 order by at", [firm.firmId, action]);
  const factors = async (person: string) => (await query(local.dbUrl, "select friendly_name from auth.mfa_factors where user_id = $1 order by friendly_name", [person])).map((row) => row.friendly_name);
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await signIn(page, ownerEmail, ownerKey);

    // The owner is asked once, in one line, until they have a passkey.
    await page.goto("/app/settings");
    await page.getByRole("link", { name: "Add a passkey" }).click();
    await expect(page).toHaveURL(/group=me/);
    const card = page.locator("section#passkeys");
    await card.getByLabel(/^Name this passkey/).fill("Office laptop");
    await card.getByRole("button", { name: "Add a passkey" }).click();
    await expect(card.getByRole("status")).toHaveText("Passkey added.");
    await expect(card.getByRole("listitem")).toHaveText(["Office laptopRemove"]);
    // One passkey per name, refused before the device makes one.
    await card.getByLabel(/^Name this passkey/).fill("Office laptop");
    await card.getByRole("button", { name: "Add a passkey" }).click();
    await expect(card.getByRole("status")).toHaveText("You already have a passkey named Office laptop. Choose another name.");
    const [saved] = await query(local.dbUrl, "select p.name, p.secret, f.friendly_name, f.status from public.passkeys p join auth.mfa_factors f on f.id = p.factor_id where p.user_id = $1", [firm.ownerId]);
    expect(saved).toMatchObject({ name: "Office laptop", status: "verified" });
    // The factor's key is kept sealed, never as the authenticator app's key.
    expect(saved.secret).not.toMatch(/^[A-Z2-7]+=*$/);
    expect(await logged("passkey.added")).toEqual([{ actor_id: firm.ownerId, entity_id: firm.ownerId, details: {} }]);

    // Signed out, the email code and then the passkey, with no 6 digit code.
    await page.locator(".rail-me").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await emailStep(page, ownerEmail);
    await expect(page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible();
    await page.getByRole("button", { name: "Use my passkey" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/clients");
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
    expect(await query(local.dbUrl, "select counter > 0 as counted from public.passkeys where user_id = $1", [firm.ownerId])).toEqual([{ counted: true }]);

    // Removed, say for a lost laptop: it stops working, this browser stays signed in, and the
    // 6 digit code still works.
    await page.goto("/app/settings?group=me");
    await card.getByRole("button", { name: "Remove the passkey Office laptop" }).click();
    await expect(card.getByRole("listitem")).toHaveCount(0);
    await page.reload();
    await expect(card.getByRole("button", { name: "Add a passkey" })).toBeVisible();
    expect(await factors(firm.ownerId)).toEqual(["Test app"]);
    expect(await logged("passkey.removed")).toEqual([{ actor_id: firm.ownerId, entity_id: firm.ownerId, details: { removed: 1 } }]);

    // Staff have Your sign in too, from the menu, and nothing else of Settings.
    const staffId = await addPerson(firm.firmId, staffEmail, "staff", staffKey);
    const staff = await staffContext.newPage();
    await signIn(staff, staffEmail, staffKey);
    await staff.locator(".rail-me").click();
    await staff.getByRole("menuitem", { name: "Your sign in" }).click();
    await expect(staff.getByRole("heading", { name: "Your sign in", level: 1 })).toBeVisible();
    await expect(staff.locator("section#passkeys").getByRole("button", { name: "Add a passkey" })).toBeVisible();
    await staff.goto("/app/settings");
    await expect(staff.getByText("This page is for the owner", { exact: true })).toBeVisible();

    // The owner removes them from the firm and their passkey with them, which ends its sign ins.
    const [{ id: factor }] = await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Passkey invented', 'totp', 'verified', 'INVENTED', now(), now()) returning id", [staffId]);
    await query(local.dbUrl, "insert into public.passkeys (id, user_id, factor_id, name, public_key, secret) values ($1, $2, $3, 'Home laptop', 'invented', 'sealed')", [`invented-${tag}`, staffId, factor]);
    await page.goto(`/app/people?person=${staffId}&confirm=remove`);
    await expect(page.getByLabel(/Also remove their passkey/)).toBeChecked();
    await page.getByRole("button", { name: "Yes, remove from the firm" }).click();
    await expect(page.getByText("Done. They can no longer sign in.")).toBeVisible();
    expect(await factors(staffId)).toEqual(["Test app"]);
    expect((await logged("passkey.removed")).at(-1)).toEqual({ actor_id: firm.ownerId, entity_id: staffId, details: { removed: 1 } });
  } finally {
    await context.close().catch(() => {});
    await staffContext.close().catch(() => {});
    await firm.remove(staffEmail);
  }
});
