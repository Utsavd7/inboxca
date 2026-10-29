import { randomUUID } from "node:crypto";
import { todayInIndia } from "@/src/lib/calendar";
import { financialYear, folderPath } from "@/src/lib/drive";
import { openDrive, watchDrive } from "@/src/lib/drive-account";
import { pages } from "@/src/lib/paged";
import { supabaseAdmin } from "@/src/lib/supabase";
import { MAX_ATTEMPTS, type Handler } from "./runner";

// The setup after Connect (PLAN.md 5.5.1), done by InboxCA alone: its folder, this year's
// folder for each client, a small test file saved, read back and removed, and a check that the
// folder is shared with nobody and of the space left. Settings, Firm drive shows a tick for
// each, from this one log line (drive.setup). Many clients may take more than one run; folders
// already there are skipped. A drive that cannot be reached after five tries is logged so too.
export const driveSetup: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: account } = await admin.from("connected_accounts").select("id, firm_id, provider, credentials_enc, settings").eq("id", job.entity_id ?? "").eq("kind", "drive").maybeSingle();
  if (!account) return { done: true };
  const firm = account.firm_id;
  const started = Date.now();
  const logged = (details: Record<string, boolean | number | null>) =>
    admin.from("activity_log").insert({ firm_id: firm, action: "drive.setup", entity_type: "account", entity_id: account.id, details });
  try {
    const drive = await openDrive(firm, account);
    const top = await drive.ensureFolder([]);
    // At Connect the folder order is always the first one: year, client, work.
    const year = financialYear(todayInIndia().slice(0, 7));
    // The test drive is shared by every firm on this computer, so it gets no client folders.
    const clients = account.provider === "local" ? [] : await pages((from) => admin.from("clients").select("name").eq("firm_id", firm).is("archived_at", null).order("id").range(from, from + 999));
    const made = new Set<string>();
    if (clients.length) {
      let cursor: string | undefined;
      do {
        const page = await drive.list(year, cursor);
        for (const entry of page.entries) made.add(entry.name);
        cursor = page.cursor ?? undefined;
      } while (cursor);
    }
    for (const client of clients) {
      const [, name] = folderPath("year_client_work", year, client.name, "other");
      if (made.has(name)) continue;
      if (Date.now() - started > 60_000) return { retry: "drive_setup_more", at: new Date() };
      await drive.ensureFolder([year, name]);
      made.add(name);
    }
    const test = new TextEncoder().encode("InboxCA saved this file to check that it can save and read files in your drive. It removes it at once.");
    const saved = await drive.save(top, `InboxCA check ${randomUUID().slice(0, 8)}.txt`, test);
    const readBack = saved !== "taken" && Buffer.from(await drive.read(saved.id)).equals(Buffer.from(test));
    if (saved !== "taken") await drive.trash(saved.id);
    const seen = await drive.check();
    const notices = (account.provider === "dropbox" && !!process.env.DROPBOX_APP_SECRET && !!(account.settings as { dropbox_account?: string }).dropbox_account) || (await watchDrive(firm, account));
    await logged({ reached: true, clients: clients.length, test_file: readBack, shared: seen.shared, free_bytes: seen.freeBytes, notices });
    return { done: true };
  } catch {
    if (job.attempts < MAX_ATTEMPTS) return { retry: "drive_unreachable" };
    await logged({ reached: false });
    return { fail: "drive_unreachable" };
  }
};
