import { createServer } from "node:net";

// The EICAR test string: a harmless line every virus scanner reports, made for tests.
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

// A tiny stand in for ClamAV's clamd, for tests only: it answers INSTREAM, finds the EICAR
// string and nothing else, and reads the stream as it comes without keeping it.
export function fakeClamd() {
  return createServer((socket) => {
    let pending: Buffer = Buffer.alloc(0), started = false, left = 0, tail = "", found = false;
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      if (!started) {
        const end = pending.indexOf(0);
        if (end < 0) return;
        if (pending.subarray(0, end).toString() !== "zINSTREAM") return void socket.end("UNKNOWN COMMAND\0");
        started = true;
        pending = pending.subarray(end + 1);
      }
      while (pending.length) {
        if (!left) {
          if (pending.length < 4) return;
          left = pending.readUInt32BE(0);
          pending = pending.subarray(4);
          if (!left) return void socket.end(found ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
        const part = pending.subarray(0, left);
        left -= part.length;
        pending = pending.subarray(part.length);
        const text = tail + part.toString("latin1");
        found ||= text.includes(EICAR);
        tail = text.slice(-EICAR.length);
      }
    });
  });
}

// The browser tests' file worker uses this one: node --experimental-strip-types tests/fixtures/fake-clamd.ts
if (process.argv[1]?.endsWith("fake-clamd.ts")) fakeClamd().listen(Number(process.env.CLAMD_PORT), "127.0.0.1");
