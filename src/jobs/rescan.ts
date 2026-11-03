import { randomUUID } from "node:crypto";
import type { Json } from "@/src/db/types";
import { openDrive } from "@/src/lib/drive-account";
import { checkFile, quarantine } from "@/src/lib/intake";
import { supabaseAdmin } from "@/src/lib/supabase";
import { queueRead } from "./read-document";
import type { Handler } from "./runner";

// A file held under To check because the virus scanner was away (src/lib/intake.ts receive) is
// read back from the drive and checked again: clean, it is marked scanned and read like any
// paper; a virus goes to the owner's folder for it and the paper is removed. A scanner still
// away is tried every hour for 7 days (patient), then the job ends and the paper stays held,
// still on the owner's Today, until the scanner is back and a person adds it again.
export const rescan: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: document } = await admin.from("documents").select("id, firm_id, client_id, name, drive_file_id, status, details, clients(name)").eq("id", job.entity_id!).maybeSingle();
  const details = (document?.details ?? {}) as { held?: string } & Record<string, unknown>;
  if (!document || document.status === "deleted" || !details.held) return { done: true };
  const firm = document.firm_id;
  const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!account) return { retry: "drive_unreachable", patient: true };
  let drive: Awaited<ReturnType<typeof openDrive>>, bytes: Uint8Array;
  try { drive = await openDrive(firm, account); bytes = await drive.read(document.drive_file_id); }
  catch { return { retry: "drive_unreachable", patient: true }; }
  const file = { name: document.name, bytes };
  let checked: Awaited<ReturnType<typeof checkFile>>;
  try { checked = await checkFile(file, false); }
  catch { return { retry: "scanner_down", patient: true }; }
  if ("unsafe" in checked) {
    if (checked.unsafe === "virus") await quarantine(firm, null, { id: document.client_id, name: document.clients?.name ?? "" }, file, checked.found ?? "", drive, (folder, name) => drive.move(document.drive_file_id, folder, name));
    await admin.from("documents").update({ status: "deleted" }).eq("id", document.id);
    await admin.from("activity_log").insert({ firm_id: firm, action: "document.refused", entity_type: "document", entity_id: document.id, details: { reason: checked.unsafe } });
  } else {
    if (!checked.scanned) return { retry: "scanner_down", patient: true };
    const rest = Object.fromEntries(Object.entries(details).filter(([key]) => key !== "held")) as Json;
    await admin.from("documents").update({ scanned_at: new Date().toISOString(), details: rest }).eq("id", document.id);
    await queueRead(firm, document.id);
  }
  // The owner's line on Today closes with the firm's last held file.
  const { count } = await admin.from("documents").select("id", { count: "exact", head: true }).eq("firm_id", firm).neq("status", "deleted").eq("details->>held", "scan");
  if (!count) await admin.from("requests").update({ status: "done" }).eq("kind", "alert").eq("entity_type", "scan").eq("entity_id", firm).eq("status", "pending");
  return { done: true };
};

export const queueRescan = (firmId: string, documentId: string) =>
  supabaseAdmin().from("jobs").insert({ firm_id: firmId, kind: "rescan", entity_type: "document", entity_id: documentId, idempotency_key: `rescan:${documentId}:${randomUUID()}` });
