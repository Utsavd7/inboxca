import type { Json } from "@/src/db/types";
import { formulaSchema, planSchema } from "./billing/money";
import { todayInIndia } from "./calendar";
import { estimate, type Formula, type Practice } from "./estimate";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

// Fair use of downloads through InboxCA (PLAN.md D26, 5.14): papers read from the firm's drive
// and sent on by InboxCA's server, by the owner, staff or a client's link. Counted each month,
// India time, from the activity log that already records every one; nothing else is stored.
// Views in the viewer, approved filing files and the firm's own data download are never
// counted or paused, and papers opened in the drive itself never pass through InboxCA.
const DOWNLOADED = ["document.downloaded", "document.downloaded_by_client"] as const;

export async function downloadUse(firmId: string, admin = supabaseAdmin()) {
  const month = todayInIndia().slice(0, 7);
  const since = new Date(`${month}-01T00:00:00+05:30`).toISOString();
  const [downloads, allowed, { data: setting }, { data: sub }] = await Promise.all([
    admin.from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", firmId).in("action", DOWNLOADED).gte("at", since),
    admin.from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", firmId).eq("action", "usage.downloads_allowed").gte("at", since),
    admin.from("platform_settings").select("value").eq("key", "plan_formula").maybeSingle(),
    admin.from("subscriptions").select("plan").eq("firm_id", firmId).maybeSingle(),
  ]);
  if (downloads.error || allowed.error) throw new Error("Downloads not counted");
  const used = downloads.count ?? 0, okays = allowed.count ?? 0;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
  const formula = formulaSchema.safeParse(setting?.value);
  const perReturn = (setting?.value as { fairUse?: { downloadsAMonthPerReturn?: number } } | undefined)?.fairUse?.downloadsAMonthPerReturn;
  // A missing formula never stops a download; it is logged.
  if (!formula.success || !perReturn) {
    log.warn("downloads.no_fair_use");
    return { used, most: Infinity, okays, month, next };
  }
  // The plan's returns a year: a preset's, Custom's work size, or the smallest plan's before one is paid.
  const plan = planSchema.safeParse(sub?.plan);
  const fit = plan.success ? estimate(plan.data.clients, plan.data.practice as Practice, plan.data.people, formula.data as unknown as Formula, plan.data.returns) : null;
  const returns = !fit ? formula.data.plans[0].maxReturns : fit.custom ? fit.storageGb * formula.data.custom.returnsPerStep : formula.data.plans[fit.index].maxReturns;
  // Each OK the owner gives in Settings adds another month's downloads.
  return { used, most: Math.round(returns * perReturn) * (1 + okays), okays, month, next };
}

// Whether `count` more downloads fit this month. From 80% the owner is told once, and again
// when downloads pause (usage_alert); after an OK, once more for the larger figure.
export async function mayDownload(firmId: string, count = 1) {
  const admin = supabaseAdmin();
  const use = await downloadUse(firmId, admin);
  const fits = use.used + count <= use.most;
  const stage = !fits ? "downloads_100" : use.used + count >= 0.8 * use.most ? "downloads_80" : null;
  if (stage) {
    const { error } = await admin.from("jobs").upsert({ firm_id: firmId, kind: "usage_alert", entity_type: "firm", entity_id: firmId, idempotency_key: `usage_alert:${stage}:${firmId}:${use.month}:${use.okays}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) log.warn("downloads.alert_not_queued", { code: error.code });
  }
  return fits;
}

// The downloads' log lines, added only while they fit this month's downloads: counted and added in
// one database step under the firm's lock, so downloads at the same moment never pass the figure.
// False, and nothing logged, when they do not fit; mayDownload is the quick check before the drive
// is read.
export type DownloadLine = { actor_id?: string | null; action: (typeof DOWNLOADED)[number]; entity_id: string; details?: Record<string, unknown> };
export async function logDownloads(firmId: string, lines: DownloadLine[]) {
  const admin = supabaseAdmin();
  const { most } = await downloadUse(firmId, admin);
  const { data, error } = await admin.rpc("claim_downloads", { target_firm: firmId, lines: lines as unknown as Json, ...(Number.isFinite(most) && { most }) });
  if (error) throw new Error(`Downloads not counted: ${error.code}`);
  return data;
}

// What a download address answers once this month's downloads are used.
export const PAUSED = {
  owner: "Your firm has used this month's downloads through InboxCA. Allow more in Settings, Your data, or open the paper in your drive.",
  staff: "Your firm has used this month's downloads through InboxCA. The owner has been told and can allow more.",
  client: "This paper cannot be downloaded just now. Your CA's office has been told. Please try again later.",
};
