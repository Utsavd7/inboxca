import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pkce } from "@/src/lib/dropbox";
import { apiAccount, foundInSent, listMail, readAttachments, readNewMail, readThread, sendMail, type ApiMailbox } from "@/src/lib/mail-api";
import { adminConsent, mailSignIn, mailSignInReady, mailTokens, revokeMailToken, signInNotReady, zohoMail, zohoServer } from "@/src/lib/mail-oauth";
import { signMail, verifyMail, type MailApi } from "@/src/lib/mail-view";
import type { NewMail } from "@/src/lib/mailbox";
import { fakeKeyValues, fakeMail } from "../fake-mail";

// Each provider's sign in and mailbox, end to end against the fake Google, Microsoft and
// Zoho in tests/fake-mail.ts, answered in memory: no network.
const fake = fakeMail();
const office = "office@invented.test";
const client = "meera@patel.test";
beforeAll(() => {
  vi.stubEnv("MAIL_ALLOW_LOCAL", "1");
  vi.stubEnv("MAIL_API_TEST_URL", "http://fake");
  for (const [key, value] of Object.entries(fakeKeyValues)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", fake.fetch);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const back = (provider: MailApi) => `http://127.0.0.1:8600/api/oauth/${provider}/callback`;
async function connect(provider: MailApi) {
  const { verifier, challenge } = pkce();
  const page = await fetch(mailSignIn(provider, "state-1", challenge, back(provider)), { redirect: "manual" });
  const answer = new URL(page.headers.get("location") ?? "");
  expect(answer.searchParams.get("state")).toBe("state-1");
  const server = provider === "zoho" ? zohoServer(answer.searchParams.get("accounts-server")) : undefined;
  const tokens = await mailTokens(provider, { code: answer.searchParams.get("code") ?? "", verifier, redirectUri: back(provider) }, { server });
  const found = await apiAccount(provider, tokens.accessToken, server ? { server, domain: zohoMail(server) } : {});
  return { tokens, found, mailbox: { provider, token: tokens.accessToken, settings: found.settings } as ApiMailbox };
}

describe("signing in to a mailbox", () => {
  it("sends the provider only the PKCE challenge, asks for a refresh token and the narrowest mail scopes", () => {
    const { verifier, challenge } = pkce();
    const google = new URL(mailSignIn("gmail", "s", challenge, back("gmail")));
    expect(google.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send");
    expect(google.searchParams.get("access_type")).toBe("offline");
    const microsoft = new URL(mailSignIn("outlook", "s", challenge, back("outlook")));
    expect(microsoft.searchParams.get("scope")).toBe("offline_access User.Read Mail.Read Mail.Send");
    const zoho = new URL(mailSignIn("zoho", "s", challenge, back("zoho")));
    expect(zoho.pathname).toBe("/accounts.zoho.in/oauth/v2/auth");
    for (const url of [google, microsoft, zoho]) {
      expect(url.searchParams.get("code_challenge")).toBe(challenge);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.toString()).not.toContain(verifier);
      expect(url.toString()).not.toContain("secret");
    }
    expect(new URL(adminConsent("s", back("outlook"))).searchParams.get("scope")).toBe("https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send");
  });
  it("stays off until both of a provider's keys are set, and says so in one plain line", () => {
    expect(signInNotReady()).toBeNull();
    vi.stubEnv("ZOHO_CLIENT_SECRET", "");
    expect(signInNotReady()).toBe("Sign in with Zoho is not ready yet. Use the firm email address and an app password below.");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    expect(signInNotReady()).toBe("Sign in with Google, Microsoft or Zoho is not ready yet. Use the firm email address and an app password below.");
    expect(mailSignInReady("outlook")).toBe(false);
    for (const [key, value] of Object.entries(fakeKeyValues)) vi.stubEnv(key, value);
  });
  it("uses Zoho's India data centre unless Zoho names one of its own", () => {
    expect(zohoServer(null)).toBe("https://accounts.zoho.in");
    expect(zohoServer("https://accounts.zoho.eu")).toBe("https://accounts.zoho.eu");
    for (const named of ["https://accounts.zoho.evil.test", "http://accounts.zoho.com", "https://attacker.test/accounts.zoho.in", "not a url"]) expect(zohoServer(named)).toBe("https://accounts.zoho.in");
    expect(zohoMail("https://accounts.zoho.com")).toBe("https://mail.zoho.com");
  });
  it("refuses a code without its verifier", async () => {
    const { challenge } = pkce();
    const page = await fetch(mailSignIn("gmail", "s", challenge, back("gmail")), { redirect: "manual" });
    const code = new URL(page.headers.get("location") ?? "").searchParams.get("code") ?? "";
    await expect(mailTokens("gmail", { code, verifier: "a-different-verifier", redirectUri: back("gmail") })).rejects.toMatchObject({ code: "EAUTH" });
  });
});

describe.each(["gmail", "outlook", "zoho"] as const)("a mailbox connected with %s sign in", (provider) => {
  it("reads only new mail, once; opens it for filing; lists, threads, replies and checks Sent", async () => {
    fake.reset(office);
    const old = await fake.deliver({ from: client, subject: "Before connecting", text: "Old mail" });
    old.at -= 60_000;
    const { tokens, found, mailbox } = await connect(provider);
    expect(found.address).toBe(office);
    expect(tokens.refreshToken).toBeTruthy();

    await fake.deliver({ from: "stranger@else.test", subject: "Not a client", text: "Skip me" });
    const original = await fake.deliver({ from: client, subject: "September bills", text: "Sir, attaching the bills.", messageId: "<bills-1@patel.test>", attachments: [{ filename: "bills.pdf", content: Buffer.from("%PDF invented") }] });
    const seen: string[] = [];
    const keep = async (mail: NewMail[]) => {
      seen.push(...mail.map((one) => one.from));
      return mail.filter((one) => one.from === client);
    };
    const read = await readNewMail(mailbox, found.cursor, keep);
    if ("error" in read) throw new Error(read.error);
    expect(seen.sort()).toEqual([client, "stranger@else.test"]);
    expect(read.mail).toHaveLength(1);
    const [mail] = read.mail;
    const messageId = provider === "zoho" ? `zoho:f-inbox:${original.id}:${original.thread}` : "<bills-1@patel.test>";
    expect(mail.messageId).toBe(messageId);
    expect(mail.content).toEqual({ subject: "September bills", text: "Sir, attaching the bills.", attachments: ["bills.pdf"] });
    const again = await readNewMail(mailbox, read.cursor, keep);
    expect(again).toMatchObject({ mail: [] });
    expect(seen).toHaveLength(2);

    const files = await readAttachments(mailbox, messageId);
    expect(files).toMatchObject({ subject: "September bills", files: [{ name: "bills.pdf", bytes: new Uint8Array(Buffer.from("%PDF invented")) }] });

    const listed = await listMail(mailbox, { inbox: [messageId], sent: null });
    expect(listed).toMatchObject({ inbox: [{ messageId, from: client, subject: "September bills", snippet: "Sir, attaching the bills." }], sent: null });
    expect(await listMail(mailbox, { inbox: [messageId], q: "bills", sent: null })).toMatchObject({ inbox: [{ messageId }] });
    expect(await listMail(mailbox, { inbox: [messageId], q: "nothing like this", sent: null })).toMatchObject({ inbox: [] });

    await sendMail(mailbox, { from: `Invented CA <${office}>`, to: client, subject: "Re: September bills", text: "Received, thank you.", messageId: "<reply-1@inboxca.test>", inReplyTo: messageId, references: [messageId], attachments: [{ filename: "receipt.txt", content: Buffer.from("receipt") }], date: new Date() });
    const [sent] = fake.mailbox.sends;
    if (provider === "zoho") expect(sent).toMatchObject({ parent: original.id, json: { action: "reply", fromAddress: office, toAddress: client, mailFormat: "plaintext", attachments: [{ attachmentName: "receipt.txt" }] } });
    else expect(sent.raw).toMatch(/In-Reply-To: <bills-1@patel\.test>/);
    if (provider === "gmail") expect(sent.json?.threadId).toBe(original.thread);

    const thread = await readThread(mailbox, { box: "inbox", messageId });
    if ("error" in thread) throw new Error(thread.error);
    expect(thread.messages.map((message) => [message.box, message.text.trim()])).toEqual([["inbox", "Sir, attaching the bills."], ["sent", "Received, thank you."]]);
    expect(thread.messages[0]).toMatchObject({ messageId, attachments: ["bills.pdf"] });
    const replyName = thread.messages[1].messageId;
    expect(replyName).toEqual(provider === "zoho" ? expect.stringMatching(/^zoho:f-sent:/) : "<reply-1@inboxca.test>");
    expect(await readThread(mailbox, { box: "sent", messageId: replyName })).toMatchObject({ messages: [{ box: "inbox" }, { box: "sent", messageId: replyName }] });

    // A send that may have happened is looked for in Sent: by the Message-ID, or by
    // InboxCA's own id where Gmail changed the Message-ID. Zoho keeps neither, so it says so.
    await sendMail(mailbox, { from: office, to: client, subject: "Reminder: sales register", text: "Please send it.", messageId: "<reminder-c1-2026-10-26@inboxca.test>" });
    const reminders = await listMail(mailbox, { inbox: [], sent: { limit: 10, reminders: true } });
    const toClient = await listMail(mailbox, { inbox: [], sent: { limit: 10, to: [client] } });
    if (provider === "zoho") {
      await expect(foundInSent(mailbox, "<reminder-c1-2026-10-26@inboxca.test>")).rejects.toThrow("sent_not_read");
      expect(reminders).toMatchObject({ sent: [] });
    } else {
      expect(await foundInSent(mailbox, "<reminder-c1-2026-10-26@inboxca.test>")).toBe(true);
      expect(await foundInSent(mailbox, "<never-sent@inboxca.test>")).toBe(false);
      expect(reminders).toMatchObject({ sent: [{ messageId: "<reminder-c1-2026-10-26@inboxca.test>", to: [client] }] });
    }
    expect(toClient).toMatchObject({ sent: [{ subject: "Reminder: sales register" }, { subject: "Re: September bills" }] });

    // The refresh token makes new access tokens until it is taken back.
    const fresh = await mailTokens(provider, { refreshToken: tokens.refreshToken! }, found.settings);
    expect(fresh.accessToken).not.toBe(tokens.accessToken);
    expect(!!fresh.refreshToken).toBe(provider === "outlook");
    expect(await revokeMailToken(provider, tokens.refreshToken!, found.settings)).toBe(provider !== "outlook");
    if (provider !== "outlook") {
      expect(fake.mailbox.revoked).toEqual([tokens.refreshToken]);
      await expect(mailTokens(provider, { refreshToken: tokens.refreshToken! }, found.settings)).rejects.toMatchObject({ code: "EAUTH" });
    }
    fake.forget();
    expect(await readNewMail(mailbox, read.cursor, keep)).toEqual({ error: "sign_in" });
    expect(await readThread(mailbox, { box: "inbox", messageId })).toEqual({ error: "sign_in" });
  });
});

it("accepts a signed live read with an access token instead of a password, in bounds", async () => {
  const secret = "invented-worker-test-secret";
  const body = (change: Record<string, unknown> = {}) =>
    JSON.stringify({ firm: "firm", expires: Math.floor(Date.now() / 1000) + 60, address: office, provider: "zoho", token: "invented-token", api: { account: "1", inbox: "2" }, op: "list", ask: { inbox: [], sent: null }, ...change });
  expect((await verifyMail(body(), await signMail(body(), secret), secret, "list")).provider).toBe("zoho");
  for (const bad of [body({ provider: "yahoo" }), body({ token: "" }), body({ api: { account: "x".repeat(300) } })]) await expect(verifyMail(bad, await signMail(bad, secret), secret, "list")).rejects.toThrow("Not allowed");
});
