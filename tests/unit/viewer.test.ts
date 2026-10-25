import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, it, vi } from "vitest";
import { pictureSize, openView, tiles } from "@/worker/render";
import { signView, viewerLabel } from "@/src/lib/file-worker";
import { handle } from "@/worker/handler";
import {stampedPdf} from "@/worker/download";

async function renderPage(bytes: Buffer, name: string, number: number, label: string) {
  const view = await openView(bytes, name, label);
  try {
    const image = await view.render(number);
    return { bytes: Buffer.from(image.subarray(1)), count: view.header.pages.length, limited: view.header.limited, ...view.header.pages[number - 1] };
  } finally { await view.dispose(); }
}
import { lockedPdf, pdf } from "../fixtures/pdf";
import { zip } from "@/src/lib/firm-download";
import { wordSource } from "@/worker/word-source";

// #53: every page carries the person and server time in its pixels.
it("tiles the person's identity, Indian date and time beyond every page edge", () => {
  const label = viewerLabel("viewer@firm.test", "Invented Firm", new Date("2026-10-19T10:00:00Z"));
  expect(label).toBe("viewer@firm.test, Invented Firm, 19 Oct 2026, 03:30 pm");
  const positions = tiles(1200, 1800, 500, 25);
  expect(positions.length).toBeGreaterThan(100);
  expect(Math.min(...positions.map(({ x }) => x))).toBeLessThan(-1800);
  expect(Math.max(...positions.map(({ y }) => y))).toBeGreaterThan(1800);
});

it("draws PDF text and the person's identity into image bytes in the file worker", async () => {
  const bytes = Buffer.from(pdf("Invented statement"));
  const first = await renderPage(bytes, "test.pdf", 1, "First person, 19 Oct 2026, 15:30");
  const second = await renderPage(bytes, "test.pdf", 1, "Second person, 19 Oct 2026, 15:30");
  expect(["89504e47", "ffd8ffe0", "ffd8ffe1"]).toContain(first.bytes.subarray(0, 4).toString("hex"));
  expect(first.bytes.equals(second.bytes)).toBe(false);
  expect(first.count).toBe(1);
  await expect(renderPage(bytes, "test.pdf", 2, "Person")).rejects.toThrow("No page");
  const image = await loadImage(first.bytes);
  expect(image.width).toBe(1200);
});

