import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { renderPage, tiles, viewerLabel } from "@/src/lib/viewer";
import { pdf } from "../fixtures/pdf";

// #53: every page carries the person and server time in its pixels.
it("tiles the person's identity, Indian date and time beyond every page edge", () => {
  const label = viewerLabel("viewer@firm.test", "Invented Firm", new Date("2026-10-19T10:00:00Z"));
  expect(label).toBe("viewer@firm.test, Invented Firm, 19 Oct 2026, 03:30 pm");
  const positions = tiles(1200, 1800, 500, 25);
  expect(positions.length).toBeGreaterThan(100);
  expect(Math.min(...positions.map(({ x }) => x))).toBeLessThan(-1800);
  expect(Math.max(...positions.map(({ y }) => y))).toBeGreaterThan(1800);
});

it("draws PDF text and the person's identity into PNG bytes on the server", async () => {
  const bytes = Buffer.from(pdf("Invented statement"));
  const first = await renderPage(bytes, "test.pdf", 1, "First person, 19 Oct 2026, 15:30");
  const second = await renderPage(bytes, "test.pdf", 1, "Second person, 19 Oct 2026, 15:30");
  expect(first.bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(first.bytes.equals(second.bytes)).toBe(false);
  expect(first.count).toBe(1);
  await expect(renderPage(bytes, "test.pdf", 2, "Person")).rejects.toThrow("No page");
  const image = await loadImage(first.bytes);
  expect(image.width).toBe(1200);
});

it("shows sheets as capped images and draws identity into photos too", async () => {
  const sheet = await renderPage(readFileSync("tests/fixtures/clients.xlsx"), "clients.xlsx", 1, "Person");
  expect(sheet.count).toBe(1);
  const many = await renderPage(Buffer.from(Array.from({ length: 1100 }, (_, n) => `${n},Invented client`).join("\n")), "test.csv", 25, "Person");
  expect(many).toMatchObject({ count: 25, limited: true });
  await expect(renderPage(Buffer.from("a,b"), "test.csv", 2, "Person")).rejects.toThrow("No page");
  const canvas = createCanvas(200, 200);
  canvas.getContext("2d").fillRect(0, 0, 200, 200);
  const original = canvas.toBuffer("image/png");
  const photo = await renderPage(original, "photo.png", 1, "Person");
  expect(photo.bytes.equals(original)).toBe(false);
});

it("does not decode disguised SVG files as photos", async () => {
  await expect(renderPage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>'), "photo.png", 1, "Person")).rejects.toThrow("Not a picture");
});
