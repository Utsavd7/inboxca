import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { estimate } from "../../src/lib/estimate";
import { inviteMailto, sendInvite } from "../../src/lib/submit-invite";

const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations;

test("the private page has no live product routes or tracking", async ({
  page,
  baseURL,
}) => {
  const remote: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL!)) remote.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Every client email, read, filed and answered.",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    page.getByText("In development. First firms by invitation."),
  ).toBeVisible();
  await expect(page.getByText("Utsav Doshi")).toBeVisible();
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: /Orelu website/ }),
  ).toHaveAttribute("href", "https://orelu.netlify.app/");
  await expect(page.getByText("How do I start?")).toBeVisible();
  expect(await page.context().cookies()).toEqual([]);
  expect(remote).toEqual([]);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    0,
  );
});

test("the demo steps through one email and waits for approval", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const stage = page.getByRole("tabpanel");
  await expect(stage).toContainText("Purchase bills for September");
  await page.getByRole("tab", { name: /Files the paper/ }).click();
  await expect(stage).toContainText("Saved");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("tab", { name: /Replies to the client/ }),
  ).toBeFocused();
  await expect(stage).toContainText("Sent");
  await page.getByRole("tab", { name: /Keeps the form ready/ }).click();
  await expect(stage).toContainText("Ready to check");
  await stage.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(stage).toContainText("Now your team files it on the portal.");
});

test("the demo keeps playing under the pointer and stops only on Pause", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tablist").scrollIntoViewIfNeeded();
  await page.getByRole("tabpanel").hover();
  await expect(page.getByRole("tab", { name: /Files the paper/ })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 12000 },
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("the control cards answer clicks", async ({ page }) => {
  await page.goto("/");
  const office = page.getByRole("switch");
  await office.click();
  await expect(office).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Dropbox" }).click();
  await expect(page.getByRole("button", { name: "Dropbox" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "OK, send it" }).click();
  await expect(
    page.getByRole("button", { name: "Sent to the client" }),
  ).toBeVisible();
});

test("every plan price ends in 499 and the estimate follows the answers", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const plans = page.locator("#plans");
  const prices = plans.locator(".plan-grid .plan-price .num");
  const quote = plans.locator(".quote");
  const clients = plans.getByLabel("How many clients?");
  await expect(prices).toHaveText(["₹1,499", "₹3,499", "₹7,499", "₹15,499"]);
  await expect(plans.locator(".plan.is-fit h3")).toHaveText("Growth");
  await expect(quote).toContainText("Growth");
  await expect(quote).toContainText("₹3,499");
  await clients.fill("300");
  await expect(plans.locator(".plan.is-fit h3")).toHaveText("Scale");

  // Above Enterprise the Custom price is worked out on the page.
  await clients.fill("900");
  await expect(plans.locator(".plan.is-fit")).toHaveCount(0);
  await expect(plans.locator(".plan-custom")).toHaveClass(/is-fit/);
  await expect(quote).toContainText("Custom");
  await expect(quote).toContainText("₹19,499");
  await quote.getByRole("button", { name: /Yearly/ }).click();
  await expect(quote).toContainText("₹2,14,499");
  await expect(prices).toHaveText([
    "₹16,499",
    "₹38,499",
    "₹82,499",
    "₹1,70,499",
  ]);
  await quote.getByRole("button", { name: "Monthly" }).click();
  await plans.getByRole("button", { name: "Mostly salaried" }).click();
  await expect(plans.locator(".plan.is-fit h3")).toHaveText("Growth");
  await plans.getByRole("button", { name: "One more person" }).click();
  await expect(plans.getByLabel(/How big is your team/)).toHaveValue("6");
});

test("the Custom formula matches the business plan and always ends in 499", () => {
  // Fixed plans, by returns a year.
  expect(estimate(70, "mixed", 1)).toMatchObject({ custom: false, index: 0 });
  expect(estimate(700, "mixed", 40)).toMatchObject({ custom: false, index: 3 });
  expect(estimate(3000, "salaried", 12)).toMatchObject({ index: 3 });
  expect(estimate(50, "mixed", 5)).toMatchObject({ index: 0, extraCost: 1596 });
  // Worked examples from the business plan.
  expect(estimate(900, "mixed", 8).monthly).toBe(19499);
  expect(estimate(900, "mixed", 8).yearly).toBe(214499);
  expect(estimate(1500, "mixed", 40).monthly).toBe(29499);
  expect(estimate(1000, "gst", 40).monthly).toBe(30499);
  expect(estimate(100, "mixed", 41).monthly).toBe(16499);
  expect(estimate(100, "mixed", 45).monthly).toBe(17499);
  let last = 0;
  for (let clients = 10; clients <= 6000; clients += 10) {
    const price = estimate(clients, "gst", 60);
    expect(price.monthly % 1000).toBe(499);
    expect(price.yearly % 1000).toBe(499);
    expect(price.monthly).toBeGreaterThanOrEqual(last);
    last = price.monthly;
  }
});

test("questions open one at a time with the keyboard", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#questions summary").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("InboxCA stores no email text.").last(),
  ).toBeVisible();
  await page.locator("#questions summary").nth(1).click();
  await expect(page.locator("#questions details[open]")).toHaveCount(1);
});

test("invite links open the form and return focus on close", async ({
  page,
}) => {
  // Before the page script loads, the link is a plain jump to the contact details.
  await page.goto("/", { waitUntil: "networkidle" });
  const link = page
    .getByRole("link", { name: "Ask for an invite", exact: true })
    .first();
  await link.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Your name", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
});

test("invite validation focuses the error and never claims delivery", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: "Ask for an invite", exact: true })
    .first()
    .click();
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

test("the security policy is linked, private and accessible", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("* Screens show sample data.")).toBeVisible();
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Security policy" })
    .click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Security policy",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(page.locator("#website")).toContainText("sample data");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/#how-it-works$/);
});

test("the invite request is marked sent only when the server confirms it", async () => {
  const values = {
    name: "Sample CA",
    firm: "A & B",
    city: "Mumbai",
    email: "sample@example.com",
    clients: "Not sure",
  } as const;
  let posted = "";
  const ok = (async (_url: unknown, init?: RequestInit) => {
    posted = String(init?.body);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  expect(await sendInvite("https://example.test/invite", values, ok)).toBe(true);
  expect(JSON.parse(posted)).toMatchObject({ firm: "A & B", city: "Mumbai" });
  const refused = (async () =>
    new Response("no", { status: 500 })) as typeof fetch;
  expect(await sendInvite("https://example.test/invite", values, refused)).toBe(
    false,
  );
  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  expect(await sendInvite("https://example.test/invite", values, offline)).toBe(
    false,
  );
});

test("the phone menu opens, jumps to a section and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("navigation", { name: "Menu" });
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Plans" }).click();
  await expect(page).toHaveURL(/#plans$/);
  await expect(menu).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

for (const [path, title] of [
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms"],
  ["/refunds", "Refunds and cancelling"],
] as const)
  test(`the ${title} page is linked, private and accessible`, async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: title.split(" ")[0], exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.getByText("a lawyer will review it")).toBeVisible();
    expect(await axe(page)).toEqual([]);
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

for (const [name, width, height] of [
  ["desktop", 1280, 900],
  ["phone", 390, 844],
] as const)
  test(`the ${name} page is accessible and does not scroll sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((done) => setTimeout(done, 40));
      }
    });
    // Let the last section finish fading in, or its text is measured half faded.
    await page.waitForTimeout(1000);
    expect(await axe(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  });
