import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], fail: "", used: 0, held: [] as Record<string, unknown>[] }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (message: { to: string; subject: string; text: string }) => {
    if (message.to === mock.fail) throw new Error("refused");
    mock.sent.push(message);
  } }) },
}));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: id === "gone" ? null : { email: `${id}@invented.test` } } }) } },
    // The firm's emails today, with a fair use of 2 a day.
    rpc: async (_: string, { send }: { send: boolean }) => ({ data: { used: send ? ++mock.used : mock.used, most: 2 }, error: null }),
    from: () => ({ upsert: async (row: Record<string, unknown>) => (mock.held.push(row), { error: null }) }),
  }),
}));
vi.mock("@/src/lib/logger", () => ({ log: { warn: vi.fn() } }));
const { mailCopy } = await import("@/src/lib/system-mail");

const message = { title: "A permission request for you", body: "Ravi asks to download a paper.", url: "/app/inbox" };

describe("email copies of phone notifications", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mock.sent.length = 0;
    mock.held.length = 0;
    mock.used = 0;
  });

  it("are not sent while system email is not set up", async () => {
    await mailCopy(["owner"], message);
    expect(mock.sent).toEqual([]);
  });

  it("go to each person alone, with a link that only opens InboxCA", async () => {
    vi.stubEnv("SYSTEM_MAIL_URL", "smtp://127.0.0.1:2525");
    vi.stubEnv("EMAIL_FROM_DOMAIN", "invented.test");
    vi.stubEnv("APP_BASE_URL", "https://app.invented.test");
    mock.fail = "deputy@invented.test";
    await mailCopy(["deputy", "owner", "gone"], message);
    expect(mock.sent).toEqual([{
      from: "InboxCA <no-reply@invented.test>",
      to: "owner@invented.test",
      subject: "InboxCA: A permission request for you",
      text: "Ravi asks to download a paper.\n\nOpen InboxCA to see it: https://app.invented.test/app/inbox\n\nThis link only opens InboxCA. Nothing changes until you sign in and choose.",
    }]);
  });

  it("past the firm's emails for today, wait: nothing more is sent, and each person left out gets a note at 09:00 tomorrow", async () => {
    vi.stubEnv("SYSTEM_MAIL_URL", "smtp://127.0.0.1:2525");
    vi.stubEnv("EMAIL_FROM_DOMAIN", "invented.test");
    await mailCopy(["owner", "partner", "manager"], message, "firm-1");
    expect(mock.sent.map((mail) => mail.to)).toEqual(["owner@invented.test", "partner@invented.test"]);
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(mock.held).toEqual([{ firm_id: "firm-1", kind: "mail_held", entity_type: "person", entity_id: "manager", run_at: `${tomorrow}T09:00:00+05:30`, idempotency_key: `mail_held:firm-1:manager:${tomorrow}` }]);
  });
});
