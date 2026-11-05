import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Json } from "@/src/db/types";
import { clientReplied, receiveAsked } from "@/src/lib/checklists";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, filePeriod, folderFor, gstinFor, layoutTyped, placeUnderFreeName, receivedLabel, settleVersions, tdsChallanText, typeByContent } from "@/src/lib/documents";
import { emailTemplates } from "@/src/lib/email-templates";
import { pdfLines, recogniseTaxPdf } from "@/src/lib/tax-papers";
import type { FolderOrder, Naming } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { firmMailer, mailHealth, openMail } from "@/src/lib/firm-mail";
import { receive, type Paper } from "@/src/lib/intake";
import type { NoticeDetails } from "@/src/lib/notices";
import { fetchShared, sharedLinks } from "@/src/lib/share-link";
import { supabaseAdmin } from "@/src/lib/supabase";
import { queueRead } from "./read-document";
import { queueSales } from "./read-sales";
import type { Handler } from "./runner";

// Files a client email's attachments into the client's folder in the firm's drive
// (PLAN.md 5.5.0, D24, D36): Financial year / Client / Work type, named Client - Type -
// Period. A file goes under To check for a person to confirm when the rules could not tell
// its type or period, or when the client already has the same file. One of the same type,
// period and GSTIN as a filed one becomes current, the older kept as an earlier version. A
// retry skips files already filed from this email, by checksum. A sharing link in the email
// is read the same way, but its file waits for a person's Save (src/lib/share-link.ts).
export const fileMail: Handler = async (job, { markSending }) => {
  const admin = supabaseAdmin();
  const { data: event } = await admin
    .from("email_events")
    .select("id, firm_id, client_id, provider_message_id, received_at, label, reason_code, delivery, clients(name, email_enc), connected_accounts(id, provider, address_enc, credentials_enc, settings, status), firms(name)")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  const mailbox = event?.connected_accounts;
  if (!event?.client_id || !event.clients) return { done: true };
  if (mailbox?.status !== "connected") return {retry:"mail_not_connected",at:new Date(Date.now()+3600_000)};
  const firm = event.firm_id;
  const { data: driveAccount } = await admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!driveAccount) return { done: true };

  const read = await (await openMail(firm, mailbox)).readAttachments(event.provider_message_id);
  if ("error" in read) {
    if (read.error==="sign_in") await mailHealth(mailbox.id,"read",true,mailbox.credentials_enc);
    return {retry:"mail_unreachable",at:new Date(Date.now()+3600_000)};
  }
  await mailHealth(mailbox.id,"read",false,mailbox.credentials_enc);

  let filing: Filing, filed: Filed[];
  try {
    filing = await openFiling(admin, { ...event, client_id: event.client_id, clients: event.clients }, driveAccount);
    filed = await fileAttachments(filing, read);
  } catch {
    // The drive is away or refused: the files wait, and are tried every hour for 7 days.
    return { retry: "drive_unreachable", patient: true };
  }
  // The receipt saying what arrived is a job of its own, by the firm's setting (Inbox, answered C).
  // A tax portal's mail gets none: the client did not send it.
  if (filed.length && !event.reason_code?.startsWith("government_")) {
    const { error } = await admin.from("jobs").upsert({ firm_id: firm, kind: "answer_mail", entity_type: "email", entity_id: event.id, idempotency_key: `answer_mail:${event.id}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) return { retry: "receipt_not_queued" };
  }
  // Sharing links: a file anyone with the link may open is read and named, then waits on Today
  // for a person's Save; any other link gets one reply asking for the file attached or the link
  // opened, and the email waits for the team with that line.
  const links = sharedLinks(read.text);
  if (!links.length || !event.firms) return { done: true };
  const delivery = (event.delivery ?? {}) as Record<string, Json | undefined>;
  if (delivery.links === "read" || delivery.links === "asked") return { done: true };
  let unread = false;
  for (const link of links) {
    const got = link.fetch ? await fetchShared(link.fetch) : "private";
    if (typeof got === "string") { unread = true; continue; }
    const sent = await receive(firm, null, { id: event.client_id, name: event.clients.name }, got, filing.drive);
    if ("unsafe" in sent) { await admin.from("activity_log").insert({ firm_id: firm, action: "document.refused", entity_type: "email", entity_id: event.id, details: { reason: sent.unsafe } }); continue; }
    for await (const file of sent.papers) {
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      if (filing.known.some((document) => document.sha256 === sha256)) continue;
      const about = await describe(filing, file, `${read.subject} ${got.name}`);
      const folder = folderFor(filing.order, filing.client, { ...about, receivedAt: event.received_at, toCheck: !about.sure });
      const key = createHash("sha256").update(`${event.id}:${sha256}`).digest("hex");
      const { error } = await admin.from("requests").upsert({
        firm_id: firm, client_id: event.client_id, kind: "alert", entity_type: "link", entity_id: `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 32)}`, reason_code: "link", status: "pending", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        details: { client: filing.client, email: event.id, url: link.url, fetch: link.fetch, file: file.name, sha256, size: file.bytes.length, name: `${filing.client} - ${about.type}${about.period ? ` - ${filePeriod(about.period)}` : ""}${path.extname(file.name)}`, folder: folder.join(" / "), about: { type: about.type, work: about.work, period: about.period, sure: about.sure } },
      }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
      if (error) throw new Error("link_not_noted");
    }
  }
  if (unread) {
    const { error } = await admin.from("requests").upsert({ firm_id: firm, kind: "team_reply", client_id: event.client_id, entity_type: "email", entity_id: event.id, reason_code: "link_private" }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true });
    if (error) throw new Error("team_reply_not_saved");
    const mailer = event.clients.email_enc ? await firmMailer(firm, event.firms.name) : null;
    if (mailer) {
      const to = await serverCrypto().decrypt(firm, `clients/${event.client_id}/email`, event.clients.email_enc!);
      const message = emailTemplates.openLink(event.clients.name, event.firms.name);
      const messageId = `<link-${event.id}@${new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host}>`;
      const note = (links: string) => admin.from("email_events").update({ delivery: { ...delivery, links } }).eq("id", event.id);
      // A try that stopped part way sees a reply that went by its message id, and sends no second.
      if (delivery.links !== "sending" || !(await mailer.sentAlready(messageId))) {
        await note("sending");
        await markSending();
        if (!(await mailer.send(to, message.subject, message.text, messageId, event.provider_message_id))) return mailer.waitUntil ? { retry: "mail_wait", at: mailer.waitUntil } : { retry: "mail_not_sent" };
      }
      await note("asked");
      return { done: true };
    }
  }
  await admin.from("email_events").update({ delivery: { ...delivery, links: "read" } }).eq("id", event.id);
  return { done: true };
};

// A person pressed Save on a file read from a sharing link: fetched again, taken only when it
// is the same bytes they saw named, and filed through the same steps as an attachment.
export const fileLink: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: ask } = await admin.from("requests").select("id, firm_id, client_id, details, clients(name)").eq("id", job.entity_id ?? "").eq("entity_type", "link").maybeSingle();
  const details = ask?.details as { email: string; fetch: string; sha256: string; file: string; by?: string; name: string } | undefined;
  if (!ask?.client_id || !ask.clients || !details?.by) return { done: true };
  const { data: event } = await admin.from("email_events").select("id, firm_id, client_id, received_at, label").eq("id", details.email).maybeSingle();
  const { data: driveAccount } = await admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", ask.firm_id).eq("kind", "drive").maybeSingle();
  if (!event?.client_id || !driveAccount) return { done: true };
  const got = await fetchShared(details.fetch);
  if (typeof got === "string") return got === "error" ? { retry: "link_unreachable", patient: true } : { done: true, reason: "link_closed" };
  let filing: Filing;
  try { filing = await openFiling(admin, { ...event, client_id: event.client_id, clients: ask.clients }, driveAccount); }
  catch { return { retry: "drive_unreachable", patient: true }; }
  const sent = await receive(ask.firm_id, details.by, { id: ask.client_id, name: ask.clients.name }, got, filing.drive);
  if ("unsafe" in sent) return { done: true, reason: sent.unsafe };
  for await (const file of sent.papers) {
    if (createHash("sha256").update(file.bytes).digest("hex") !== details.sha256) continue;
    const saved = await filePaper(filing, file, details.name);
    if (saved.fresh) {
      await admin.from("activity_log").insert({ firm_id: ask.firm_id, actor_id: details.by, action: "document.uploaded", entity_type: "document", entity_id: saved.id, details: { from: "link" } });
      await clientReplied(admin, ask.client_id);
    }
    return { done: true };
  }
  return { done: true, reason: "link_changed" };
}

type Filed = { type: string; period: string; toCheck: boolean };
type Known = { id: string; email_event_id: string | null; sha256: string | null; document_type: string; period_key: string; status: string };
type Filing = {
  admin: ReturnType<typeof supabaseAdmin>;
  event: { id: string; firm_id: string; client_id: string; received_at: string; label: string | null };
  client: string; drive: Awaited<ReturnType<typeof openDrive>>; order: FolderOrder; naming?: Naming;
  notice?: NoticeDetails; known: Known[]; gstins: string[];
};
// What filing a client's email needs: the drive, how it is laid out, the notice the email
// recorded, the client's papers so far and its GSTINs.
async function openFiling(admin: Filing["admin"], event: Filing["event"] & { clients: { name: string } }, driveAccount: { id: string; provider: string; credentials_enc: string; settings: unknown }): Promise<Filing> {
  const drive = await openDrive(event.firm_id, driveAccount);
  const settings = driveAccount.settings as { folder_order?: FolderOrder; naming?: Naming };
  const { data: notices } = event.label === "notice_received" ? await admin.from("tasks").select("details").eq("firm_id", event.firm_id).eq("kind", "notice").eq("details->>email_event_id", event.id).limit(1) : { data: [] };
  const { data: existing } = await admin.from("documents").select("id, email_event_id, sha256, document_type, period_key, status").eq("client_id", event.client_id);
  const { data: gstins } = await admin.from("client_registrations").select("id").eq("client_id", event.client_id).eq("kind", "gstin");
  return { admin, event, client: event.clients.name, drive, order: settings.folder_order ?? "year_client_work", naming: settings.naming, notice: notices?.[0]?.details as NoticeDetails | undefined, known: existing ?? [], gstins: (gstins ?? []).map((row) => row.id) };
}

// What a paper is, by its name and the email's words; a PDF named as a tax paper is typed by
// what is printed in it, never by the words alone. A challan or unknown PDF whose first pages
// print a TDS challan's form or minor head is a TDS challan.
async function describe(filing: Filing, file: Paper, hint: string) {
  const plain = describeFile(file.name, hint, filing.event.label, filing.event.received_at);
  const challan = !filing.notice && /\.pdf$/i.test(file.name) && ["Challan", "Document"].includes(plain.type) && (await pdfLines(file.bytes, 2).then((lines) => tdsChallanText(lines.map((line) => line.text).join("\n")), () => false));
  const named = challan ? describeFile(file.name, hint, filing.event.label, filing.event.received_at, "TDS challans") : plain;
  const described = layoutTyped.has(named.type) && /\.pdf$/i.test(file.name) ? typeByContent(named, await pdfLines(file.bytes, 10).then(recogniseTaxPdf, () => null), file.name) : named;
  return filing.notice ? { ...described, work: filing.notice.authority, type: described.type === "Document" && /\.pdf$/i.test(file.name) ? "Notice" : described.type } : described;
}

// One paper saved into the client's folder and recorded, read for search, matched to the
// papers asked for, and its sales register read; one this email already filed is given as it was.
async function filePaper(filing: Filing, file: Paper, hint: string): Promise<Filed & { id: string; fresh: boolean }> {
  const { admin, event, client, drive, known } = filing;
  const firm = event.firm_id;
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const previous = known.find((document) => document.email_event_id === event.id && document.sha256 === sha256);
  if (previous) {
    if (previous.status === "filed" && /\.(xlsx?|ods|csv)$/i.test(file.name)) { const { error } = await queueSales(firm, previous.id); if (error) throw new Error("sales_not_queued"); }
    return { id: previous.id, type: previous.document_type, period: previous.period_key, toCheck: previous.status !== "filed", fresh: false };
  }
  const about = await describe(filing, file, hint);
  const again = known.some((document) => document.sha256 === sha256);
  const registration = gstinFor(about.work, filing.gstins);
  const toCheck = !about.sure || again;
  const folder = await drive.ensureFolder(folderFor(filing.order, client, { ...about, receivedAt: event.received_at, toCheck }));
  const parts = { client, type: about.type, period: filePeriod(about.period), extension: path.extname(file.name) };
  const saved = await placeUnderFreeName(parts, receivedLabel(event.received_at), (name) => drive.save(folder, name, file.bytes), filing.naming);
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
    original_name_enc: file.name ? await serverCrypto().encrypt(firm, `documents/${id}/original_name`, file.name) : null,
    size: file.bytes.length,
    sha256,
    received_at: event.received_at,
    registration_id: registration,
  });
  if (error) throw new Error("document_not_saved");
  if (!toCheck) await settleVersions(admin, { client_id: event.client_id, work_type: about.work, document_type: about.type, period_key: about.period, registration_id: registration });
  // A paper the client emailed answers what was asked for.
  if (!toCheck) await receiveAsked(admin, event.client_id, about.type, about.period, id);
  await queueRead(firm, id);
  if(about.work==="gst" && !toCheck && /\.(xlsx?|ods|csv)$/i.test(file.name)) {const {error}=await queueSales(firm,id);if(error) throw new Error("sales_not_queued");}
  known.push({ id, email_event_id: event.id, sha256, document_type: about.type, period_key: about.period, status: toCheck ? "to_check" : "filed" });
  return { id, type: about.type, period: about.period, toCheck, fresh: true };
}

async function fileAttachments(filing: Filing, read: { subject: string; files: Paper[] }): Promise<Filed[]> {
  const { admin, event, client, drive } = filing;
  const filed: (Filed & { fresh: boolean })[] = [];
  for (const attachment of read.files) {
    // Checked first (src/lib/intake.ts): a program goes to the owner's folder for files kept
    // out, an unsafe ZIP is left out and logged, and each file in a ZIP is filed like an
    // attachment of its own, read with the ZIP's name too.
    const sent = await receive(event.firm_id, null, { id: event.client_id, name: client }, attachment, drive);
    if ("unsafe" in sent) {
      await admin.from("activity_log").insert({ firm_id: event.firm_id, action: "document.refused", entity_type: "email", entity_id: event.id, details: { reason: sent.unsafe } });
      continue;
    }
    for await (const file of sent.papers) filed.push(await filePaper(filing, file, file === attachment ? read.subject : `${read.subject} ${attachment.name}`));
  }
  if (filed.some((paper) => paper.fresh)) await clientReplied(admin, event.client_id);
  return filed;
}
