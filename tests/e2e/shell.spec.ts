import { randomBytes, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { emailStep, localSupabase, seedFirm, totp } from "./local-supabase";

// The app's frame: the theme and the folded sidebar are remembered and drawn by the server,
// the keys work everywhere, and the help, what's new and notifications panels open and close.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

test("the frame remembers the theme and the folded sidebar, and its keys and panels work", async ({ page }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const email = `shell-owner-${randomUUID()}@invented.test`;
  const firm = await seedFirm("Invented Shell Firm", email, key);
  try {
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const frame = page.locator(".ui");
    await expect(frame).toHaveAttribute("data-theme", "system");

    // Dark, from the account menu; the server draws it dark on the next load, with no flash.
    await page.locator(".rail-me").click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(frame).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(frame).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");

    // [ folds the sidebar to icons; the fold is remembered too.
    await page.keyboard.press("[");
    await expect(frame).toHaveAttribute("data-side", "rail");
    await page.reload();
    await expect(frame).toHaveAttribute("data-side", "rail");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(frame).toHaveAttribute("data-side", "full");

    // ? lists the shortcuts; G then C goes to Clients.
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/app\/clients$/);
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

    // What's new clears its dot once opened; Help answers the common questions.
    const news = page.locator(".side").getByRole("button", { name: /What's new/ });
    await expect(news.getByRole("img", { name: "New updates" })).toBeVisible();
    await news.click();
    await expect(page.getByRole("dialog", { name: "What's new" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(news.getByRole("img", { name: "New updates" })).toHaveCount(0);
    await page.locator(".topbar").getByRole("button", { name: "Help" }).click();
    const help = page.getByRole("dialog", { name: "Help" });
    await help.getByText("How do reminders work?").click();
    await expect(help.getByText(/Once a day at most, at 10:00/)).toBeVisible();
    await page.keyboard.press("Escape");

    // The status line says what is connected; the owner gets a link to fix what is not.
    await expect(page.locator(".status-bar")).toContainText("Firm email not connected");
    await expect(page.locator(".status-bar").getByRole("link", { name: "Drive not linked" })).toHaveAttribute("href", "/app/settings#drive");
  } finally {
    await firm.remove();
  }
});

test("a slow page shows the loading bar, and a slow save keeps its button busy", async ({ page }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const email = `shell-busy-${randomUUID()}@invented.test`;
  const firm = await seedFirm("Invented Busy Firm", email, key);
  try {
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // People answers only when let go: the bar shows meanwhile, and is gone once it is in.
    const held: (() => void)[] = [];
    let hold = true;
    await page.route(/\/app\/people/, async (route) => {
      const headers = route.request().headers();
      if (hold && headers.rsc) await new Promise<void>((resolve) => held.push(resolve));
      // Then a slow save, so its button is seen busy.
      if (headers["next-action"]) await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.locator(".side").getByRole("link", { name: "People" }).click();
    const bar = page.locator(".nav-bar");
    await expect(bar).toHaveAttribute("data-state", "run");
    await expect(bar).toHaveCSS("pointer-events", "none");
    hold = false;
    held.forEach((resolve) => resolve());
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
    await expect(bar).not.toHaveAttribute("data-state");

    // A slow save: the pressed button says so and takes no second click until it is done.
    await page.getByRole("link", { name: "Teams and branches" }).click();
    const panel = page.getByRole("dialog", { name: "Teams and branches" });
    await panel.getByLabel("New team").fill("Invented Team");
    await panel.getByRole("button", { name: "Add team" }).click();
    const busy = panel.locator('button[aria-busy="true"]');
    await expect(busy).toHaveText("Adding");
    await expect(busy).toBeDisabled();
    await expect(panel.getByText("Invented Team")).toBeVisible();
    await expect(busy).toHaveCount(0);

    // A button outside its form (Office only's Turn on sends the preset's form) is busy too, and
    // free again once the page comes back. Sent as "here" with no address seen, it is refused.
    await page.unroute(/\/app\/people/);
    await page.goto("/app/settings?group=access#office");
    await page.route(/\/app\/settings/, async (route) => {
      const body = route.request().postData();
      if (!route.request().headers()["next-action"] || !body) return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue({ postData: body.replace(/(name="[^"]*intent"\r\n\r\n)on/, "$1here") });
    });
    await page.locator("#office details.office-switch > summary").click();
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    const turnOn = page.locator('button[form="preset-form"]');
    await expect(turnOn).toHaveAttribute("aria-busy", "true");
    await expect(turnOn).toBeDisabled();
    await expect(page.getByRole("button", { name: "Use this preset" })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "could not see this connection's address" })).toBeVisible();
    await expect(turnOn).not.toHaveAttribute("aria-busy");
    await expect(turnOn).not.toHaveAttribute("disabled");
  } finally {
    await firm.remove();
  }
});

test("a search moves to its results without reloading the page, shows the bar, and works without JavaScript", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const email = `shell-find-${randomUUID()}@invented.test`;
  const firm = await seedFirm("Invented Find Firm", email, key);
  try {
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/clients");
    // A mark on the page itself: a full reload would wipe it.
    await page.evaluate(() => Object.assign(window, { kept: true }));
    const held: (() => void)[] = [];
    await page.route(/\/app\/clients\?q=/, async (route) => {
      if (route.request().headers().rsc) await new Promise<void>((resolve) => held.push(resolve));
      await route.continue();
    });
    await page.getByLabel("Find by name, email, PAN or GSTIN").fill("Invented Mehta");
    await page.getByLabel("Find by name, email, PAN or GSTIN").press("Enter");
    await expect(page.locator(".nav-bar")).toHaveAttribute("data-state", "run");
    held.forEach((resolve) => resolve());
    await expect(page).toHaveURL(/\/app\/clients\?q=Invented\+Mehta$/);
    await expect(page.locator(".nav-bar")).not.toHaveAttribute("data-state");
    await expect(page.getByLabel("Find by name, email, PAN or GSTIN")).toHaveValue("Invented Mehta");
    expect(await page.evaluate(() => "kept" in window)).toBe(true);

    // A picker applies by itself, the same way: Documents' year.
    await page.goto("/app/documents");
    await page.evaluate(() => Object.assign(window, { kept: true }));
    await page.getByLabel("Financial year").selectOption("all");
    await expect(page).toHaveURL(/\/app\/documents\?year=all$/);
    expect(await page.evaluate(() => "kept" in window)).toBe(true);

    // Without JavaScript the same forms still find, by a plain page load.
    const plain = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
    const still = await plain.newPage();
    await still.goto("/app/clients");
    await still.getByLabel("Find by name, email, PAN or GSTIN").fill("Invented Shah");
    await still.getByLabel("Find by name, email, PAN or GSTIN").press("Enter");
    await expect(still).toHaveURL(/\/app\/clients\?q=Invented\+Shah$/);
    await expect(still.getByLabel("Find by name, email, PAN or GSTIN")).toHaveValue("Invented Shah");
    await plain.close();
  } finally {
    await firm.remove();
  }
});

test("the page never slides sideways when something scrolls it", async ({ page }) => {
  const key = Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const email = `shell-side-${randomUUID()}@invented.test`;
  const firm = await seedFirm("Invented Side Firm", email, key);
  try {
    await emailStep(page, email);
    await page.getByLabel("6 digit code from the app").fill(totp(key));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    // The header's backdrop is wider than the pane, so a focused field could scroll it sideways.
    const pane = page.locator(".stage-panel");
    expect(await pane.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await pane.evaluate((el) => { el.scrollLeft = 120; });
    await expect.poll(() => pane.evaluate((el) => el.scrollLeft)).toBe(0);
  } finally {
    await firm.remove();
  }
});
