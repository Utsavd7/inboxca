import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requestAddress } from "@/src/lib/office";
import { onedriveReady, watchCheck } from "@/src/lib/onedrive";
import { withinLimit } from "@/src/lib/rate-limit";
import { supabaseAdmin } from "@/src/lib/supabase";

// OneDrive's change notices (PLAN.md 5.5.1), off until InboxCA's Microsoft drive app is set up.
// Microsoft checks this address when a watch is made by asking it to echo a validationToken,
// then posts, for each watch with changes or to be authorized again, its id and the secret it
// was made with (watchDrive). A notice whose secret matches its watch's queues that drive's check
// at the end of the 5 minutes it falls in, as Dropbox's; nothing else in a notice is used, and
// nothing in a drive is read here. Microsoft wants an answer within 3 seconds.
const WINDOW = 5 * 60_000;

export async function POST(request: NextRequest) {
  if (!onedriveReady()) return new NextResponse(null, { status: 404 });
  // Anyone can post here. Microsoft tries a refused notice again later, for up to 4 hours.
  if (!(await withinLimit("notice", requestAddress(request.headers)))) return new NextResponse(null, { status: 429 });
  const token = request.nextUrl.searchParams.get("validationToken");
  if (token !== null) return new NextResponse(token, { headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" } });
  const body = (await request.json().catch(() => null)) as { value?: { subscriptionId?: unknown; clientState?: unknown }[] } | null;
  const asked = new Map<string, string>();
  for (const notice of Array.isArray(body?.value) ? body.value.slice(0, 100) : [])
    if (typeof notice?.subscriptionId === "string" && /^[\w-]{1,100}$/.test(notice.subscriptionId) && typeof notice.clientState === "string") asked.set(notice.subscriptionId, watchCheck(notice.clientState));
  if (!asked.size) return new NextResponse(null, { status: 202 });
  // Microsoft, not a person, calls here: the server key, only for the watches named.
  const admin = supabaseAdmin();
  const { data: drives, error } = await admin.from("connected_accounts").select("id, firm_id, settings").eq("kind", "drive").eq("provider", "onedrive").in("settings->onedrive_notices->>id", [...asked.keys()]);
  const noticed = (drives ?? []).filter((drive) => {
    const watch = (drive.settings as { onedrive_notices?: { id: string; check: string } }).onedrive_notices;
    const [given, kept] = [Buffer.from(asked.get(watch?.id ?? "") ?? ""), Buffer.from(watch?.check ?? "")];
    return given.length > 0 && given.length === kept.length && timingSafeEqual(given, kept);
  });
  const at = new Date((Math.floor(Date.now() / WINDOW) + 1) * WINDOW).toISOString();
  const queued = noticed.length
    ? await admin.from("jobs").upsert(noticed.map((drive) => ({ firm_id: drive.firm_id, kind: "drive_check", entity_type: "account", entity_id: drive.id, idempotency_key: `drive_check:${drive.id}:${at}`, run_at: at })), { onConflict: "idempotency_key", ignoreDuplicates: true })
    : null;
  if (error || queued?.error) return new NextResponse(null, { status: 503 });
  return new NextResponse(null, { status: 202 });
}
