import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { folderFor, periodName, placeUnderFreeName, receivedLabel } from "@/src/lib/documents";
import type { FolderOrder, Naming, WorkType } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import type { Planned } from "@/src/lib/first-import";
import { supabaseAdmin } from "@/src/lib/supabase";
import { queueRead } from "./read-document";
import type { Handler } from "./runner";

export type ImportPlan = { files: (Planned & { client: string })[]; done: number; moved: { document: string; from: string }[] };
const BATCH = 25;

// Moves the next files of an approved first import into their client folders (PLAN.md
// 5.16): read once for the checksum, moved inside the drive (nothing uploaded again),
// renamed by InboxCA's rules, recorded, then read for search. Where each one was is kept
// for Undo. The job queues itself again until every file has moved.
export const importFiles: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: request } = await admin.from("requests").select("id, firm_id, status, details").eq("id", job.entity_id ?? "").eq("kind", "import").maybeSingle();
  if (request?.status !== "pending") return { done: true };
  const firm = request.firm_id;
  const plan = request.details as unknown as ImportPlan;
  const [{ data: account }, { data: clients }] = await Promise.all([
    admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", firm).eq("kind", "drive").maybeSingle(),
    admin.from("clients").select("id, name").eq("firm_id", firm),
  ]);
  if (!account) return { retry: "drive_unreachable", patient: true };
  const drive = await openDrive(firm, account);
  const order = ((account.settings as { folder_order?: FolderOrder }).folder_order ?? "year_client_work") as FolderOrder;
  const naming = (account.settings as { naming?: Naming }).naming;
  const names = new Map(clients?.map((client) => [client.id, client.name]));
  const now = new Date().toISOString();
  try {
    for (const file of plan.files.slice(plan.done, plan.done + BATCH)) {
      plan.done++;
      const client = names.get(file.client);
      if (!client) continue;
      const bytes = await drive.read(file.id);
      const folder = await drive.ensureFolder(folderFor(order, client, { work: file.work as WorkType, period: file.period, receivedAt: now, toCheck: file.toCheck }));
      const placed = await placeUnderFreeName({ client, type: file.type, period: periodName(file.period), extension: path.extname(file.from) }, receivedLabel(now), (name) => drive.move(file.id, folder, name), naming);
      if (placed === "taken") continue;
      const id = randomUUID();
      await admin.from("documents").insert({
        id,
        firm_id: firm,
        client_id: file.client,
        work_type: file.work,
        document_type: file.type,
        period_key: file.period,
        status: file.toCheck ? "to_check" : "filed",
        drive_file_id: placed.id,
        name: placed.name,
        original_name_enc: await serverCrypto().encrypt(firm, `documents/${id}/original_name`, path.basename(file.from)),
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        received_at: now,
      });
      plan.moved.push({ document: id, from: file.from });
      await queueRead(firm, id);
    }
  } catch {
    await admin.from("requests").update({ details: plan as unknown as NonNullable<Json> }).eq("id", request.id);
    return { retry: "drive_unreachable", patient: true };
  }
  const finished = plan.done >= plan.files.length;
  await admin.from("requests").update({ details: plan as unknown as NonNullable<Json>, status: finished ? "done" : "pending" }).eq("id", request.id);
  if (!finished) await admin.from("jobs").insert({ firm_id: firm, kind: "import_files", entity_type: "request", entity_id: request.id, idempotency_key: `import_files:${request.id}:${plan.done}` });
  else await admin.from("activity_log").insert({ firm_id: firm, action: "import.finished", entity_type: "request", entity_id: request.id, details: { files: plan.moved.length } });
  return { done: true };
};

// Puts an import back: each moved file returns to where it was, a batch at a time, and its
// document is forgotten. Files a person has since changed are moved back all the same.
export const undoImport: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: request } = await admin.from("requests").select("id, firm_id, details").eq("id", job.entity_id ?? "").eq("kind", "import").maybeSingle();
  if (!request) return { done: true };
  const firm = request.firm_id;
  const plan = request.details as unknown as ImportPlan;
  const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!account) return { retry: "drive_unreachable", patient: true };
  const drive = await openDrive(firm, account);
  try {
    for (const moved of plan.moved.splice(-BATCH)) {
      const { data: document } = await admin.from("documents").select("drive_file_id").eq("id", moved.document).maybeSingle();
      if (document) await drive.move(document.drive_file_id, path.posix.dirname(moved.from), path.posix.basename(moved.from));
      await admin.from("documents").delete().eq("id", moved.document);
    }
  } catch {
    return { retry: "drive_unreachable", patient: true };
  }
  await admin.from("requests").update({ details: plan as unknown as NonNullable<Json>, status: "done" }).eq("id", request.id);
  if (plan.moved.length) await admin.from("jobs").insert({ firm_id: firm, kind: "undo_import", entity_type: "request", entity_id: request.id, idempotency_key: `undo_import:${request.id}:${plan.moved.length}` });
  else await admin.from("activity_log").insert({ firm_id: firm, action: "import.undone", entity_type: "request", entity_id: request.id });
  return { done: true };
};
