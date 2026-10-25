import { serverCrypto } from "./crypto";
import nodemailer from "nodemailer";
import { foundInSent, keepInSent, readAttachments, readNewMail, smtpTransport, signInFailed, type MailContent, type MailSettings, type NewMail } from "./mailbox";
import * as api from "./mail-api";
import { isMailApi, mailTokens, revokeMailToken } from "./mail-oauth";
import type { ApiSettings } from "./mail-view";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

export async function mailHealth(accountId:string,phase:"read"|"send",failed:boolean,expected:string) {
  const {data,error}=await supabaseAdmin().rpc("mail_health",{account_id:accountId,phase,failed,expected});
  if (error) throw new Error("mail_check_not_saved");
  return data;
}

type MailRow = { id: string; provider?: string | null; address_enc: string; credentials_enc: string; settings: unknown };
type Failed = { error: "sign_in" | "server" };
export type MailAccess = { provider: "imap"; address: string; password: string; settings: MailSettings } | (api.ApiMailbox & { address: string });

// Every use and save of a mailbox token is logged, never the token (PLAN.md 8.7).
async function logToken(firm: string, account: string, action: string, details: Record<string, string | boolean>, actor: string | null = null) {
  const { error } = await supabaseAdmin().from("activity_log").insert({ firm_id: firm, actor_id: actor, action, entity_type: "account", entity_id: account, details });
  if (error) throw new Error("token_log_not_saved");
}

// The mailbox's sign in, opened on the server only: its IMAP password, or for a mailbox
// connected with Google, Microsoft or Zoho sign in a short access token. A new one is made
// from the saved refresh token near the old one's end and saved encrypted, only over the
// credentials this read, so a reconnect meanwhile is never undone; the caller's row then
// names the new credentials for its mail_health checks. A refused token is a refused sign in.
export async function mailAccess(firm: string, account: MailRow): Promise<MailAccess | Failed> {
  const crypto = serverCrypto();
  const address = await crypto.decrypt(firm, `accounts/${account.id}/address`, account.address_enc);
  const saved = JSON.parse(await crypto.decrypt(firm, `accounts/${account.id}/credentials`, account.credentials_enc));
  const provider = account.provider;
  if (!isMailApi(provider)) return { provider: "imap", address, password: saved.password, settings: account.settings as MailSettings };
  const settings = (account.settings as { api?: ApiSettings }).api ?? {};
  try {
    await logToken(firm, account.id, "mailbox.token_read", { provider });
    if (saved.accessToken && saved.expires > Date.now() + 120_000) return { provider, address, token: saved.accessToken, settings };
    const fresh = await mailTokens(provider, { refreshToken: saved.refreshToken }, settings);
    const sealed = await crypto.encrypt(firm, `accounts/${account.id}/credentials`, JSON.stringify({ refreshToken: fresh.refreshToken ?? saved.refreshToken, accessToken: fresh.accessToken, expires: fresh.expires }));
    const { data: kept } = await supabaseAdmin().from("connected_accounts").update({ credentials_enc: sealed }).eq("id", account.id).eq("credentials_enc", account.credentials_enc).select("id");
    if (kept?.length) {
      account.credentials_enc = sealed;
      await logToken(firm, account.id, "mailbox.token_saved", { provider, why: "refresh" });
    }
    return { provider, address, token: fresh.accessToken, settings };
  } catch (error) {
    log.warn("mail_token_failed", { provider, code: (error as { code?: string }).code ?? "token" });
    return { error: (error as { code?: string }).code === "EAUTH" ? "sign_in" : "server" };
  }
}

// The mailbox opened for the jobs that read mail: over IMAP, or over the provider's API.
type Reader = {
  readNewMail(cursor: string | null, keep: (mail: NewMail[]) => Promise<NewMail[]>): Promise<{ cursor: string; mail: (NewMail & { content: MailContent })[] } | Failed>;
  readAttachments(messageId: string): Promise<{ subject: string; text: string; files: { name: string; bytes: Uint8Array }[] } | Failed>;
};
export async function openMail(firm: string, account: MailRow): Promise<Reader> {
  const access = await mailAccess(firm, account);
  if ("error" in access) return { readNewMail: async () => access, readAttachments: async () => access };
  if (access.provider === "imap")
    return {
      readNewMail: (cursor, keep) => readNewMail(access.address, access.password, access.settings.imap, cursor, keep),
      readAttachments: (messageId) => readAttachments(access.address, access.password, access.settings.imap, messageId),
    };
  return { readNewMail: (cursor, keep) => api.readNewMail(access, cursor, keep), readAttachments: (messageId) => api.readAttachments(access, messageId) };
}

