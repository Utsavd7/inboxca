import { createServer, type Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ status: { data: null as unknown, error: null as unknown } }));
vi.mock("@/src/lib/supabase", () => ({ supabaseAnonymous: () => ({ rpc: async () => mock.status }) }));
import { currentStatus, lateState, partStates, summary, timedState, workerState, type Incident } from "@/src/lib/status";
import { sendSystemMail, systemMailReady } from "@/src/lib/system-mail";

afterEach(() => vi.unstubAllEnvs());
const incident = (parts: Incident["parts"], level: Incident["level"], ended_at: string | null = null): Incident => ({ id: "i", title: "Invented", parts, level, updates: [], started_at: "2026-10-26T00:00:00Z", ended_at });

it("judges a part by how long its due work has waited and how fast its check answers", () => {
  expect([0, 599, 600, 3599, 3600].map((seconds) => lateState(seconds))).toEqual(["working", "working", "slow", "slow", "down"]);
  expect(lateState()).toBe("working");
  expect([timedState(true, 300), timedState(true, 2500), timedState(false, 10)]).toEqual(["working", "slow", "down"]);
});

it("makes a part worse, never better, for an open incident, and sums the page in one line", () => {
  const measured = { app: "working", mail: "slow", files: "off", reminders: "working" } as const;
  const states = partStates(measured, [incident(["mail", "reminders"], "down"), incident(["app"], "down", "2026-10-26T01:00:00Z"), incident(["mail"], "slow")]);
  expect(states).toEqual({ app: "working", mail: "down", files: "off", reminders: "down" });
  expect(partStates(measured, [incident(["files"], "slow")]).files).toBe("slow");
  expect(summary(states)).toBe("Some parts of InboxCA are down");
  expect(summary(measured)).toBe("Some parts of InboxCA are slow");
  expect(summary({ app: "working", mail: "working", files: "off", reminders: "working" })).toBe("Everything is working");
});

it("checks the file worker's health only when one is set up", async () => {
  vi.stubEnv("FILE_WORKER_URL", "");
  expect(await workerState()).toBe("off");
  vi.stubEnv("FILE_WORKER_URL", "http://worker.invented/");
  const fetcher = vi.fn(async () => new Response("Ready"));
  expect(await workerState(fetcher as unknown as typeof fetch)).toBe("working");
  expect(fetcher).toHaveBeenCalledWith("http://worker.invented/health", expect.anything());
  expect(await workerState((async () => { throw new Error("refused"); }) as unknown as typeof fetch)).toBe("down");
});

it("reads the database's waiting work and incidents, and calls every part down without the database", async () => {
  vi.stubEnv("FILE_WORKER_URL", "");
  mock.status = { data: { late: { mail: 4000, reminders: 700 }, incidents: [incident(["app"], "slow")] }, error: null };
  expect((await currentStatus()).states).toEqual({ app: "slow", mail: "down", files: "off", reminders: "slow" });
  mock.status = { data: null, error: { code: "PGRST000" } };
  expect((await currentStatus()).states).toEqual({ app: "down", mail: "down", files: "down", reminders: "down" });
});

// A small SMTP server that keeps what it is sent, in place of Amazon SES.
async function fakeSmtp() {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    let data = false, body = "";
    socket.write("220 invented ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n").filter((part, at, all) => part || at < all.length - 1)) {
        if (data) {
          if (line === ".") { data = false; received.push(body); socket.write("250 queued\r\n"); } else body += `${line}\n`;
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250 invented\r\n");
        else if (/^DATA/i.test(line)) { data = true; socket.write("354 go on\r\n"); }
        else if (/^QUIT/i.test(line)) { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { received, port: (server.address() as { port: number }).port, close: () => server.close() };
}

it("sends Orelu's system mail only once its keys are set", async () => {
  vi.stubEnv("SYSTEM_MAIL_URL", "");
  vi.stubEnv("EMAIL_FROM_DOMAIN", "orelu.invented");
  expect(systemMailReady()).toBe(false);
  expect(await sendSystemMail("owner@invented.test", "InboxCA: Invented", "Invented text")).toBe(false);
  const smtp = await fakeSmtp();
  try {
    vi.stubEnv("SYSTEM_MAIL_URL", `smtp://127.0.0.1:${smtp.port}`);
    expect(systemMailReady()).toBe(true);
    expect(await sendSystemMail("owner@invented.test", "InboxCA: Invented", "Invented text")).toBe(true);
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0]).toContain("From: InboxCA <no-reply@orelu.invented>");
    expect(smtp.received[0]).toContain("To: owner@invented.test");
    expect(smtp.received[0]).toContain("Invented text");
  } finally {
    smtp.close();
  }
});
