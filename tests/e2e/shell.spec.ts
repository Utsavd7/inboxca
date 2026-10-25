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
