import { connect } from "node:net";
import { once } from "node:events";

// The virus check (PLAN.md 5.15): ClamAV's clamd, when CLAMD_HOST and CLAMD_PORT are set,
// sent the bytes with INSTREAM over TCP in 64 KB chunks without another copy. "off" when no
// scanner is set up, so a file is marked not scanned yet; a scanner that is set up but does
// not answer throws, and nothing is let through. clamd's StreamMaxLength must allow 50 MB.
export async function scan(bytes: Uint8Array, signal?: AbortSignal): Promise<"clean" | "off" | { found: string }> {
  const host = process.env.CLAMD_HOST, port = Number(process.env.CLAMD_PORT);
  if (!host || !port) return "off";
  signal?.throwIfAborted();
  const socket = connect({ host, port });
  const stop = () => socket.destroy();
  signal?.addEventListener("abort", stop, { once: true });
  socket.setTimeout(60_000, stop);
  const reply: Buffer[] = [];
  let failure: unknown;
  socket.on("data", (chunk: Buffer) => { if (reply.length < 16) reply.push(chunk); });
  socket.on("error", (error) => { failure = error; });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  try {
    await once(socket, "connect");
    const send = async (part: Uint8Array) => { if (!socket.write(part)) await once(socket, "drain"); };
    const size = (length: number) => { const prefix = Buffer.alloc(4); prefix.writeUInt32BE(length); return prefix; };
    await send(Buffer.from("zINSTREAM\0"));
    for (let at = 0; at < bytes.length; at += 65_536) {
      const part = bytes.subarray(at, at + 65_536);
      await send(size(part.length));
      await send(part);
    }
    await send(size(0));
  } catch (error) {
    // clamd may answer and close early, at a size limit say; its answer is still read below.
    failure ??= error;
    socket.destroy();
  }
  await closed;
  signal?.removeEventListener("abort", stop);
  signal?.throwIfAborted();
  const answer = Buffer.concat(reply).toString("utf8").replace(/\0+$/, "").trim();
  if (answer === "stream: OK") return "clean";
  const found = /^stream: (.+) FOUND$/.exec(answer);
  if (found) return { found: found[1].slice(0, 200) };
  throw failure ?? new Error("The scanner could not check the file");
}
