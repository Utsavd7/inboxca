import { serverCrypto } from "./crypto";
import { foundInSent, smtpTransport, signInFailed, type MailSettings } from "./mailbox";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

export async function mailHealth(accountId:string,phase:"read"|"send",failed:boolean,expected:string) {
  const {data,error}=await supabaseAdmin().rpc("mail_health",{account_id:accountId,phase,failed,expected});
  if (error) throw new Error("mail_check_not_saved");
  return data;
}

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
  let waitUntil:Date|null=null;
  return {
    get waitUntil(){return waitUntil;},
    async send(to: string, subject: string, text: string, messageId?: string, inReplyTo?: string) {
      waitUntil=null;
      const {data,error}=await supabaseAdmin().rpc("reserve_mail_send",{account_id:mailbox.id});
      if (error) throw new Error("mail_limit_not_read");
      const slot=data as {ready:boolean;at:string};
      if (!slot.ready) { waitUntil=new Date(slot.at); return false; }
      await new Promise((resolve)=>setTimeout(resolve,Math.max(0,Date.parse(slot.at)-Date.now())));
      try {
        await smtpTransport(from, password, settings.smtp).sendMail({
          from: `${firmName} <${from}>`,
          to,
          subject,
          text,
          ...(messageId && { messageId }),
          ...(inReplyTo && { inReplyTo, references: inReplyTo }),
        });
        await mailHealth(mailbox.id,"send",false,mailbox.credentials_enc);
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
    sentAlready: (messageId: string) => foundInSent(from, password, settings.imap, messageId),
  };
}
