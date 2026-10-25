import { beforeEach, expect, it, vi } from "vitest";

// The mailbox token is opened on the server only, refreshed near its end and saved only over
// the credentials it was read from, and every use and save is logged without the token.
const mock = vi.hoisted(() => ({ logs: [] as Record<string, unknown>[], updates: [] as { fields: Record<string, unknown>; expected: string }[], matched: true, tokens: vi.fn() }));
vi.mock("@/src/lib/crypto", () => ({
  serverCrypto: () => ({
    decrypt: async (_firm: string, place: string, value: string) => (place.endsWith("address") ? "office@invented.test" : value.replace(/^sealed:/, "")),
    encrypt: async (_firm: string, _place: string, value: string) => `sealed:${value}`,
  }),
}));
vi.mock("@/src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: (table: string) =>
      table === "activity_log"
        ? { insert: async (row: Record<string, unknown>) => (mock.logs.push(row), { error: null }) }
        : { update: (fields: Record<string, unknown>) => ({ eq: () => ({ eq: (_column: string, expected: string) => ({ select: async () => (mock.updates.push({ fields, expected }), { data: mock.matched ? [{ id: "mailbox" }] : [] }) }) }) }) },
  }),
}));
vi.mock("@/src/lib/mail-oauth", async (actual) => ({ ...(await actual<typeof import("@/src/lib/mail-oauth")>()), mailTokens: mock.tokens }));
vi.mock("@/src/lib/logger", () => ({ log: { warn: vi.fn() } }));
import { mailAccess } from "@/src/lib/firm-mail";

const row = (credentials: Record<string, unknown>, provider = "outlook") => ({ id: "mailbox", provider, address_enc: "sealed address", credentials_enc: `sealed:${JSON.stringify(credentials)}`, settings: { api: {} } });
beforeEach(() => {
  mock.logs = [];
  mock.updates = [];
  mock.matched = true;
  mock.tokens.mockReset();
});

it("uses a saved access token while it lasts, and logs the use without the token", async () => {
  const account = row({ refreshToken: "refresh-1", accessToken: "access-saved", expires: Date.now() + 30 * 60_000 });
  expect(await mailAccess("firm", account)).toEqual({ provider: "outlook", address: "office@invented.test", token: "access-saved", settings: {} });
  expect(mock.tokens).not.toHaveBeenCalled();
  expect(mock.logs).toEqual([{ firm_id: "firm", actor_id: null, action: "mailbox.token_read", entity_type: "account", entity_id: "mailbox", details: { provider: "outlook" } }]);
});

it("makes a new access token near the old one's end, saves Microsoft's new refresh token only over what it read, and logs both", async () => {
  mock.tokens.mockResolvedValue({ accessToken: "access-new", refreshToken: "refresh-2", expires: Date.now() + 3600_000 });
  const account = row({ refreshToken: "refresh-1", accessToken: "access-old", expires: Date.now() + 60_000 });
  const before = account.credentials_enc;
  expect(await mailAccess("firm", account)).toMatchObject({ token: "access-new" });
  expect(mock.tokens).toHaveBeenCalledWith("outlook", { refreshToken: "refresh-1" }, {});
  expect(mock.updates).toHaveLength(1);
  expect(mock.updates[0].expected).toBe(before);
  expect(JSON.parse(String(mock.updates[0].fields.credentials_enc).replace(/^sealed:/, ""))).toMatchObject({ refreshToken: "refresh-2", accessToken: "access-new" });
  // The caller's row now names the saved credentials, for its mail_health checks.
  expect(account.credentials_enc).toBe(mock.updates[0].fields.credentials_enc);
  expect(mock.logs.map((log) => log.action)).toEqual(["mailbox.token_read", "mailbox.token_saved"]);
  expect(JSON.stringify(mock.logs)).not.toMatch(/access-|refresh-/);
});

it("never saves over a reconnect made meanwhile", async () => {
  mock.matched = false;
  mock.tokens.mockResolvedValue({ accessToken: "access-new", expires: Date.now() + 3600_000 });
  const account = row({ refreshToken: "refresh-1" }, "gmail");
  const before = account.credentials_enc;
  expect(await mailAccess("firm", account)).toMatchObject({ provider: "gmail", token: "access-new" });
  expect(account.credentials_enc).toBe(before);
  expect(mock.logs.map((log) => log.action)).toEqual(["mailbox.token_read"]);
});

it("turns a refused refresh token into a refused sign in, and an unreachable provider into a wait", async () => {
  mock.tokens.mockRejectedValueOnce(Object.assign(new Error("refused"), { code: "EAUTH" })).mockRejectedValueOnce(new Error("offline"));
  expect(await mailAccess("firm", row({ refreshToken: "refresh-1" }, "zoho"))).toEqual({ error: "sign_in" });
  expect(await mailAccess("firm", row({ refreshToken: "refresh-1" }, "zoho"))).toEqual({ error: "server" });
  expect(mock.updates).toEqual([]);
});

it("opens an IMAP mailbox with its password, as before", async () => {
  expect(await mailAccess("firm", { ...row({ password: "invented" }, "imap"), settings: { imap: { host: "imap.invented.test", port: 993 } } })).toMatchObject({ provider: "imap", password: "invented", settings: { imap: { host: "imap.invented.test" } } });
  expect(mock.logs).toEqual([]);
});
