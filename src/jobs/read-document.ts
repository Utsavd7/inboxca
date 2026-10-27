import { createHash } from "node:crypto";
import path from "node:path";
import {queueSales} from "./read-sales";
import {queuePortal} from "./read-portal";
import type { Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { filePeriod, folderFor, placeUnderFreeName, receivedLabel } from "@/src/lib/documents";
import type { FolderOrder, Naming, WorkType } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { readsFigures } from "@/src/lib/portal-files";
import { fingerprint, readText, searchTokens, words, type Ocr } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import { keepText, openText } from "@/src/lib/workspace";
import type { Handler } from "./runner";

// Reads a filed document once and keeps only the keyed tokens of its words, with those of
// its name, type and the name it came with (PLAN.md 5.5.0, D29). Runs again after a rename.
// The text read is kept sealed in the workspace store: a rename, or an exact copy of the file
// from the same client, opens it there and reads neither the drive nor the file again.
export const readDocument: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: document } = await admin.from("documents").select("id, firm_id, client_id, registration_id, name, document_type, period_key, original_name_enc, password_enc, drive_file_id, status, work_type, sha256, received_at, details").eq("id", job.entity_id ?? "").maybeSingle();
  if (!document || document.status === "deleted") return { done: true };
  const firm = document.firm_id;
  const { data: copies } = await admin.from("documents").select("id, fingerprint, details").eq("firm_id", firm).eq("client_id", document.client_id).eq("sha256", document.sha256).not("details->text", "is", null).limit(10);
  const copy = copies?.find((other) => other.id === document.id) ?? copies?.[0];
  let content = copy ? await openText(firm, copy.id, copy.details).catch(() => null) : null;
  let mark = content === null ? null : copy!.fingerprint;
  const own = content !== null && copy!.id === document.id;
  // A scan's pages and a picture are read by OCR once (D29); its engine, languages and mean
  // confidence go beside the sealed text, an exact copy's too. Figures are never read from it.
  const scan: { ocr?: Ocr; later?: boolean } = {}, kept = (copy?.details as { text?: Ocr } | null)?.text;
  if (content !== null && !own && kept?.kind === "ocr_text") scan.ocr = { kind: kept.kind, engine: kept.engine, languages: kept.languages, confidence: kept.confidence };
  let later: Date | undefined;
  if (content === null) {
    const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
    if (!account) return { done: true };
    let bytes: Uint8Array;
    try {
      bytes = await (await openDrive(firm, account)).read(document.drive_file_id);
    } catch {
      return { retry: "drive_unreachable", patient: true };
    }
    const password = document.password_enc ? await serverCrypto().decrypt(firm, `documents/${document.id}/password`, document.password_enc) : undefined;
    content = await readText(document.name, bytes, password, scan);
    // A file worker too busy for OCR, or a read past its time, is tried again 8 hours on, up to
    // 3 times; until then nothing is fingerprinted or kept, so the next read starts afresh.
    if (scan.later && job.attempts <= 3) later = new Date(Date.now() + 8 * 3600_000);
    // Only text read from the bytes this paper arrived with is fingerprinted and kept.
    else if (createHash("sha256").update(bytes).digest("hex") === document.sha256) mark = await fingerprint(firm, content);
  }
  // A paper under To check with the same content as one of this client's already filed is filed
  // the same way (PLAN.md 5.5.0); its words below then take its new name and type.
  const filed = document.status === "to_check" && mark ? await fileLikeTwin(document, mark) : null;
  if (filed) Object.assign(document, filed);
  const original = document.original_name_enc ? await serverCrypto().decrypt(firm, `documents/${document.id}/original_name`, document.original_name_enc) : "";
  const text = [document.name, document.document_type, original, content].join("\n");
  const saved = mark && !own ? await keepText(firm, document.id, content).catch(() => null) : null;
  await admin.from("documents").update({ search_tokens: await searchTokens(firm, words(text)), ...(mark && { fingerprint: mark }), ...(saved && { details: { ...(document.details as Record<string, Json>), text: { ...saved, ...scan.ocr } } }), ...(filed && { registration_id: filed.registration_id }) }).eq("id", document.id);
  if (later) return { retry: "ocr_busy", at: later };
  // A new version with the same content as an earlier one (the paper saved again) keeps that
  // one's figures, and is not read for them again.
  const earlier = admin.from("documents").select("id").eq("firm_id", firm).eq("client_id", document.client_id).eq("document_type", document.document_type).eq("period_key", document.period_key).eq("fingerprint", mark ?? "").in("status", ["filed", "earlier"]).lt("received_at", document.received_at).limit(1);
  const { data: same } = mark ? await (document.registration_id ? earlier.eq("registration_id", document.registration_id) : earlier.is("registration_id", null)) : { data: [] };
  if (same?.length) return { done: true };
  if(document.status==="filed" && document.work_type==="gst" && /\.(xlsx?|ods|csv)$/i.test(document.name)) {const {error}=await queueSales(firm,document.id);if(error) throw new Error("sales_not_queued");}
  if(document.status==="filed" && readsFigures(document)) {const {error}=await queuePortal(firm,document.id);if(error) throw new Error("portal_not_queued");}
  return { done: true };
};

