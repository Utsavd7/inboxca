import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { askForCode, emailStep, localSupabase, query, seedFirm } from "./local-supabase";

// The limits on the sign in steps anyone can reach (PLAN.md 8.9), through the real pages. Each
// test fills its limit in the database first, as an hour of earlier tries would, so a run sends
// no more mail and uses no more of Supabase's own limits than one try.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
// One owner's limits are filled and emptied in turn, so these run one at a time.
test.describe.configure({ mode: "serial", timeout: 90_000 });

// The key src/lib/rate-limit.ts keeps for a limit, and a limit filled to its last try.
const key = (kind: string, who: string) =>
  createHmac("sha256", createHmac("sha256", local.secretKey).update("rate limit").digest()).update(`${kind}:${who.trim().toLowerCase()}`).digest("base64url");
const keys: string[] = [];
const fill = async (kind: string, who: string, hits: number) => {
  keys.push(key(kind, who));
  await query(local.dbUrl, "insert into private.rate_limits (key, hits) values ($1, $2) on conflict (key) do update set hits = $2, since = now()", [key(kind, who), hits]);
};

const tag = randomUUID().slice(0, 8);
const ownerEmail = `limits-owner-${tag}@example.test`;
let firm: Awaited<ReturnType<typeof seedFirm>>;

test.beforeAll(async () => {
  firm = await seedFirm(`Limits Firm ${tag}`, ownerEmail, "JBSWY3DPEHPK3PXP");
  // The sign in page offers a recovery code only to someone who has them; an invented one here.
  await query(local.dbUrl, "update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('recovery', jsonb_build_array('invented')) where id = $1", [firm.ownerId]);
});
test.afterAll(async () => {
  await query(local.dbUrl, "delete from private.rate_limits where key = any($1)", [keys]);
  await firm.remove();
});

test("an address that asked for 10 codes this hour gets no more, whether it has an account or not", async ({ page }) => {
  for (const email of [ownerEmail, `limits-nobody-${tag}@example.test`]) {
    await fill("code", email, 10);
    await page.goto("/sign-in");
    await page.getByLabel("Your work email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Too many codes asked for this address. Try again in an hour." })).toBeVisible();
    await expect(page.getByLabel("Code from the email")).toHaveCount(0);
  }
  await query(local.dbUrl, "delete from private.rate_limits where key = $1", [key("code", ownerEmail)]);
});

test("after 10 email codes tried for an address this hour, the next is not checked", async ({ page }) => {
  const email = `limits-guess-${tag}@example.test`;
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await fill("check", email, 10);
  await page.getByLabel("Code from the email").fill("123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Too many codes tried. Wait an hour, then ask for a new one." })).toBeVisible();
});

test("after 10 authenticator codes or 5 recovery codes tried this hour, the next is not checked", async ({ page }) => {
  await emailStep(page, ownerEmail);
  await expect(page.getByRole("heading", { name: "Enter your 2 step code" })).toBeVisible();
  await fill("twoStep", firm.ownerId, 10);
  await page.getByLabel("6 digit code from the app").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Too many tries. Wait an hour, then try again." })).toBeVisible();
  await fill("recovery", firm.ownerId, 5);
  await page.getByText("Lost your phone? Use a recovery code").click();
  await page.getByLabel("Recovery code").fill("AAAAAAAAAA");
  await page.getByRole("button", { name: "Use recovery code" }).click();
  await expect(page.locator("#recovery-error")).toHaveText("Too many tries. Wait an hour, then try again.");
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
});

test("sign up counts towards the address's codes, and makes no firm past the limit", async ({ page }) => {
  const email = `limits-signup-${tag}@example.test`;
  await fill("code", email, 10);
  await page.goto("/sign-up");
  await page.getByLabel("Firm name").fill(`Limits Sign Up ${tag}`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByLabel("State").selectOption({ label: "Maharashtra" });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Too many codes asked for this address. Try again in an hour." })).toBeVisible();
  expect(await query(local.dbUrl, "select 1 from auth.users where email = $1", [email])).toHaveLength(0);
  expect(await query(local.dbUrl, "select 1 from public.firms where name = $1", [`Limits Sign Up ${tag}`])).toHaveLength(0);
  // The address's next sign in is refused the same way.
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Too many codes asked" })).toBeVisible();
});

test("a code asked for within the limit still arrives", async ({ page }) => {
  await fill("code", ownerEmail, 9);
  const { code } = await askForCode(page, ownerEmail);
  expect(code).toMatch(/^\d{6}$/);
});
