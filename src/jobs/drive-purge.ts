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
  const { data: account } = await admin.from("connected_accounts").select("id, provider, credentials_enc").eq("firm_id", firm).eq("kind", "drive").maybeSingle();
  if (!account) return { done: true };
  // A hundred removed papers at a time, so a firm with thousands is read in full; after a minute
  // the rest goes to a fresh run at once, inside the job's lease.
  const started = Date.now();
  let drive: Awaited<ReturnType<typeof openDrive>> | undefined, after = "";
  for (;;) {
    const { data: removed } = await admin.from("documents").select("id, drive_file_id, details").eq("firm_id", firm).eq("status", "deleted").gt("id", after).order("id").limit(100);
    if (!removed?.length) return { done: true };
    after = removed.at(-1)!.id;
    const { data: entries } = await admin
      .from("activity_log")
      .select("entity_id, at")
      .eq("firm_id", firm)
      .eq("action", "document.removed")
      .in("entity_id", removed.map((document) => document.id));
    const removedAt = new Map<string, number>();
    for (const entry of entries ?? []) removedAt.set(entry.entity_id!, Math.max(removedAt.get(entry.entity_id!) ?? 0, Date.parse(entry.at)));
    for (const document of removed) {
      if (Date.now() - (removedAt.get(document.id) ?? Date.now()) < 30 * DAY) continue;
      drive ??= await openDrive(firm, account);
      await forgetText(document.details);
      await drive.trash(document.drive_file_id);
      await admin.from("documents").delete().eq("id", document.id);
      await admin.from("activity_log").insert({ firm_id: firm, action: "document.purged", entity_type: "document", entity_id: document.id });
    }
    if (Date.now() - started > 60_000) return { retry: "more_to_purge", at: new Date() };
  }
};
