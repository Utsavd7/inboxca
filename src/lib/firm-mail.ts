import { serverCrypto } from "./crypto";
import { foundInSent, smtpTransport, type MailSettings } from "./mailbox";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

// The firm's own mailbox, opened to send plain messages, or null when none is connected
// (PLAN.md 5.2.1, 8.7). A message is written and sent in memory and never kept (D6). A
// message sent with its own Message-ID can be looked for in the Sent folder later, so a
// send that may or may not have happened is never repeated blindly.
export async function firmMailer(firmId: string, firmName: string) {
  const { data: mailbox } = await supabaseAdmin().from("connected_accounts").select("id, address_enc, credentials_enc, settings, status").eq("firm_id", firmId).eq("kind", "mail").maybeSingle();
  if (mailbox?.status !== "connected") return null;
  const crypto = serverCrypto();
  const from = await crypto.decrypt(firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firmId, `accounts/${mailbox.id}/credentials`, mailbox.credentials_enc));
  const settings = mailbox.settings as MailSettings;
  return {
    async send(to: string, subject: string, text: string, messageId?: string, inReplyTo?: string) {
      try {
        await smtpTransport(from, password, settings.smtp).sendMail({
          from: `${firmName} <${from}>`,
          to,
          subject,
          text,
          ...(messageId && { messageId }),
          ...(inReplyTo && { inReplyTo, references: inReplyTo }),
        });
        return true;
      } catch (failure) {
        log.warn("firm_mail_failed", { code: (failure as { code?: string }).code ?? "send" });
        return false;
      }
    },
    sentAlready: (messageId: string) => foundInSent(from, password, settings.imap, messageId),
  };
}
