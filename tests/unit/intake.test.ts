import { createHash } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { craft } from "../fixtures/zip";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { intakeLimits, readFrames, signView, unsafeFile } from "@/src/lib/file-worker";
import { checkFile } from "@/src/lib/intake";
import { zip } from "@/src/lib/firm-download";
import { handle } from "@/worker/handler";
import { scan } from "@/worker/scan";
import { Refused, unpack, zipEntries } from "@/worker/zip";
import { pdf } from "../fixtures/pdf";
import { EICAR, fakeClamd } from "../fixtures/fake-clamd";

const secret = "invented-intake-test-secret";
const clamd = fakeClamd();
let port = 0;
beforeAll(async () => { clamd.listen(0, "127.0.0.1"); await once(clamd, "listening"); port = (clamd.address() as AddressInfo).port; });
afterAll(() => { clamd.close(); });
const scanning = () => { vi.stubEnv("CLAMD_HOST", "127.0.0.1"); vi.stubEnv("CLAMD_PORT", String(port)); };

const refusal = (bytes: Buffer) => { try { zipEntries(bytes).forEach(unpack); return null; } catch (error) { return error instanceof Refused ? error.message : "other"; } };

it("refuses programs, scripts and macro files by name or by their first bytes", () => {
  const office = zip([{ name: "[Content_Types].xml", text: "<Types/>" }, { name: "word/vbaProject.bin", text: "macro" }]);
  const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64, "latin1");
  for (const [name, bytes] of [["invoice.pdf.exe", pdf("x")], ["setup.msi", pdf("x")], ["notes.js", Buffer.from("alert(1)")], ["book.xlsm", Buffer.from("x")], ["page.html", Buffer.from("<p>")],
    ["invoice.pdf", pe], ["run.pdf", Buffer.from("\x7fELF......")], ["tool.txt", Buffer.from("#!/bin/sh\nrm")], ["letter.docx", office]] as const)
    expect(unsafeFile(name, bytes), name).toBe(true);
  for (const [name, bytes] of [["invoice.pdf", pdf("Invented invoice")], ["bills.zip", zip([{ name: "a.pdf", text: "x" }])], ["register.csv", Buffer.from("MZ Traders,100")], ["sheet.xlsx", zip([{ name: "xl/workbook.xml", text: "<workbook/>" }])]] as const)
    expect(unsafeFile(name, bytes), name).toBe(false);
});

it("opens a ZIP one level deep, leaving out folders and what a computer adds by itself", () => {
  const bills = craft([{ name: "Sep/" }, { name: "Sep/bill 1.pdf", bytes: Buffer.from(pdf("Invented bill 1")) }, { name: "__MACOSX/Sep/._bill 1.pdf", bytes: Buffer.from("x") }, { name: "Sep/.DS_Store", bytes: Buffer.from("x") }, { name: "bill 2.pdf", bytes: Buffer.from(pdf("Invented bill 2")), stored: true }]);
  const entries = zipEntries(bills);
  expect(entries.map((entry) => entry.name)).toEqual(["bill 1.pdf", "bill 2.pdf"]);
  expect(Buffer.from(unpack(entries[1])).toString("latin1")).toContain("Invented bill 2");
});

it("refuses unsafe paths, links, passwords, other archives, lies and too much", () => {
  const paper = Buffer.from(pdf("Invented paper"));
  expect(refusal(craft([{ name: "../outside.pdf", bytes: paper }]))).toBe("zip");
  expect(refusal(craft([{ name: "a/../../outside.pdf", bytes: paper }]))).toBe("zip");
  expect(refusal(craft([{ name: "/etc/passwd", bytes: paper }]))).toBe("zip");
  expect(refusal(craft([{ name: "C:\\Windows\\x.pdf", bytes: paper }]))).toBe("zip");
  expect(refusal(craft([{ name: "link.pdf", bytes: Buffer.from("/etc/passwd"), mode: 0o120777 }]))).toBe("zip");
  expect(refusal(craft([{ name: "locked.pdf", bytes: paper, flags: 1 }]))).toBe("zip_password");
  expect(refusal(craft([{ name: "inner.zip", bytes: zip([{ name: "a.pdf", text: "x" }]) }]))).toBe("zip");
  expect(refusal(craft([{ name: "renamed.pdf", bytes: zip([{ name: "a.pdf", text: "x" }]) }]))).toBe("zip");
  expect(refusal(craft([{ name: "tool.exe", bytes: paper }]))).toBe("zip");
  expect(refusal(craft([{ name: "bad.pdf", bytes: paper, crc: 1 }]))).toBe("zip");
  // A zip bomb: a small entry that says 1 KB but unpacks to 100 MB is stopped at 1 KB.
  expect(refusal(craft([{ name: "bomb.pdf", bytes: Buffer.alloc(100 * 1024 * 1024), size: 1024 }]))).toBe("zip");
  // Two entries pointing at the same bytes.
  expect(refusal(craft([{ name: "a.pdf", bytes: paper }, { name: "b.pdf", bytes: paper, at: 0 }]))).toBe("zip");
  expect(refusal(craft(Array.from({ length: intakeLimits.entries + 1 }, (_, n) => ({ name: `${n}.txt`, bytes: Buffer.from("x") }))))).toBe("zip_large");
  expect(refusal(craft([{ name: "big.pdf", bytes: paper, size: intakeLimits.bytes + 1 }]))).toBe("zip_large");
  expect(refusal(craft(Array.from({ length: 11 }, (_, n) => ({ name: `${n}.pdf`, bytes: paper, size: 49 * 1024 * 1024 }))))).toBe("zip_large");
  expect(refusal(Buffer.from("PK\x03\x04 not really a zip"))).toBe("zip");
});

