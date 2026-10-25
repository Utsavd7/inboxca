import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], fail: "" }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (message: { to: string; subject: string; text: string }) => {
    if (message.to === mock.fail) throw new Error("refused");
    mock.sent.push(message);
  } }) },
}));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: id === "gone" ? null : { email: `${id}@invented.test` } } }) } } }),
}));
vi.mock("@/src/lib/logger", () => ({ log: { warn: vi.fn() } }));
const { mailCopy } = await import("@/src/lib/system-mail");

const message = { title: "A question for you", body: "Ravi asks to download a file.", url: "/app/inbox" };

describe("email copies of phone notifications", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mock.sent.length = 0;
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
      subject: "InboxCA: A question for you",
      text: "Ravi asks to download a file.\n\nOpen InboxCA to see it: https://app.invented.test/app/inbox\n\nThis link only opens InboxCA. Nothing changes until you sign in and choose.",
    }]);
  });
});
