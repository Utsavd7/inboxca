import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, periodName } from "@/src/lib/documents";
import { fileName, folderPath, type FolderOrder } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { readAttachments, type MailSettings } from "@/src/lib/mailbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Files a client email's attachments into the client's folder in the firm's drive
// (PLAN.md 5.5.0, D24, D36): Financial year / Client / Work type, named Client - Type -
// Period. A file whose type or period the rules could not tell goes under To check for a
// person to confirm. A taken name gets the received date, then a short id; nothing is
// overwritten. A retry skips files already filed, by checksum.
export const fileMail: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, provider_message_id, received_at, label, clients(name), connected_accounts(id, address_enc, credentials_enc, settings, status)")
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

  const drive = await openDrive(firm, driveAccount);
  const order = ((driveAccount.settings as { folder_order?: FolderOrder }).folder_order ?? "year_client_work") as FolderOrder;
  const client = event.clients.name;
  const received = new Date(event.received_at).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  const { data: filed } = await admin.from("documents").select("sha256").eq("email_event_id", event.id);
  const seen = new Set(filed?.map((document) => document.sha256));
  for (const file of read.files) {
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    const about = describeFile(file.name, read.subject, event.label, event.received_at);
    const folder = await drive.ensureFolder([...folderPath(order, about.year, client, about.work), ...(about.sure ? [] : ["To check"])]);
    const parts = { client, type: about.type, period: periodName(about.period), extension: path.extname(file.name) };
    let name = fileName(parts);
    let saved = await drive.save(folder, name, file.bytes);
    for (const suffix of [received, randomBytes(3).toString("hex")])
      if (saved === "taken") saved = await drive.save(folder, (name = fileName({ ...parts, suffix })), file.bytes);
    if (saved === "taken") return { retry: "name_taken" };
    const id = randomUUID();
    const { error } = await admin.from("documents").insert({
      id,
      firm_id: firm,
      client_id: event.client_id,
      work_type: about.work,
      document_type: about.type,
      period_key: about.period,
      status: about.sure ? "filed" : "to_check",
      email_event_id: event.id,
      drive_file_id: saved.id,
      name,
      original_name_enc: file.name ? await crypto.encrypt(firm, `documents/${id}/original_name`, file.name) : null,
      size: file.bytes.length,
      sha256,
    });
    if (error) return { retry: "document_not_saved" };
  }
  return { done: true };
};