// Filed as this client's papers with the same content are (never another client's or firm's):
// their work, type, period and GSTIN, moved into their folder under a free name, never over
// another file, and logged by rename_document as done by InboxCA, so Undo on the client's
// Activity puts it back. None when they disagree, when their type or period is not known, or
// when one is the same file (that waits for a person, as the same file came in before).
async function fileLikeTwin(document: { id: string; firm_id: string; client_id: string; name: string; sha256: string; drive_file_id: string; received_at: string }, mark: string) {
  const admin = supabaseAdmin();
  const { data: twins } = await admin.from("documents").select("work_type, document_type, period_key, registration_id, sha256, clients(name)").eq("firm_id", document.firm_id).eq("client_id", document.client_id).eq("fingerprint", mark).in("status", ["filed", "earlier"]).limit(20);
  const [twin] = twins ?? [], ways = new Set(twins?.map((other) => [other.work_type, other.document_type, other.period_key, other.registration_id].join("/")));
  if (!twin?.clients || ways.size !== 1 || twin.document_type === "Document" || !twin.period_key || twins!.some((other) => other.sha256 === document.sha256)) return null;
  const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", document.firm_id).eq("kind", "drive").maybeSingle();
  if (!account) return null;
  const settings = account.settings as { folder_order?: FolderOrder; naming?: Naming }, drive = await openDrive(document.firm_id, account);
  const folder = await drive.ensureFolder(folderFor(settings.folder_order ?? "year_client_work", twin.clients.name, { work: twin.work_type as WorkType, period: twin.period_key, receivedAt: document.received_at, toCheck: false }));
  const placed = await placeUnderFreeName({ client: twin.clients.name, type: twin.document_type, period: filePeriod(twin.period_key), extension: path.extname(document.name) }, receivedLabel(document.received_at), (name) => drive.move(document.drive_file_id, folder, name), settings.naming);
  if (placed === "taken") return null;
  // No person did it: the log names no one, and the Activity shows InboxCA.
  const { error } = await admin.rpc("rename_document", { target: document.id, actor: null as unknown as string, new_work: twin.work_type, new_type: twin.document_type, new_period: twin.period_key, new_status: "filed", new_name: placed.name, new_file: placed.id });
  if (error) throw new Error("document_not_renamed");
  return { status: "filed", work_type: twin.work_type, document_type: twin.document_type, period_key: twin.period_key, registration_id: twin.registration_id, name: placed.name, drive_file_id: placed.id };
}

// Queues the read for a document just filed or renamed.
export const queueRead = (firmId: string, documentId: string) =>
  supabaseAdmin()
    .from("jobs")
    .insert({ firm_id: firmId, kind: "read_document", entity_type: "document", entity_id: documentId, idempotency_key: `read_document:${documentId}:${Date.now()}` });