// #29, #47: other downloads contain stamped pictures, never reusable source text.
it("streams a readable PDF made only of personal page pictures",async()=>{
  const make=async(label:string)=>{
    const view=await openView(Buffer.from(pdf("Invented private report",2)),"source.pdf",label,2),parts:Buffer[]=[];
    try {for await(const part of stampedPdf(view)) parts.push(Buffer.from(part));return Buffer.concat(parts);} finally {await view.dispose();}
  };
  const first=await make("First person, 22 Oct 2026"),second=await make("Second person, 22 Oct 2026");
  expect(first.equals(second)).toBe(false);expect(first.includes(Buffer.from("Invented private report"))).toBe(false);
  const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=getDocument({data:new Uint8Array(first)});
  try {const pdf=await task.promise;expect(pdf.numPages).toBe(2);for(const page of [1,2]) expect((await(await pdf.getPage(page)).getTextContent()).items).toEqual([]);} finally {await task.destroy();}
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

it("renders a statement as source images with the person's name drawn in",async()=>{
  const bytes=Buffer.from(JSON.stringify({data:{itcsumm:{igst:123.45}}}));
  const first=await renderPage(bytes,"statement.json",1,"First person"),second=await renderPage(bytes,"statement.json",1,"Second person");
  expect(first.count).toBe(1);expect(first.bytes.equals(second.bytes)).toBe(false);
  expect((await loadImage(first.bytes)).width).toBe(1200);
});

// A picture is measured from its header before decoding: one claiming to be enormous is refused.
it("refuses a picture whose header claims more pixels than the viewer draws", async () => {
  const photo = createCanvas(30, 20);
  for (const bytes of [await photo.encode("png"), await photo.encode("jpeg"), await photo.encode("webp")]) expect(pictureSize(bytes)).toEqual({ width: 30, height: 20 });
  const huge = Buffer.from(await photo.encode("png"));
  huge.writeUInt32BE(50_000, 16);
  huge.writeUInt32BE(50_000, 20);
  await expect(renderPage(huge, "huge.png", 1, "Person")).rejects.toThrow("Not a picture this viewer shows");
});

// A PDF with a password opens only with the one a person typed; nothing is guessed.
it("opens a locked PDF only with its password, and says when it needs one", async () => {
  const bytes = Buffer.from(lockedPdf("Invented bank statement", "invented-pass"));
  await expect(openView(bytes, "statement.pdf", "Person")).rejects.toMatchObject({ name: "PasswordException" });
  await expect(openView(bytes, "statement.pdf", "Person", 30, undefined, undefined, "wrong-pass")).rejects.toMatchObject({ name: "PasswordException" });
  const view = await openView(bytes, "statement.pdf", "Person", 30, undefined, undefined, "invented-pass");
  try { expect(view.header.pages).toHaveLength(1); expect((await view.render(1))[0]).toBe(1); } finally { await view.dispose(); }
});

it("shows Word and OpenDocument letters as their words, and OpenDocument sheets as rows", async () => {
  const letter = zip([{ name: "[Content_Types].xml", text: "<Types/>" }, { name: "word/document.xml", text: `<w:document><w:body><w:p><w:r><w:t>Invented engagement letter</w:t></w:r></w:p><w:p><w:r><w:instrText> PAGE </w:instrText><w:t xml:space="preserve">Fees &amp; terms</w:t><w:tab/><w:t>${"word ".repeat(40)}</w:t></w:r></w:p></w:body></w:document>` }]);
  const source = wordSource(letter, "letter.docx");
  expect(source.lines[0]).toBe("Invented engagement letter");
  expect(source.lines[1]).toMatch(/^Fees & terms {4}word word/);
  expect(source.lines.every((line) => line.length <= 100)).toBe(true);
  expect(source.lines.join(" ")).not.toContain("PAGE");
  const page = await renderPage(letter, "letter.docx", 1, "Person");
  expect(page.count).toBe(1);
  const odt = zip([{ name: "content.xml", text: "<office:document-content><office:body><office:text><text:h>Invented certificate</text:h><text:p>Issued to <text:span>Invented Traders</text:span></text:p></office:text></office:body></office:document-content>" }]);
  expect(wordSource(odt, "certificate.odt").lines.slice(0, 2)).toEqual(["Invented certificate", "Issued to Invented Traders"]);
  const ods = zip([{ name: "content.xml", text: `<office:document-content><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Amount</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Invented Client</text:p></table:table-cell><table:table-cell office:value="1200"><text:p>1,200</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row><table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>` }]);
  expect((await renderPage(ods, "register.ods", 1, "Person")).count).toBe(1);
  await expect(openView(Buffer.from("not a letter"), "letter.docx", "Person")).rejects.toThrow();
});

it("tells the app a PDF needs its password, or that the saved one did not open it", async () => {
  const root = await mkdtemp(join(tmpdir(), "locked-worker-"));
  vi.stubEnv("DRIVE_LOCAL_DIR", root);
  vi.stubEnv("FILE_WORKER_SECRET", "invented-locked-test-secret");
  try {
    await writeFile(join(root, "locked.pdf"), lockedPdf("Invented statement", "invented-pass"));
    const open = async (password?: string) => {
      const body = JSON.stringify({ firm: "invented-firm", file: "locked.pdf", name: "locked.pdf", label: "Person", provider: "local", token: "", limit: 30, expires: Math.floor(Date.now() / 1000) + 60, ...(password && { password }) });
      const response = await handle(new Request("http://worker/view/locked.pdf", { method: "POST", body, headers: { authorization: await signView(body, "invented-locked-test-secret") } }));
      return [response.status, response.status === 423 ? await response.text() : (await response.body?.cancel(), "")];
    };
    expect(await open()).toEqual([423, "password"]);
    expect(await open("wrong-pass")).toEqual([423, "wrong"]);
    expect((await open("invented-pass"))[0]).toBe(200);
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
