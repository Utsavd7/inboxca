import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, folderFor, periodName, placeUnderFreeName, receivedLabel } from "@/src/lib/documents";
import type { FolderOrder, Naming } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { firmMailer } from "@/src/lib/firm-mail";
import { readAttachments, type MailSettings } from "@/src/lib/mailbox";
import type { NoticeDetails } from "@/src/lib/notices";
import { supabaseAdmin } from "@/src/lib/supabase";
import { queueRead } from "./read-document";
import type { Handler } from "./runner";

// Files a client email's attachments into the client's folder in the firm's drive
// (PLAN.md 5.5.0, D24, D36): Financial year / Client / Work type, named Client - Type -
// Period. A file goes under To check for a person to confirm when the rules could not tell
// its type or period, or when the client already has the same file, or another of the same
// type and period (the same document again: the team chooses). A retry skips files already
// filed from this email, by checksum.
export const fileMail: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, contact_id, provider_message_id, received_at, label, clients(name, email_enc), connected_accounts(id, address_enc, credentials_enc, settings, status), firms(name, settings)")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  const mailbox = event?.connected_accounts;
  if (!event?.client_id || !event.clients || mailbox?.status !== "connected") return { done: true };
  const firm = event.firm_id;
  const { data: driveAccount } = await admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!driveAccount) return { done: true };

  const crypto = serverCrypto();
  const address = await crypto.decrypt(firm, `accounts/${mailbox.id}/address`, mailbox.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firm, `accounts/${mailbox.id}/credentials`, mailbox.credentials_enc));
  const read = await readAttachments(address, password, (mailbox.settings as MailSettings).imap, event.provider_message_id);
  if ("error" in read) return read.error === "server" ? { retry: "mail_unreachable" } : { done: true };

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
    const mailer = to ? await firmMailer(firm, event.firms.name) : null;
    await mailer?.send(to, "We have received your files", acknowledgement(event.clients.name, event.firms.name, filed), undefined, event.provider_message_id);
  }
  return { done: true };
};

// The acknowledgement's text: what arrived, by type and period, from the records only.
export function acknowledgement(client: string, firm: string, filed: { type: string; period: string; toCheck: boolean }[]) {
  const named = filed.filter((file) => !file.toCheck).map((file) => `- ${[file.type, periodName(file.period)].filter(Boolean).join(", ")}`);
  const unclear = filed.filter((file) => file.toCheck).length;
  return [
    `Dear ${client},`,
    "",
    "Thank you. We have received:",
    ...named,
    ...(unclear ? [`- ${unclear === 1 ? "1 file" : `${unclear} files`} our team will check`] : []),
    "",
    firm,
  ].join("\n");
}

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
  const { data: existing } = await admin.from("documents").select("email_event_id, sha256, document_type, period_key").eq("client_id", event.client_id);
  const known = existing ?? [];
  for (const file of read.files) {
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    if (known.some((document) => document.email_event_id === event.id && document.sha256 === sha256)) continue;
    const described = describeFile(file.name, read.subject, event.label, event.received_at);
    const about = notice ? { ...described, work: notice.authority, type: described.type === "Document" && /\.pdf$/i.test(file.name) ? "Notice" : described.type } : described;
    const again = known.some((document) => document.sha256 === sha256 || (about.sure && document.document_type === about.type && document.period_key === about.period));
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
    });
    if (error) throw new Error("document_not_saved");
    await queueRead(firm, id);
    filed.push({ type: about.type, period: about.period, toCheck });
    known.push({ email_event_id: event.id, sha256, document_type: about.type, period_key: about.period });
  }
  return filed;
}
