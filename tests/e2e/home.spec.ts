import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { inviteMailto } from "../../src/lib/submit-invite";

test("the private page has no live product routes or tracking", async ({
  page,
}) => {
  const remote: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:3000"))
      remote.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Less chasing for your CA firm. More doing.",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    page.getByText("In development. First firms by invitation."),
  ).toBeVisible();
  expect(await page.context().cookies()).toEqual([]);
  expect(remote).toEqual([]);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    0,
  );
});

test("invite validation focuses the error and never claims delivery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open email draft" }).click();
  await expect(page.getByLabel("Your name", { exact: true })).toBeFocused();
  await expect(
    page.getByText("Enter your name.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Sample CA");
  await page.getByLabel("Firm name", { exact: true }).fill("Sample Firm");
  await page.getByLabel("City", { exact: true }).fill("Mumbai");
  await page.getByLabel("Email", { exact: true }).fill("sample@example.com");
  await page.getByLabel("Number of clients, roughly").selectOption("Up to 70");
  await page.getByRole("button", { name: "Open email draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No email has been sent by this page.",
  );
  await expect(
    page.getByRole("link", { name: "Open the draft again" }),
  ).toHaveAttribute("href", /mailto:orelu.team@gmail.com/);
});

test("the invite draft has readable answers and safe encoding", () => {
  const url = inviteMailto({
    name: "Sample CA",
    firm: "A & B",
    city: "Mumbai",
    email: "sample@example.com",
    clients: "Not sure",
  });
  const body = decodeURIComponent(url.split("&body=")[1]);
  expect(body).toContain("\nFirm name: A & B\nCity: Mumbai");
  expect(url).toContain("A%20%26%20B");
});

test("film loads on request, closes with Escape and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("video")).toHaveCount(0);
  const button = page.getByRole("button", { name: "Watch the 30 second film" });
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("controls", "");
  expect(
    await page.locator("video").evaluate((el: HTMLVideoElement) => el.paused),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("questions work with keyboard and reduced motion shows the final mock", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const question = page
    .locator("summary")
    .filter({ hasText: "Does InboxCA file returns?" });
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(question.locator("..")).toHaveAttribute("open", "");
  await expect(
    page.getByText("No. InboxCA prepares forms", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".hero-mock")).toHaveClass(/is-done/);
  await expect(
    page.getByRole("button", { name: "Pause inbox illustration" }),
  ).toBeDisabled();
});

test("phone navigation and accessible page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Questions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#questions/);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("invite links open the form and return focus on close", async ({
  page,
}) => {
  await page.goto("/");
  const link = page
    .getByRole("link", { name: "Ask for an invite", exact: true })
    .first();
  await link.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Your name", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
});

test("the pinned screen follows the story and its progress buttons work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .locator(".lazy-story")
    .evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  const third = page.locator("[data-step='2']");
  await expect(third).toBeVisible();
  await third.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect(page.locator(".story-rail")).toContainText("03 / 05");
  await expect(page.locator(".story-pinned")).toContainText(
    "Here is your ITR acknowledgement",
  );
  await page
    .getByRole("button", {
      name: "Keeps forms ready for your approval.",
      exact: true,
    })
    .click();
  await expect(page.locator(".story-rail")).toContainText("05 / 05");
  await expect(page.locator(".story-pinned")).toContainText(
    "Ready for your team to check",
  );
  await page
    .getByRole("button", { name: "Try the approval illustration" })
    .click();
  await expect(
    page.getByRole("button", { name: "Approved in this illustration" }),
  ).toBeVisible();
});
