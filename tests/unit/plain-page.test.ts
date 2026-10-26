import { expect, it } from "vitest";
import { plainPage } from "@/src/lib/plain-page";
import { paperType, askName } from "@/src/lib/paper-type";

it("answers a failed download with a plain page and the way back, keeping the status", async () => {
  const page = plainPage(409, "Your firm's drive is not connected.", "/app/settings?group=email&x=<y>", "Go to Settings");
  expect(page.status).toBe(409);
  expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
  const html = await page.text();
  expect(html).toContain("<h1 style=\"font-size:1.25rem\">Your firm&#39;s drive is not connected.</h1>");
  expect(html).toContain('<a href="/app/settings?group=email&#38;x=&#60;y&#62;">Go to Settings</a>');
});

it("names paper types as people read them", () => {
  expect(paperType("Document")).toBe("Other paper");
  expect(paperType("Form 130")).toBe("Form No. 130 (was Form 16)");
  expect(paperType("Sales bills")).toBe("Sales bills");
  expect(askName("Form 16")).toBe("Form 16 or Form No. 130");
});
