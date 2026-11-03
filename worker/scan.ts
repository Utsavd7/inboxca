import { connect } from "node:net";
import { once } from "node:events";
import { scanRequired } from "../src/lib/file-worker.ts";

// The virus check (PLAN.md 5.15): ClamAV's clamd, on CLAMD_SOCKET (its unix socket) or
// CLAMD_HOST and CLAMD_PORT (TCP, on this computer only), sent the bytes with INSTREAM in 64 KB
// chunks without another copy. "off" when no scanner is set up and the check is optional, so a
// file is marked not scanned yet; where it is required, no scanner, a scanner that does not
// answer, answers late or answers anything but OK or FOUND throws, and nothing is let through.
// clamd's StreamMaxLength must allow 50 MB.
const where = () => {
  const path = process.env.CLAMD_SOCKET, host = process.env.CLAMD_HOST, port = Number(process.env.CLAMD_PORT);
  return path ? { path } : host && port ? { host, port } : null;
};
export const scannerSet = () => !!where();

async function ask(command: string, body?: Uint8Array, signal?: AbortSignal, timeout = 60_000) {
  signal?.throwIfAborted();
  const socket = connect(where()!);
  const stop = () => socket.destroy();
  signal?.addEventListener("abort", stop, { once: true });
  socket.setTimeout(timeout, stop);
  const reply: Buffer[] = [];
  let failure: unknown;
  socket.on("data", (chunk: Buffer) => { if (reply.length < 16) reply.push(chunk); });
  socket.on("error", (error) => { failure = error; });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  try {
    await once(socket, "connect");
    const send = async (part: Uint8Array) => { if (!socket.write(part)) await once(socket, "drain"); };
    const size = (length: number) => { const prefix = Buffer.alloc(4); prefix.writeUInt32BE(length); return prefix; };
    await send(Buffer.from(`z${command}\0`));
    if (body) {
      for (let at = 0; at < body.length; at += 65_536) {
        const part = body.subarray(at, at + 65_536);
        await send(size(part.length));
        await send(part);
      }
      await send(size(0));
    }
  } catch (error) {
    // clamd may answer and close early, at a size limit say; its answer is still read below.
    failure ??= error;
    socket.destroy();
  }
  await closed;
  signal?.removeEventListener("abort", stop);
  signal?.throwIfAborted();
  return { answer: Buffer.concat(reply).toString("utf8").replace(/\0+$/, "").trim(), failure };
}

export async function scan(bytes: Uint8Array, signal?: AbortSignal): Promise<"clean" | "off" | { found: string }> {
  if (!where()) {
    if (scanRequired()) throw new Error("No virus scanner is set up");
    return "off";
  }
  const { answer, failure } = await ask("INSTREAM", bytes, signal);
  if (answer === "stream: OK") return "clean";
  const found = /^stream: (.+) FOUND$/.exec(answer);
  if (found) return { found: found[1].slice(0, 200) };
  throw failure ?? new Error("The scanner could not check the file");
}

// Whether clamd answers now, for the worker's health check: PING, answered PONG within 2 seconds.
export const scannerReady = () => where() ? ask("PING", undefined, undefined, 2000).then(({ answer }) => answer === "PONG", () => false) : Promise.resolve(false);
