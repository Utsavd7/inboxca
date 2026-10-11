import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
const output = process.env.AUDIT_OUTPUT || join(tmpdir(), "inboxca-review");
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:3000";
await mkdir(join(output, "screenshots"), { recursive: true });
const browser = await chromium.launch({
  headless: process.env.HEADED !== "true",
});
const results = [];
try {
  for (const width of [390, 768, 1280, 1920])
    for (const motion of ["no-preference", "reduce"]) {
      const height = width < 600 ? 844 : width < 1000 ? 1024 : 1000;
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: motion,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      let jsBytes = 0;
      const responses = [];
      page.on("response", (response) => {
        if (/\.js(?:\?|$)/.test(response.url())) responses.push(response);
      });
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(output, `screenshots/${width}-${motion}-top.png`),
      });
      await page
        .locator("#control")
        .evaluate((el) =>
          el.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      await page.waitForTimeout(900);
      await page.screenshot({
        path: join(output, `screenshots/${width}-${motion}-control.png`),
        animations: "disabled",
      });
      await page.locator("#invite").scrollIntoViewIfNeeded();
      await page.evaluate(() =>
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "instant",
        }),
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.screenshot({
        path: join(output, `screenshots/${width}-${motion}-bottom.png`),
        animations: "disabled",
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      for (const response of responses) {
        try {
          jsBytes += gzipSync(await response.body()).length;
        } catch {}
      }
      results.push({
        width,
        motion,
        overflow,
        errors,
        jsGzipBytes: jsBytes,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
      await context.close();
    }
  await writeFile(
    join(output, "browser-audit.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
