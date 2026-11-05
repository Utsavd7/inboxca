import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

// Report a problem or idea: the server checks every report again, whatever the panel let
// through, before anything reaches Orelu's email; a flood stops at the limit; nothing is stored.
const mocked = vi.hoisted(() => ({ member: vi.fn(), send: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" }) }));
vi.mock("@/src/lib/member", () => ({ currentMember: mocked.member }));
vi.mock("@/src/lib/system-mail", () => ({ sendSystemMail: mocked.send, systemMailReady: () => true }));
// No database but the signed in member lookup: any other use fails the test.
vi.mock("@/src/lib/supabase", () => ({ supabaseAdmin: () => { throw new Error("no database"); }, supabaseServer: () => { throw new Error("no database"); } }));
const { sendReport } = await import("@/app/(app)/app/report-actions");

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const report = (files: File[] = [], fields: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries({ kind: "broken", subject: "Upload does nothing", details: "", which: "", path: "/app/documents?client=x", screen: "1440x900", ...fields })) form.set(name, value);
  for (const file of files) form.append("files", file);
  return sendReport(form);
};
beforeEach(() => {
  vi.clearAllMocks();
  mocked.member.mockResolvedValue({ userId: randomUUID(), membership: { firmId: randomUUID(), firmName: "Invented Firm", role: "staff", name: "Neha", email: "neha@invented.test" } });
  mocked.send.mockResolvedValue(true);
});

it("refuses files that are not pictures, recordings or PDFs by their bytes, too many or too large, and a kind not offered", async () => {
  // A program named as a picture, and a HEIC picture whose box looks like an MP4's.
  const program = new File([Uint8Array.from([0x4d, 0x5a, 0x90, 0])], "shot.png", { type: "image/png" });
  const heic = new File([Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypheic")])], "clip.mp4", { type: "video/mp4" });
  for (const files of [[program], [heic]]) expect((await report(files)).error).toMatch(/not a picture/);
  expect((await report([1, 2, 3, 4].map((n) => new File([png], `${n}.png`)))).error).toMatch(/at most 3/);
  expect((await report([new File([png, new Uint8Array(10 * 1024 * 1024)], "big.png")])).error).toMatch(/10 MB/);
  expect((await report([], { kind: "spam" })).error).toBeTruthy();
  expect((await report([], { subject: "  " })).error).toBeTruthy();
  expect((await report([], { kind: "old" })).error).toMatch(/which form/);
  expect(mocked.send).not.toHaveBeenCalled();
});

it("sends a good report to Orelu with its files and the person to reply to, and stops a flood at 1 a minute and 5 a day", async () => {
  expect(await report([new File([png], "Screen shot.png")])).toEqual({});
  const [to, subject, text, firm, extra] = mocked.send.mock.calls[0];
  expect([to, subject, firm]).toEqual(["orelu.team@gmail.com", "[InboxCA] Something is broken: Upload does nothing", undefined]);
  expect(extra).toMatchObject({ replyTo: "neha@invented.test", attachments: [{ filename: "Screen shot.png", contentType: "image/png" }] });
  expect(text).toContain("Page: /app/documents\n");
  expect(text).toContain("Browser: Chrome on Mac, version 141");

  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const start = Date.now();
    expect((await report()).error).toMatch(/try again later/);
    for (let minute = 1; minute < 5; minute++) {
      vi.setSystemTime(start + minute * 61_000);
      expect(await report()).toEqual({});
    }
    vi.setSystemTime(start + 10 * 61_000);
    expect((await report()).error).toMatch(/try again later/);
    expect(mocked.send).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
  }
});
