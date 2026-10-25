import { emailTemplates, TEMPLATE_VERSION } from "@/src/lib/email-templates";
import type { Json } from "@/src/db/types";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, folderFor, gstinFor, periodName, placeUnderFreeName, receivedLabel, settleVersions } from "@/src/lib/documents";
import type { FolderOrder, Naming } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { firmMailer, mailHealth, openMail } from "@/src/lib/firm-mail";
import { receive } from "@/src/lib/intake";
import type { NoticeDetails } from "@/src/lib/notices";
import { supabaseAdmin } from "@/src/lib/supabase";
import { queueRead } from "./read-document";
import { queueSales } from "./read-sales";
import type { Handler } from "./runner";

// Files a client email's attachments into the client's folder in the firm's drive
// (PLAN.md 5.5.0, D24, D36): Financial year / Client / Work type, named Client - Type -
// Period. A file goes under To check for a person to confirm when the rules could not tell
// its type or period, or when the client already has the same file. One of the same type,
// period and GSTIN as a filed one becomes current, the older kept as an earlier version. A
// retry skips files already filed from this email, by checksum.
export const fileMail: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, contact_id, provider_message_id, received_at, label, delivery, clients(name, email_enc), connected_accounts(id, provider, address_enc, credentials_enc, settings, status), firms(name, settings)")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  const mailbox = event?.connected_accounts;
  if (!event?.client_id || !event.clients) return { done: true };
  if (mailbox?.status !== "connected") return {retry:"mail_not_connected",at:new Date(Date.now()+3600_000)};
  const firm = event.firm_id;
  const { data: driveAccount } = await admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!driveAccount) return { done: true };

  const crypto = serverCrypto();
  const read = await (await openMail(firm, mailbox)).readAttachments(event.provider_message_id);
  if ("error" in read) {
    if (read.error==="sign_in") await mailHealth(mailbox.id,"read",true,mailbox.credentials_enc);
    return {retry:"mail_unreachable",at:new Date(Date.now()+3600_000)};
  }
  await mailHealth(mailbox.id,"read",false,mailbox.credentials_enc);

  let filed: { type: string; period: string; toCheck: boolean }[];
  try {
    filed = await fileAttachments(admin, { ...event, client_id: event.client_id, clients: event.clients }, driveAccount, read, crypto);
  } catch {
    // The drive is away or refused: the files wait, and are tried every hour for 7 days.
    return { retry: "drive_unreachable", patient: true };
  }
  // A short reply saying what arrived, if the owner has turned it on (5.5.0), only to the
  // client's own address or a contact allowed to receive its papers.
  if (filed.length && event.firms && (event.firms.settings as { acknowledge?: boolean }).acknowledge === true) {
    let to = "";
    if (event.contact_id) {
      const { data: link } = await admin.from("contact_clients").select("can_receive_documents, contacts(email_enc)").eq("contact_id", event.contact_id).eq("client_id", event.client_id).maybeSingle();
      if (link?.can_receive_documents && link.contacts) to = await crypto.decrypt(firm, `contacts/${event.contact_id}/email`, link.contacts.email_enc);
    } else if (event.clients.email_enc) to = await crypto.decrypt(firm, `clients/${event.client_id}/email`, event.clients.email_enc);
    const delivery=event.delivery as {ack?:string};
    if (delivery.ack==="sent" || !to) return {done:true};
    const mailer=await firmMailer(firm,event.firms.name);
    if (!mailer) return {retry:"mail_not_connected",at:new Date(Date.now()+3600_000)};
    const messageId=`<received-${event.id}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
    const save=async(ack:string)=>{
      const {error}=ack==="sent" ? await admin.rpc("finish_mail_ack",{event_id:event.id,template_version:TEMPLATE_VERSION}) : await admin.from("email_events").update({delivery:{...delivery,ack} as NonNullable<Json>}).eq("id",event.id);
      if (error) throw new Error("acknowledgement_not_saved");
    };
    if (delivery.ack==="sending" && await mailer.sentAlready(messageId)) {await save("sent");return {done:true};}
    await save("sending");
    const message=emailTemplates.received(event.clients.name,event.firms.name,filed);
    const sent=await mailer.send(to,message.subject,message.text,messageId,event.provider_message_id);
    if (!sent) {if(mailer.waitUntil) await save("ready");return mailer.waitUntil ? {retry:"mail_wait",at:mailer.waitUntil} : {retry:"mail_not_sent",patient:true};}
    await save("sent");

  }
  return { done: true };
};

async function fileAttachments(
  admin: ReturnType<typeof supabaseAdmin>,
  event: { id: string; firm_id: string; client_id: string; received_at: string; label: string | null; clients: { name: string } },
  driveAccount: { id: string; provider: string; credentials_enc: string; settings: unknown },
  read: { subject: string; files: { name: string; bytes: Uint8Array }[] },
  crypto: ReturnType<typeof serverCrypto>,
): Promise<{ type: string; period: string; toCheck: boolean }[]> {
  const firm = event.firm_id;
  const filed: { type: string; period: string; toCheck: boolean }[] = [];
  const drive = await openDrive(firm, driveAccount);
  const order = ((driveAccount.settings as { folder_order?: FolderOrder }).folder_order ?? "year_client_work") as FolderOrder;
  const naming = (driveAccount.settings as { naming?: Naming }).naming;
  const client = event.clients.name;
  const { data: notices } = event.label === "notice_received" ? await admin.from("tasks").select("details").eq("firm_id", firm).eq("kind", "notice").eq("details->>email_event_id", event.id).limit(1) : { data: [] };
  const notice = notices?.[0]?.details as NoticeDetails | undefined;
  const { data: existing } = await admin.from("documents").select("id, email_event_id, sha256, document_type, period_key, status").eq("client_id", event.client_id);
  const known = existing ?? [];
  const { data: gstins } = await admin.from("client_registrations").select("id").eq("client_id", event.client_id).eq("kind", "gstin");
  for (const attachment of read.files) {
    // Checked by the file worker first (src/lib/intake.ts): a virus goes to the owner's folder
    // for it, a program or an unsafe ZIP is left out and logged, and each file in a ZIP is
    // filed like an attachment of its own, read with the ZIP's name too.
    const sent = await receive(firm, null, { id: event.client_id, name: client }, attachment, drive);
    if ("unsafe" in sent) {
      if (sent.unsafe !== "virus") await admin.from("activity_log").insert({ firm_id: firm, action: "document.refused", entity_type: "email", entity_id: event.id, details: { reason: sent.unsafe } });
      continue;
    }
    for await (const file of sent.papers) {
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      const previous=known.find((document)=>document.email_event_id===event.id && document.sha256===sha256);
      if (previous) {if(previous.status==="filed" && /\.(xlsx?|csv)$/i.test(file.name)) {const {error}=await queueSales(firm,previous.id);if(error) throw new Error("sales_not_queued");}filed.push({type:previous.document_type,period:previous.period_key,toCheck:previous.status!=="filed"});continue;}
      const described = describeFile(file.name, file === attachment ? read.subject : `${read.subject} ${attachment.name}`, event.label, event.received_at);
      const about = notice ? { ...described, work: notice.authority, type: described.type === "Document" && /\.pdf$/i.test(file.name) ? "Notice" : described.type } : described;
      const again = known.some((document) => document.sha256 === sha256);
      const registration = gstinFor(about.work, (gstins ?? []).map((row) => row.id));
      const toCheck = !about.sure || again;
      const folder = await drive.ensureFolder(folderFor(order, client, { ...about, receivedAt: event.received_at, toCheck }));
      const parts = { client, type: about.type, period: periodName(about.period), extension: path.extname(file.name) };
      const saved = await placeUnderFreeName(parts, receivedLabel(event.received_at), (name) => drive.save(folder, name, file.bytes), naming);
      if (saved === "taken") throw new Error("name_taken");
      const id = randomUUID();
      const { error } = await admin.from("documents").insert({
        id,
        firm_id: firm,
        client_id: event.client_id,
        work_type: about.work,
        document_type: about.type,
        period_key: about.period,
        status: toCheck ? "to_check" : "filed",
        email_event_id: event.id,
        drive_file_id: saved.id,
        name: saved.name,
        original_name_enc: file.name ? await crypto.encrypt(firm, `documents/${id}/original_name`, file.name) : null,
        size: file.bytes.length,
        sha256,
        received_at: event.received_at,
        registration_id: registration,
        scanned_at: sent.scanned ? new Date().toISOString() : null,
      });
      if (error) throw new Error("document_not_saved");
      if (!toCheck) await settleVersions(admin, { client_id: event.client_id, work_type: about.work, document_type: about.type, period_key: about.period, registration_id: registration });
      await queueRead(firm, id);
      if(about.work==="gst" && !toCheck && /\.(xlsx?|csv)$/i.test(file.name)) {const {error}=await queueSales(firm,id);if(error) throw new Error("sales_not_queued");}
      filed.push({ type: about.type, period: about.period, toCheck });
      known.push({ id, email_event_id: event.id, sha256, document_type: about.type, period_key: about.period, status:toCheck ? "to_check" : "filed" });
    }
  }
  return filed;
}
