import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { latestEmail, localSupabase, query, totp } from "./local-supabase";

// Public sign up through the real pages: a plan chosen on the site, firm details and acceptance,
// the email code, the 2 step setup, then the plan and payment step with that plan.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ timeout: 90_000 });

const email = `signup-${randomUUID().slice(0, 8)}@example.test`;
const firmName = `Sign Up Firm ${randomUUID().slice(0, 8)}`;

test.afterAll(async () => {
  await query(
    local.dbUrl,
    "with gone as (select set_config('app.log_purge', 'on', true)) delete from public.firms where name = $1 and exists (select 1 from gone)",
    [firmName],
  );
  await query(local.dbUrl, "delete from auth.users where email = $1", [email]);
});

test("a new firm chooses Growth yearly on the site, signs up, signs in with the email code and reaches the app", async ({ page }) => {
  await page.goto("/");
  const plans = page.locator("#plans");
  await plans.getByRole("button", { name: /Yearly/ }).click();
  await plans.getByRole("list", { name: "Plans" }).getByRole("link", { name: "Start with Growth" }).click();
  await expect(page).toHaveURL(/\/sign-up\?plan=growth&cycle=yearly/);
  await expect(page.locator(".auth-note")).toContainText("Growth plan");
  await page.getByLabel("Firm name").fill(firmName);
  await page.getByLabel("Your work email").fill(email);
  await page.getByLabel("State").selectOption({ label: "Maharashtra" });
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Tick the box" })).toBeVisible();

  await page.getByRole("checkbox").check();
  const sent = Date.now() - 1000;
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  const { code } = await latestEmail(local.mailUrl, email, sent);
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Set up your 2 step code" })).toBeVisible();
  const secret = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6 digit code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  // Payments are on in tests, so the plan and payment step comes first, with the site's plan and
  // payment period already chosen.
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByText(`${firmName} opens on InboxCA`)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Growth" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("navigation", { name: "How often to pay" }).getByRole("link", { name: /Yearly/ })).toHaveAttribute("aria-current", "true");

  const [firm] = await query(
    local.dbUrl,
    "select f.status, f.state_code, l.details from public.firms f join public.activity_log l on l.firm_id = f.id and l.action = 'firm.signed_up' where f.name = $1",
    [firmName],
  );
  expect(firm).toEqual({ status: "pending", state_code: "27", details: { accepted: { terms: "27 Oct 2026", privacy: "27 Oct 2026", dpa: "25 Oct 2026" } } });

  // The same email can not make a second firm, and the page does not say the address has an
  // account: it moves on to the ordinary sign in code.
  await page.context().clearCookies();
  await page.goto("/sign-up");
  await page.getByLabel("Firm name").fill(`${firmName} again`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByLabel("State").selectOption({ label: "Gujarat" });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  const firms = await query(local.dbUrl, "select count(*)::int n from public.firms where name=$1", [`${firmName} again`]);
  expect(firms[0].n).toBe(0);
});