// Disconnecting: a mailbox connected with sign in has its token taken back at the provider
// where it can be, and logged, before the row is deleted.
export async function forgetMailToken(firm: string, actor: string) {
  await (await mailTokenForget(firm, actor))?.();
}

// The same in two steps, for when the row goes before the token can be taken back (closing the
// firm deletes it): the token is read now, and taken back by calling what this returns.
export async function mailTokenForget(firm: string, actor: string) {
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firm).eq("kind", "mail").maybeSingle();
  if (!account || !isMailApi(account.provider)) return null;
  const provider = account.provider;
  await logToken(firm, account.id, "mailbox.token_read", { provider, why: "revoke" }, actor);
  const { refreshToken } = JSON.parse(await serverCrypto().decrypt(firm, `accounts/${account.id}/credentials`, account.credentials_enc));
  return async () => {
    const revoked = await revokeMailToken(provider, refreshToken, (account.settings as { api?: ApiSettings }).api);
    await logToken(firm, account.id, "mailbox.token_deleted", { provider, revoked }, actor);
  };
}

// The firm's own mailbox, opened to send plain messages, or null when none is connected
// (PLAN.md 5.2.1, 8.7). A message is written and sent in memory and never kept (D6). A
// message sent with its own Message-ID can be looked for in the Sent folder later, so a
// send that may or may not have happened is never repeated blindly.
export async function firmMailer(firmId: string, firmName: string) {
  const { data: mailbox } = await supabaseAdmin().from("connected_accounts").select("id, provider, address_enc, credentials_enc, settings, status").eq("firm_id", firmId).eq("kind", "mail").maybeSingle();
  if (mailbox?.status !== "connected") return null;
  // The sign in is opened at the first send or check, so a job that sends nothing uses no token.
  let opened: Promise<MailAccess | Failed> | null = null;
  const access = () => (opened ??= mailAccess(firmId, mailbox));
  let waitUntil:Date|null=null;
  return {
    get waitUntil(){return waitUntil;},
    // A reply from the Inbox also carries its whole References chain and attached files, and
    // a copy is put in the Sent folder when the provider does not keep one itself.
    async send(to: string, subject: string, text: string, messageId?: string, inReplyTo?: string, reply?: { references: string[]; attachments: { filename: string; content: Buffer }[] }) {
      waitUntil=null;
      const {data,error}=await supabaseAdmin().rpc("reserve_mail_send",{account_id:mailbox.id});
      if (error) throw new Error("mail_limit_not_read");
      const slot=data as {ready:boolean;at:string};
      if (!slot.ready) { waitUntil=new Date(slot.at); return false; }
      await new Promise((resolve)=>setTimeout(resolve,Math.max(0,Date.parse(slot.at)-Date.now())));
      try {
        const box = await access();
        if ("error" in box) throw Object.assign(new Error("mail_token"), { code: box.error === "sign_in" ? "EAUTH" : "ECONNECTION" });
        const message = {
          from: `${firmName} <${box.address}>`,
          to,
          subject,
          text,
          ...(messageId && { messageId }),
          ...(inReplyTo && { inReplyTo, references: inReplyTo }),
          ...(reply && { references: reply.references, attachments: reply.attachments, date: new Date() }),
        };
        if (box.provider === "imap") await smtpTransport(box.address, box.password, box.settings.smtp).sendMail(message);
        else await api.sendMail(box, message);
        await mailHealth(mailbox.id,"send",false,mailbox.credentials_enc);
        if (box.provider === "imap" && reply && messageId) {
          const copy = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message);
          await keepInSent(box.address, box.password, box.settings.imap, copy.message as Buffer, messageId);
        }
        return true;
      } catch (failure) {
        if (signInFailed(failure)) {
          await mailHealth(mailbox.id,"send",true,mailbox.credentials_enc);
          waitUntil=new Date(Date.now()+60_000);
        }
        log.warn("firm_mail_failed", { code: (failure as { code?: string }).code ?? "send" });
        return false;
      }
    },
    async sentAlready(messageId: string) {
      const box = await access();
      if ("error" in box) throw new Error("sent_not_read");
      return box.provider === "imap" ? foundInSent(box.address, box.password, box.settings.imap, messageId) : api.foundInSent(box, messageId);
    },
  };
}

// The firm's email address, for its clients' pages to show how to reach it; empty until a
// mailbox is connected.
export async function firmAddress(firmId: string) {
  const { data: mailbox } = await supabaseAdmin().from("connected_accounts").select("id, address_enc").eq("firm_id", firmId).eq("kind", "mail").maybeSingle();
  return mailbox ? serverCrypto().decrypt(firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc) : "";
}
