import { providerUrl } from "./mail-api.ts";
import { mailApis, type ApiSettings, type MailApi } from "./mail-view.ts";

// Signing in to the firm's mailbox with Google, Microsoft or Zoho (PLAN.md 5.13, 8.7): the
// authorisation code flow with PKCE, asking only to read mail and send as the firm's
// address. Each stays off until its app is registered and its keys are set (PLAN.md 10,
// 13.2); Google's only once Google has verified the app.
const apps: Record<MailApi, { id: string; secret: string; authorize: string; token: string; revoke?: string; scope: string; extra: Record<string, string> }> = {
  gmail: {
    id: "GOOGLE_OAUTH_CLIENT_ID",
    secret: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    extra: { access_type: "offline", prompt: "consent" },
  },
  // Work and personal accounts. A firm whose admin keeps app consent to itself allows InboxCA
  // once for everyone (adminConsent below). Microsoft has no way to take back one app's
  // token, so disconnecting deletes it and the owner can remove InboxCA in their account.
  outlook: {
    id: "MICROSOFT_CLIENT_ID",
    secret: "MICROSOFT_CLIENT_SECRET",
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Mail.Read Mail.Send",
    extra: { prompt: "select_account" },
  },
  // India's data centre, unless Zoho's answer names the account's own (zohoServer).
  zoho: {
    id: "ZOHO_CLIENT_ID",
    secret: "ZOHO_CLIENT_SECRET",
    authorize: "https://accounts.zoho.in/oauth/v2/auth",
    token: "/oauth/v2/token",
    revoke: "/oauth/v2/token/revoke",
    scope: "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE",
    extra: { access_type: "offline", prompt: "consent" },
  },
};
const ZOHO_INDIA = "https://accounts.zoho.in";
const zohoServers = ["accounts.zoho.in", "accounts.zoho.com", "accounts.zoho.eu", "accounts.zoho.com.au", "accounts.zoho.jp", "accounts.zoho.sa", "accounts.zohocloud.ca"];

// Holds the PKCE verifier, the state and the provider between Connect and the callback.
export const MAIL_COOKIE = "inboxca_mail_connect";
export const isMailApi =(value: unknown): value is MailApi => mailApis.includes(value as MailApi);
export const mailSignInReady = (provider: MailApi) => !!process.env[apps[provider].id] && !!process.env[apps[provider].secret];
export const signInNames: Record<MailApi, string> = { gmail: "Google", outlook: "Microsoft", zoho: "Zoho" };
// One plain line for Settings naming the sign ins not set up yet, or null when all are.
export function signInNotReady() {
  const off = mailApis.filter((provider) => !mailSignInReady(provider)).map((provider) => signInNames[provider]);
  return off.length ? `Sign in with ${off.join(", ").replace(/, ([^,]+)$/, " or $1")} is not ready yet. Use the firm email address and an app password below.` : null;
}

const address = (base: string, values: Record<string, string>) => {
  const url = new URL(providerUrl(base));
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
};

export const mailSignIn = (provider: MailApi, state: string, challenge: string, redirectUri: string) =>
  address(apps[provider].authorize, { client_id: process.env[apps[provider].id] ?? "", response_type: "code", redirect_uri: redirectUri, scope: apps[provider].scope, state, code_challenge: challenge, code_challenge_method: "S256", ...apps[provider].extra });

// Microsoft 365: the firm's admin allows InboxCA for the whole firm at once.
export const adminConsent = (state: string, redirectUri: string) =>
  address("https://login.microsoftonline.com/organizations/v2.0/adminconsent", {
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    scope: ["User.Read", "Mail.Read", "Mail.Send"].map((scope) => `https://graph.microsoft.com/${scope}`).join(" "),
    redirect_uri: redirectUri,
    state,
  });

// The Zoho data centre Zoho's answer names, only if it is one of Zoho's own, and its mail API.
export function zohoServer(named: string | null) {
  try {
    const url = new URL(named ?? "");
    return url.protocol === "https:" && zohoServers.includes(url.hostname) ? url.origin : ZOHO_INDIA;
  } catch {
    return ZOHO_INDIA;
  }
}
export const zohoMail = (server: string) => server.replace("://accounts.", "://mail.");

// A code, or the saved refresh token, exchanged for a short access token (and, for a code,
// the refresh token). A refused one throws with code EAUTH, as a refused password does.
export async function mailTokens(provider: MailApi, grant: { code: string; verifier: string; redirectUri: string } | { refreshToken: string }, settings: ApiSettings = {}) {
  const app = apps[provider];
  const response = await fetch(providerUrl(provider === "zoho" ? `${settings.server ?? ZOHO_INDIA}${app.token}` : app.token), {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env[app.id] ?? "",
      client_secret: process.env[app.secret] ?? "",
      ...("code" in grant ? { grant_type: "authorization_code", code: grant.code, code_verifier: grant.verifier, redirect_uri: grant.redirectUri } : { grant_type: "refresh_token", refresh_token: grant.refreshToken }),
      ...(provider === "outlook" && { scope: app.scope }),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const answer = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!answer.access_token) throw Object.assign(new Error("mail_token_refused"), { code: response.status < 500 && answer.error ? "EAUTH" : "ESERVER" });
  return { accessToken: answer.access_token, refreshToken: answer.refresh_token, expires: Date.now() + (answer.expires_in ?? 3600) * 1000 };
}

// Takes InboxCA's access back at the provider, where it can be. Says whether it did.
export async function revokeMailToken(provider: MailApi, refreshToken: string, settings: ApiSettings = {}) {
  const revoke = apps[provider].revoke;
  if (!revoke) return false;
  const url = `${provider === "zoho" ? settings.server ?? ZOHO_INDIA : ""}${revoke}?token=${encodeURIComponent(refreshToken)}`;
  return fetch(providerUrl(url), { method: "POST", signal: AbortSignal.timeout(10_000), cache: "no-store" }).then((response) => response.ok, () => false);
}
