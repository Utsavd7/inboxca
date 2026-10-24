import { settleVersions } from "@/src/lib/documents";
import { openDrive } from "@/src/lib/drive-account";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Under this much free space the owner is told the drive is nearly full.
export const LOW_SPACE = 1024 ** 3;

// The daily drive check (PLAN.md 5.5.1). Reads InboxCA's folder in the firm's drive once:
// a filed document whose file is gone is marked missing, one found again is put back, and
// one renamed or moved in the drive is followed to its new name and logged. The owner gets
// one alert per problem (the folder is shared or has a link, the drive is nearly full,
// files are missing), cleared by the next check that finds all well.
export const driveCheck: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: account } = await admin.from("connected_accounts").select("id, firm_id, provider, credentials_enc").eq("id", job.entity_id ?? "").eq("kind", "drive").maybeSingle();
  if (!account) return { done: true };
  const firm = account.firm_id;
  const drive = await openDrive(firm, account);
  let seen;
  try {
    seen = await drive.check();
  } catch {
    return { retry: "drive_unreachable" };
  }
  const byId = new Map(seen.files.map((file) => [file.id, file.path]));
  const { data: documents } = await admin.from("documents").select("id, name, status, drive_file_id, client_id, work_type, document_type, period_key, registration_id").eq("firm_id", firm).neq("status", "deleted");
  let missing = 0;
  for (const document of documents ?? []) {
    const path = byId.get(document.drive_file_id);
    if (!path) {
      missing++;
      if (document.status !== "missing") {
        await admin.from("documents").update({ status: "missing" }).eq("id", document.id);
        await admin.from("activity_log").insert({ firm_id: firm, action: "document.missing", entity_type: "document", entity_id: document.id });
      }
      continue;
    }
    const name = path.split("/").pop()!;
    const status = document.status === "missing" ? (path.includes("/To check/") ? "to_check" : "filed") : document.status;
    if (name !== document.name || status !== document.status) {
      await admin.from("documents").update({ name, status }).eq("id", document.id);
      await admin.from("activity_log").insert({ firm_id: firm, action: "document.changed_outside", entity_type: "document", entity_id: document.id, details: { renamed: name !== document.name } });
      // An earlier version found again goes back behind the current one.
      if (status === "filed" && document.status === "missing") await settleVersions(admin, document);
    }
  }

  const alerts = {
    drive_shared: seen.shared ? {} : null,
    drive_full: seen.freeBytes !== null && seen.freeBytes < LOW_SPACE ? { free_bytes: seen.freeBytes } : null,
    drive_missing: missing ? { files: missing } : null,
  };
  for (const [reason, details] of Object.entries(alerts)) {
    if (details)
      await admin
        .from("requests")
        .upsert({ firm_id: firm, kind: "alert", entity_type: reason, entity_id: firm, reason_code: reason, status: "pending", details }, { onConflict: "kind,entity_type,entity_id" });
    else await admin.from("requests").update({ status: "done" }).eq("kind", "alert").eq("entity_type", reason).eq("entity_id", firm);
  }
  return { done: true };
};
