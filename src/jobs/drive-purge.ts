import { openDrive } from "@/src/lib/drive-account";
import { supabaseAdmin } from "@/src/lib/supabase";
import { forgetText } from "@/src/lib/workspace";
import type { Handler } from "./runner";

const DAY = 86_400_000;

// Sends files the owner removed more than 30 days ago from the Removed papers
// folder to the drive's own bin, and forgets them and the text read from them (PLAN.md 5.5.1).
// Each is logged.
export const drivePurge: Handler = async (job) => {
  const admin = supabaseAdmin();
  const firm = job.entity_id ?? "";
  const [{ data: removed }, { data: account }] = await Promise.all([
    admin.from("documents").select("id, drive_file_id, details").eq("firm_id", firm).eq("status", "deleted"),
    admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle(),
  ]);
  if (!removed?.length || !account) return { done: true };
  const { data: entries } = await admin
    .from("activity_log")
    .select("entity_id, at")
    .eq("firm_id", firm)
    .eq("action", "document.removed")
    .in("entity_id", removed.map((document) => document.id));
  const removedAt = new Map<string, number>();
  for (const entry of entries ?? []) removedAt.set(entry.entity_id!, Math.max(removedAt.get(entry.entity_id!) ?? 0, Date.parse(entry.at)));
  const drive = await openDrive(firm, account);
  for (const document of removed) {
    if (Date.now() - (removedAt.get(document.id) ?? Date.now()) < 30 * DAY) continue;
    await forgetText(document.details);
    await drive.trash(document.drive_file_id);
    await admin.from("documents").delete().eq("id", document.id);
    await admin.from("activity_log").insert({ firm_id: firm, action: "document.purged", entity_type: "document", entity_id: document.id });
  }
  return { done: true };
};
