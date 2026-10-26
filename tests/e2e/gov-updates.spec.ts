import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dueLabel } from "@/src/lib/calendar";
import { firmWith, govItems, indiaToday } from "./gov-items";
import { localSupabase } from "./local-supabase";
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// New from the government (D42): a firm sees the newest item for its clients' work at the top
// of Today, with the official link, and dismisses it for good; the rest wait in the full list.
test("Today shows what is new from the government only to a firm with that work, and Dismiss sticks after a reload", async ({ browser }) => {
  test.setTimeout(90_000);
  const tag = randomBytes(4).toString("hex"), today = indiaToday();
  const older = { id: randomBytes(8).toString("hex"), source: "gst_news", area: "gst", title: `Invented advisory on GSTR-1 ${tag}`, date: "2026-10-16", link: "https://www.gst.gov.in/newsandupdates/read/1", seen: today };
  const newer = { id: randomBytes(8).toString("hex"), source: "cbic_gst", area: "gst", title: `Invented notification ${tag}`, link: "https://taxinformation.cbic.gov.in/view-pdf/1/ENG/Notifications", seen: today };
  await govItems.add([older, newer]);
  const gst = await firmWith(browser, "gstin", ["GSTR1_M"]);
  const income = await firmWith(browser, "pan", ["ITR_NA"]);
  try {
    // The newest, with the official link in a new tab, and the rest in the full list.
    await gst.page.goto("/app");
    const line = gst.page.locator(".gov-line");
    await expect(line).toContainText(`New from the government: Invented notification ${tag}. CBIC GST notifications and circulars, seen on ${dueLabel(today)}.`);
    const open = line.getByRole("link", { name: "Open" });
    await expect(open).toHaveAttribute("href", newer.link);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", /noopener/);
    await expect(line.getByRole("link", { name: /^and \d+ more$/ })).toHaveAttribute("href", "/app/government");
    await line.getByRole("button", { name: "Dismiss" }).click();
    // The dismissed line slides out as the next one comes in.
    await expect(line.filter({ hasText: `Invented notification ${tag}` })).toHaveCount(0);
    await expect(line).toContainText(`New from the government: Invented advisory on GSTR-1 ${tag}. GST portal news, 16 Oct 2026.`);
    await gst.page.reload();
    await expect(gst.page.locator(".gov-line")).toContainText(`Invented advisory on GSTR-1 ${tag}`);
    await expect(gst.page.getByText(`Invented notification ${tag}`)).toHaveCount(0);
    // The full list keeps both, the dismissed one marked.
    await gst.page.goto("/app/government");
    const rows = gst.page.getByRole("region", { name: "Last 14 days" }).locator(".app-row");
    await expect(rows.filter({ hasText: `Invented notification ${tag}` })).toContainText("Dismissed");
    await expect(rows.filter({ hasText: `Invented advisory on GSTR-1 ${tag}` }).getByRole("button", { name: "Dismiss" })).toBeVisible();

    // A firm with only income tax work sees neither, and is told which pages to look at itself.
    await income.page.goto("/app/government");
    await expect(income.page.getByRole("heading", { name: "From the government" })).toBeVisible();
    await expect(income.page.getByText(tag)).toHaveCount(0);
    await expect(income.page.getByRole("region", { name: "Pages to check yourself" }).locator(".app-row").filter({ hasText: "Income Tax Department notifications and circulars" })).toContainText("InboxCA could not check this page. Look at it yourself.");
    await income.page.goto("/app");
    await expect(income.page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await income.page.waitForLoadState("networkidle");
    await expect(income.page.getByText(tag)).toHaveCount(0);
  } finally {
    await govItems.remove([older.id, newer.id]);
    await gst.close();
    await income.close();
  }
});
