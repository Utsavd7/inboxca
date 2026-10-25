import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdf } from "../tests/fixtures/pdf.ts";
import { fakeClamd } from "../tests/fixtures/fake-clamd.ts";
import { craft } from "../tests/fixtures/zip.ts";
import { intakeLimits, readFrames, signView } from "../src/lib/file-worker.ts";

// A fresh worker process, one invented 30 page PDF, and a consumer that discards each image.
// --large pads the PDF to the 50 MB file limit. --zip instead sends the worker a ZIP of 1,000
// invented files, about 500 MB unpacked, to check through the test scanner and give back.
const root = await mkdtemp(join(tmpdir(), "viewer-memory-"));
const secret = randomBytes(32).toString("hex");
const port = process.env.FILE_WORKER_PORT || "3191";
const origin = `http://127.0.0.1:${port}`;
const clamd = fakeClamd().listen(0, "127.0.0.1");
await once(clamd, "listening");
const worker = spawn(process.execPath, ["--experimental-strip-types", "worker/server.ts"], {
  env: { NODE_ENV: "test", PATH: process.env.PATH, FILE_WORKER_SECRET: secret, FILE_WORKER_PORT: port, FILE_WORKER_TEST: "1", DRIVE_LOCAL_DIR: root, CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String((clamd.address() as AddressInfo).port) }, stdio: ["ignore", "pipe", "inherit"],
});
try {
  await new Promise<void>((resolve, reject) => { worker.stdout!.once("data", () => resolve()); worker.once("error", reject); worker.once("exit", (code) => reject(new Error(`Worker stopped: ${code}`))); });
  if (process.argv.includes("--zip")) {
    const archive = craft(Array.from({ length: intakeLimits.entries }, (_, n) => ({ name: `Invented ${n + 1}.txt`, bytes: Buffer.alloc(512_000, `Invented ledger line ${n + 1}\n`) })));
    const ticket = JSON.stringify({ size: archive.length, sha256: createHash("sha256").update(archive).digest("hex"), zip: true, expires: Math.floor(Date.now() / 1000) + 60 });
    const start = performance.now();
    const response = await fetch(`${origin}/intake`, { method: "POST", body: archive, headers: { authorization: await signView(ticket, secret), "x-inboxca-intake": ticket } });
    if (!response.ok || !response.body) throw new Error("Cannot check invented ZIP");
    let frames = 0, unpacked = 0;
    for await (const frame of readFrames(response.body, intakeLimits.bytes)) { if (frames++) unpacked += frame.length; }
    const counts = await fetch(`${origin}/_reads?file=none`, { headers: { authorization: `Bearer ${secret}` } }).then((r) => r.json());
    console.log(JSON.stringify({ kind: "zip", files: frames - 1, zipBytes: archive.length, unpackedBytes: unpacked, elapsedMs: Math.round(performance.now() - start), peakRssMiB: Math.round(counts.peakRssKiB / 1024 * 10) / 10 }));
  } else {
    let bytes: Uint8Array = pdf("Invented 30 page statement", 30, process.argv.includes("--large") ? intakeLimits.bytes - 10_000 : 0);
    if (process.argv.includes("--scans")) {
      const { createCanvas } = await import("@napi-rs/canvas");
      const picture = createCanvas(1800, 2400);
      const context = picture.getContext("2d");
      context.fillStyle = "white"; context.fillRect(0, 0, 1800, 2400);
      context.fillStyle = "#17202f"; context.font = "28px sans-serif";
      for (let row = 0; row < 65; row++) context.fillText(`Invented statement row ${row + 1}, amount 1,23,456`, 50, 60 + row * 35);
      const jpeg = await picture.encode("jpeg", 85);
      const content = "q 612 0 0 792 0 0 cm /Scan Do Q";
      const objects: Buffer[] = [Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"), Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: 30 }, (_, n) => `${3 + n * 3} 0 R`).join(" ")}] /Count 30 >>`)];
      for (let n = 0; n < 30; n++) objects.push(
        Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + n * 3} 0 R /Resources << /XObject << /Scan ${5 + n * 3} 0 R >> >> >>`),
        Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
        Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 2400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]),
      );
      const parts = [Buffer.from("%PDF-1.4\n")], offsets: number[] = [];
      let offset = parts[0].length;
      objects.forEach((object, n) => { const part = Buffer.concat([Buffer.from(`${n + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); offsets.push(offset); parts.push(part); offset += part.length; });
      parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
      bytes = Buffer.concat(parts);
    }
    await writeFile(join(root, "invented.pdf"), bytes);
    const body = JSON.stringify({ firm: "invented-firm", file: "invented.pdf", name: "invented.pdf", label: "viewer@invented.test, Invented Firm, 19 Oct 2026, 15:30", limit: 30, expires: Math.floor(Date.now() / 1000) + 60, provider: "local", token: "" });
    const start = performance.now();
    const response = await fetch(`${origin}/view/invented.pdf`, { method: "POST", body, headers: { authorization: await signView(body, secret) } });
    if (!response.ok || !response.body) throw new Error("Cannot open invented PDF");
    let frames = 0, imageBytes = 0;
    for await (const frame of readFrames(response.body)) { if (frames++) imageBytes += frame.length; }
    const counts = await fetch(`${origin}/_reads?file=invented.pdf`, { headers: { authorization: `Bearer ${secret}` } }).then((r) => r.json());
    console.log(JSON.stringify({ kind: process.argv.includes("--scans") ? "scans" : process.argv.includes("--large") ? "large" : "text", pages: frames - 1, originalBytes: bytes.length, imageBytes, driveReads: counts.reads, elapsedMs: Math.round(performance.now() - start), peakRssMiB: Math.round(counts.peakRssKiB / 1024 * 10) / 10 }));
  }
} finally {
  clamd.close();
  worker.kill();
  await new Promise<void>((resolve) => { if (worker.exitCode !== null) resolve(); else worker.once("exit", () => resolve()); });
  await rm(root, { recursive: true, force: true });
}
