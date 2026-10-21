import {queueSales} from "./read-sales";
import {queuePortal} from "./read-portal";
import { serverCrypto } from "@/src/lib/crypto";
import { openDrive } from "@/src/lib/drive-account";
import { readText, searchTokens, words } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Reads a filed document once and keeps only the keyed tokens of its words, with those of
// its name, type and the name it came with (PLAN.md 5.5.0, D29). Runs again after a rename.
export const readDocument: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: document } = await admin.from("documents").select("id, firm_id, name, document_type, original_name_enc, drive_file_id, status, work_type").eq("id", job.entity_id ?? "").maybeSingle();
  if (!document || document.status === "deleted") return { done: true };
  const firm = document.firm_id;
  const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!account) return { done: true };
  let bytes: Uint8Array;
  try {
    bytes = await (await openDrive(firm, account)).read(document.drive_file_id);
  } catch {
    return { retry: "drive_unreachable", patient: true };
  }
  const original = document.original_name_enc ? await serverCrypto().decrypt(firm, `documents/${document.id}/original_name`, document.original_name_enc) : "";
  const text = [document.name, document.document_type, original, await readText(document.name, bytes)].join("\n");
  await admin.from("documents").update({ search_tokens: await searchTokens(firm, words(text)) }).eq("id", document.id);
  if(document.status==="filed" && document.work_type==="gst" && /\.(xlsx?|csv)$/i.test(document.name)) {const {error}=await queueSales(firm,document.id);if(error) throw new Error("sales_not_queued");}
  if(document.status==="filed" && document.document_type==="GSTR-2B" && /\.json$/i.test(document.name)) {const {error}=await queuePortal(firm,document.id);if(error) throw new Error("portal_not_queued");}
  return { done: true };
};

// Queues the read for a document just filed or renamed.
export const queueRead = (firmId: string, documentId: string) =>
  supabaseAdmin()
    .from("jobs")
    .insert({ firm_id: firmId, kind: "read_document", entity_type: "document", entity_id: documentId, idempotency_key: `read_document:${documentId}:${Date.now()}` });
