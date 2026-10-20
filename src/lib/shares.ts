import { createHash, randomBytes, randomUUID } from "node:crypto";
import { serverCrypto } from "./crypto";
import { paperPolicy, type RecordsSettings } from "./records";
import { firmMailer } from "./firm-mail";
import { supabaseAdmin } from "./supabase";

// Sends a filed document as a secure link (PLAN.md 5.10, 8.6): a link that works for 7 days
// and 5 downloads, emailed from the firm's own mailbox, as a reply when it answers an email.
// Only a hash remains after delivery; its token is encrypted while a send may need to resume.
// An existing waiting send is completed; otherwise
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
  const id = share.waitingId ?? randomUUID();
  const [{ data: document, error: documentError }, { data: firm, error: firmError }, { data: existing, error: existingError }] = await Promise.all([
    admin.from("documents").select("client_id,document_type,share_policy,status").eq("firm_id",share.firmId).eq("id",share.documentId).maybeSingle(),
    admin.from("firms").select("settings").eq("id",share.firmId).single(),
    admin.from("shares").select("firm_id,document_id,status,delivery").eq("id",id).maybeSingle(),
  ]);
  if (documentError || firmError || existingError) throw new Error("share_not_read");
  const policy = document && paperPolicy(document, (firm?.settings as { records?: RecordsSettings })?.records);
  if (!document || document.status !== "filed" || policy === "internal" || existing?.status === "refused") return false;
  if (existing && (existing.firm_id !== share.firmId || existing.document_id !== share.documentId)) return false;
  if (share.contactId) {
    const {data: allowed,error}=await admin.from("contact_clients").select("contact_id").eq("firm_id",share.firmId).eq("client_id",document.client_id).eq("contact_id",share.contactId).eq("can_receive_documents",true).maybeSingle();
    if (error) throw new Error("recipient_not_read");
    if (!allowed) return false;
  }
  share.needsCode ||= policy === "approval";
  const delivery = existing?.delivery as { state: "sending" | "sent"; link_enc?: string; until?: string } | null;
  const messageId = `<share-${id}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
  if (delivery?.state === "sent") return true;
  const crypto = serverCrypto();
  const token = delivery?.link_enc ? await crypto.decrypt(share.firmId, `shares/${id}/link`, delivery.link_enc) : randomBytes(32).toString("base64url");
  const finish = async () => {
    const { error } = await admin.rpc("finish_share", {share_id:id});
    if (error) throw new Error("share_not_saved");
  };
  // A previous attempt may have reached SMTP before the worker stopped.
  if (delivery?.state === "sending" && await mailer.sentAlready(messageId)) { await finish(); return true; }
  if (delivery?.until && Date.parse(delivery.until)>Date.now()) return false;
  const fields = {
    status: "waiting",
    needs_code: !!share.needsCode,
    delivery: { state: "sending", until: new Date(Date.now()+120_000).toISOString(), link_enc: await crypto.encrypt(share.firmId, `shares/${id}/link`, token) },
    link_token_hash: createHash("sha256").update(token).digest("hex"),
    link_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  let update = admin.from("shares").update(fields).eq("id",id).eq("status",existing?.status ?? "waiting");
  update = existing?.delivery ? update.eq("delivery",JSON.stringify(existing.delivery)) : update.is("delivery",null);
  const saved = existing ? await update.select("id").maybeSingle()
    : await admin.from("shares").insert({id,firm_id:share.firmId,document_id:share.documentId,contact_id:share.contactId,email_event_id:share.emailEventId ?? null,...fields}).select("id").single();
  if (saved.error) throw new Error("share_not_saved");
  if (!saved.data) return false;
  const link = `${process.env.APP_BASE_URL ?? ""}/s/${token}`;
  const sent = await mailer.send(
    share.to,
    share.inReplyTo ? `Re: your request for ${share.documentName}` : share.documentName,
    [`Dear ${share.clientName},`, "", `${share.firmName} has shared ${share.documentName} with you.`, "", `Download it here: ${link}`, share.needsCode ? "It is private: the page emails a one-time code to this address before it opens. The link works for 7 days and up to 5 downloads." : "The link works for 7 days and up to 5 downloads.", "", share.firmName].join("\n"),
    messageId,
    share.inReplyTo,
  );
  if (!sent) return false;
  await finish();
  return true;
}
