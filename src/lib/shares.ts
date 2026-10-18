import { createHash, randomBytes, randomUUID } from "node:crypto";
import { firmMailer } from "./firm-mail";
import { supabaseAdmin } from "./supabase";

// Sends a filed document as a secure link (PLAN.md 5.10, 8.6): a link that works for 7 days
// and 5 downloads, emailed from the firm's own mailbox, as a reply when it answers an email.
// Only the hash of the link's token is kept. An existing waiting send is completed; otherwise
// a new one is recorded. Says whether the email went.
export async function sendShare(share: {
  firmId: string;
  firmName: string;
  documentId: string;
  documentName: string;
  clientName: string;
  contactId: string | null;
  to: string;
  emailEventId?: string | null;
  inReplyTo?: string;
  waitingId?: string;
  // A private paper: its link opens only with a one-time code (8.6).
  needsCode?: boolean;
}) {
  const mailer = await firmMailer(share.firmId, share.firmName);
  if (!mailer) return false;
  const admin = supabaseAdmin();
  const token = randomBytes(32).toString("base64url");
  const id = share.waitingId ?? randomUUID();
  const fields = {
    status: "sent",
    needs_code: !!share.needsCode,
    link_token_hash: createHash("sha256").update(token).digest("hex"),
    link_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  if (share.waitingId) await admin.from("shares").update(fields).eq("id", id);
  else await admin.from("shares").insert({ id, firm_id: share.firmId, document_id: share.documentId, contact_id: share.contactId, email_event_id: share.emailEventId ?? null, ...fields });
  const link = `${process.env.APP_BASE_URL ?? ""}/s/${token}`;
  const sent = await mailer.send(
    share.to,
    share.inReplyTo ? `Re: your request for ${share.documentName}` : share.documentName,
    [`Dear ${share.clientName},`, "", `${share.firmName} has shared ${share.documentName} with you.`, "", `Download it here: ${link}`, share.needsCode ? "It is private: the page emails a one-time code to this address before it opens. The link works for 7 days and up to 5 downloads." : "The link works for 7 days and up to 5 downloads.", "", share.firmName].join("\n"),
    undefined,
    share.inReplyTo,
  );
  if (!sent) {
    if (share.waitingId) await admin.from("shares").update({ status: "waiting", link_token_hash: null, link_expires_at: null }).eq("id", id);
    else await admin.from("shares").delete().eq("id", id);
    return false;
  }
  await admin.from("activity_log").insert({ firm_id: share.firmId, action: "document.shared", entity_type: "document", entity_id: share.documentId, details: { share: id, reply: !!share.inReplyTo } });
  return true;
}
