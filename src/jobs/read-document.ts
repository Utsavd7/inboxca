import { createHash } from "node:crypto";
import {queueSales} from "./read-sales";
import {queuePortal} from "./read-portal";
import type { Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { openDrive } from "@/src/lib/drive-account";
import { readsFigures } from "@/src/lib/portal-files";
import { fingerprint, readText, searchTokens, words } from "@/src/lib/search";
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
    content = await readText(document.name, bytes, password);
    // Only text read from the bytes this paper arrived with is fingerprinted and kept.
    if (createHash("sha256").update(bytes).digest("hex") === document.sha256) mark = await fingerprint(firm, content);
  }
  const original = document.original_name_enc ? await serverCrypto().decrypt(firm, `documents/${document.id}/original_name`, document.original_name_enc) : "";
  const text = [document.name, document.document_type, original, content].join("\n");
  const saved = mark && !own ? await keepText(firm, document.id, content).catch(() => null) : null;
  await admin.from("documents").update({ search_tokens: await searchTokens(firm, words(text)), ...(mark && { fingerprint: mark }), ...(saved && { details: { ...(document.details as Record<string, Json>), text: saved } }) }).eq("id", document.id);
  // A new version with the same content as an earlier one (the paper saved again) keeps that
  // one's figures, and is not read for them again.
  const earlier = admin.from("documents").select("id").eq("firm_id", firm).eq("client_id", document.client_id).eq("document_type", document.document_type).eq("period_key", document.period_key).eq("fingerprint", mark ?? "").in("status", ["filed", "earlier"]).lt("received_at", document.received_at).limit(1);
  const { data: same } = mark ? await (document.registration_id ? earlier.eq("registration_id", document.registration_id) : earlier.is("registration_id", null)) : { data: [] };
  if (same?.length) return { done: true };
  if(document.status==="filed" && document.work_type==="gst" && /\.(xlsx?|ods|csv)$/i.test(document.name)) {const {error}=await queueSales(firm,document.id);if(error) throw new Error("sales_not_queued");}
  if(document.status==="filed" && readsFigures(document)) {const {error}=await queuePortal(firm,document.id);if(error) throw new Error("portal_not_queued");}
  return { done: true };
};

// Queues the read for a document just filed or renamed.
export const queueRead = (firmId: string, documentId: string) =>
  supabaseAdmin()
    .from("jobs")
    .insert({ firm_id: firmId, kind: "read_document", entity_type: "document", entity_id: documentId, idempotency_key: `read_document:${documentId}:${Date.now()}` });