it("asks clamd over TCP, and says when no scanner is set up or it does not answer", async () => {
  vi.stubEnv("CLAMD_HOST", ""); vi.stubEnv("CLAMD_PORT", "");
  expect(await scan(Buffer.from(EICAR))).toBe("off");
  scanning();
  expect(await scan(Buffer.from(pdf("Invented statement")))).toBe("clean");
  // The string across the 64 KB chunks the stream is sent in.
  expect(await scan(Buffer.concat([Buffer.alloc(65_530), Buffer.from(EICAR)]))).toEqual({ found: "Eicar-Test-Signature" });
  vi.stubEnv("CLAMD_PORT", "1");
  await expect(scan(Buffer.from("x"))).rejects.toThrow();
  vi.unstubAllEnvs();
});

// The app's side against the worker's handler, as the fetch between them would carry it.
async function viaWorker<T>(run: () => Promise<T>) {
  vi.stubEnv("FILE_WORKER_URL", "http://worker"); vi.stubEnv("FILE_WORKER_SECRET", secret);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => handle(new Request(String(url), { ...init, duplex: "half" } as RequestInit)));
  try { return await run(); } finally { fetcher.mockRestore(); vi.unstubAllEnvs(); }
}
const papers = async (checked: Awaited<ReturnType<typeof checkFile>>) => {
  if ("unsafe" in checked) return checked;
  const all = [];
  for await (const paper of checked.papers) all.push([paper.name, Buffer.from(paper.bytes).toString("latin1").includes("Invented")]);
  return { scanned: checked.scanned, all };
};

it("checks each file sent in through the worker: a virus, a program, a ZIP's papers", async () => {
  const bill = Buffer.from(pdf("Invented bill"));
  expect(await papers(await checkFile({ name: "bill.pdf", bytes: bill }))).toEqual({ scanned: false, all: [["bill.pdf", true]] });
  await viaWorker(async () => {
    expect(await papers(await checkFile({ name: "bill.pdf", bytes: bill }))).toEqual({ scanned: false, all: [["bill.pdf", true]] });
    scanning();
    expect(await papers(await checkFile({ name: "bill.pdf", bytes: bill }))).toEqual({ scanned: true, all: [["bill.pdf", true]] });
    expect(await checkFile({ name: "bill.pdf", bytes: Buffer.from(`${EICAR}\n`) })).toEqual({ unsafe: "virus", found: "Eicar-Test-Signature" });
    expect(await checkFile({ name: "setup.exe", bytes: bill })).toEqual({ unsafe: "program" });
    const bills = zip([{ name: "Sep/bill 1.pdf", text: pdf("Invented bill 1") }, { name: "bill 2.pdf", text: pdf("Invented bill 2") }]);
    expect(await papers(await checkFile({ name: "Sep bills.zip", bytes: bills }))).toEqual({ scanned: true, all: [["bill 1.pdf", true], ["bill 2.pdf", true]] });
    // A ZIP filed as it is when it is not to be opened, as for a file already in the drive.
    expect(await papers(await checkFile({ name: "Sep bills.zip", bytes: bills }, false))).toEqual({ scanned: true, all: [["Sep bills.zip", false]] });
    // One deflated file with the test string makes the whole ZIP a virus; nothing in it is given.
    expect(await checkFile({ name: "bills.zip", bytes: zip([{ name: "a.pdf", text: pdf("Invented") }, { name: "b.txt", text: EICAR }]) })).toEqual({ unsafe: "virus", found: "Eicar-Test-Signature" });
    expect(await checkFile({ name: "bills.zip", bytes: craft([{ name: "../a.pdf", bytes: bill }]) })).toEqual({ unsafe: "zip" });
    expect(await checkFile({ name: "bills.zip", bytes: craft([{ name: "a.pdf", bytes: bill, flags: 1 }]) })).toEqual({ unsafe: "zip_password" });
    expect(await checkFile({ name: "big.pdf", bytes: new Uint8Array(intakeLimits.bytes + 1) })).toEqual({ unsafe: "large" });
    // A scanner that is set up but away lets nothing through.
    vi.stubEnv("CLAMD_PORT", "1");
    await expect(checkFile({ name: "bill.pdf", bytes: bill })).rejects.toThrow("scan_unavailable");
  });
});

it("takes only a signed ticket, and only the bytes it names", async () => {
  const bytes = Buffer.from(pdf("Invented"));
  const ticket = JSON.stringify({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), zip: false, expires: Math.floor(Date.now() / 1000) + 60 });
  vi.stubEnv("FILE_WORKER_SECRET", secret);
  try {
    const send = async (signature: string, body: Buffer, sent = ticket) => (await handle(new Request("http://worker/intake", { method: "POST", body: new Uint8Array(body), headers: { authorization: signature, "x-inboxca-intake": sent } }))).status;
    const signed = await signView(ticket, secret);
    expect(await send("", bytes)).toBe(403);
    expect(await send(await signView(ticket, "another-secret"), bytes)).toBe(403);
    expect(await send(signed, Buffer.from(pdf("Invente!")))).toBe(400);
    expect(await send(signed, Buffer.concat([bytes, Buffer.from("more")]))).toBe(413);
    const old = JSON.stringify({ ...JSON.parse(ticket), expires: Math.floor(Date.now() / 1000) - 1 });
    expect(await send(await signView(old, secret), bytes, old)).toBe(403);
    const response = await handle(new Request("http://worker/intake", { method: "POST", body: bytes, headers: { authorization: signed, "x-inboxca-intake": ticket } }));
    const [said] = await Array.fromAsync(readFrames(response.body!));
    expect(JSON.parse(new TextDecoder().decode(said))).toEqual({ scanned: false });
  } finally { vi.unstubAllEnvs(); }
});
