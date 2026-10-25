import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { serverCrypto } from "@/src/lib/crypto";
import { log } from "@/src/lib/logger";
import { apiAccount } from "@/src/lib/mail-api";
import { isMailApi, MAIL_COOKIE, mailTokens, zohoMail, zohoServer } from "@/src/lib/mail-oauth";
import { currentMember } from "@/src/lib/member";
import { requestOrigin } from "@/src/lib/origin";
import { supabaseAdmin } from "@/src/lib/supabase";

// Google, Microsoft or Zoho sends the owner back here after they allow InboxCA. The state
// must match the one set at Connect, for the provider chosen there. The code is exchanged
// on the server with the PKCE verifier, so no token reaches the browser; the refresh token
// is saved encrypted with the firm's key, and reading starts from the next new message.
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const origin = requestOrigin(request);
  const finish = (note: string) => {
    const response = NextResponse.redirect(`${origin}/app/settings?group=email&${note}#mailbox`);
    response.cookies.delete({ name: MAIL_COOKIE, path: "/api/oauth" });
    return response;
  };
  const { provider } = await params;
  const query = request.nextUrl.searchParams;
  const started = ((): { state?: string; verifier?: string; provider?: string } => {
    try {
      return JSON.parse(Buffer.from(request.cookies.get(MAIL_COOKIE)?.value ?? "", "base64url").toString() || "{}");
    } catch {
      return {};
    }
  })();
  if (!isMailApi(provider) || started.provider !== provider || !started.state || query.get("state") !== started.state) return finish("error=mail_failed");
  // Microsoft 365's admin allowed InboxCA for the whole firm; the owner connects next.
  if (provider === "outlook" && query.get("admin_consent") === "True") return finish("saved=mail_admin");
  if (query.get("error")) return finish(provider === "outlook" ? "error=mail_admin" : "error=mail_denied");
  const code = query.get("code");
  const { userId, membership } = await currentMember();
  if (!code || !started.verifier || membership?.role !== "owner" || membership.viewOnlyUntil) return finish("error=mail_failed");
  const firm = membership.firmId;
  try {
    const server = provider === "zoho" ? zohoServer(query.get("accounts-server")) : undefined;
    const tokens = await mailTokens(provider, { code, verifier: started.verifier, redirectUri: `${origin}/api/oauth/${provider}/callback` }, { server });
    const found = await apiAccount(provider, tokens.accessToken, server ? { server, domain: zohoMail(server) } : {});
    const address = found.address.trim().toLowerCase();
    if (!tokens.refreshToken || !address.includes("@") || !found.cursor || (provider === "zoho" && !(found.settings.account && found.settings.inbox && found.settings.sent))) return finish("error=mail_failed");

    // As with a password: one mailbox a firm, and a reconnect only of the same address.
    const admin = supabaseAdmin();
    const crypto = serverCrypto();
    const { data: prior, error: readError } = await admin.from("connected_accounts").select("id, provider, status, address_enc, address_bidx, sync_cursor, settings").eq("firm_id", firm).eq("kind", "mail").maybeSingle();
    if (readError) return finish("error=mail_failed");
    const index = await crypto.blindIndex(firm, "email", address);
    const priorIndex = prior && (prior.address_bidx ?? (await crypto.blindIndex(firm, "email", await crypto.decrypt(firm, `accounts/${prior.id}/address`, prior.address_enc))));
    if (prior && (prior.status !== "needs_reconnect" || priorIndex !== index)) return finish("error=mail_taken");
    const id = prior?.id ?? randomUUID();
    const fields = {
      id,
      firm_id: firm,
      kind: "mail",
      provider,
      status: "connected",
      address_enc: await crypto.encrypt(firm, `accounts/${id}/address`, address),
      address_bidx: index,
      credentials_enc: await crypto.encrypt(firm, `accounts/${id}/credentials`, JSON.stringify({ refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expires: tokens.expires })),
      // The same way in again keeps its place in the mailbox, so waiting mail is still read.
      sync_cursor: prior?.provider === provider && prior.sync_cursor ? prior.sync_cursor : found.cursor,
      settings: { ...Object.fromEntries(Object.entries((prior?.settings ?? {}) as Record<string, unknown>).filter(([key]) => !["imap", "smtp", "api"].includes(key))), api: found.settings, mail_failures: { read: 0, send: 0 } },
    };
    const { error } = prior ? await admin.from("connected_accounts").update(fields).eq("id", id) : await admin.from("connected_accounts").insert(fields);
    if (error) return finish("error=mail_failed");
    await admin.from("activity_log").insert([
      { firm_id: firm, actor_id: userId, action: prior ? "mailbox.reconnected" : "mailbox.connected", entity_type: "account", entity_id: id, details: { provider } },
      { firm_id: firm, actor_id: userId, action: "mailbox.token_saved", entity_type: "account", entity_id: id, details: { provider, why: "connect" } },
    ]);
    if (prior) await admin.from("jobs").update({ run_at: new Date().toISOString() }).eq("firm_id", firm).eq("state", "pending").in("kind", ["reminders", "bulk_send", "records_reply", "file_mail", "notice_from_mail"]);
    await admin.from("jobs").insert({ firm_id: firm, kind: "mail_poll", entity_type: "account", entity_id: id, idempotency_key: `mail_poll:${id}:${randomUUID()}` });
    runJobsSoon();
    return finish("saved=mail");
  } catch (error) {
    log.warn("mailbox.connect_failed", { provider, code: (error as { code?: string }).code ?? "connect" });
    return finish("error=mail_failed");
  }
}
