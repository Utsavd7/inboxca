import { NextResponse, type NextRequest } from "next/server";
import { dropboxNotice } from "@/src/lib/dropbox";
import { supabaseAdmin } from "@/src/lib/supabase";

// Dropbox's change notices (PLAN.md 5.5.1), off until DROPBOX_APP_SECRET is set. Dropbox
// checks this address once by asking it to echo a challenge, then posts the accounts whose
// files changed. A signed notice queues the drive check of each of those firms' drives, at the
// end of the 5 minutes it falls in, so a burst of changes is read once and the check sees all
// of them. Nothing in a drive is read here; Dropbox wants an answer within 10 seconds.
const WINDOW = 5 * 60_000;

export function GET(request: NextRequest) {
  if (!process.env.DROPBOX_APP_SECRET) return new NextResponse(null, { status: 404 });
  return new NextResponse(request.nextUrl.searchParams.get("challenge") ?? "", { headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  const secret = process.env.DROPBOX_APP_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  const accounts = dropboxNotice(new Uint8Array(await request.arrayBuffer()), request.headers.get("x-dropbox-signature"), secret);
  if (!accounts) return new NextResponse(null, { status: 403 });
  // Dropbox, not a person, calls here: the server key, only for the drives Dropbox named.
  const admin = supabaseAdmin();
  const at = new Date((Math.floor(Date.now() / WINDOW) + 1) * WINDOW).toISOString();
  for (let from = 0; from < accounts.length; from += 100) {
    const { data: drives, error } = await admin.from("connected_accounts").select("id, firm_id").eq("kind", "drive").eq("provider", "dropbox").in("settings->>dropbox_account", accounts.slice(from, from + 100));
    const queued = drives?.length
      ? await admin.from("jobs").upsert(drives.map((drive) => ({ firm_id: drive.firm_id, kind: "drive_check", entity_type: "account", entity_id: drive.id, idempotency_key: `drive_check:${drive.id}:${at}`, run_at: at })), { onConflict: "idempotency_key", ignoreDuplicates: true })
      : null;
    // Dropbox tries again for about ten minutes when the answer is not 200.
    if (error || queued?.error) return new NextResponse(null, { status: 503 });
  }
  return new NextResponse(null, { status: 200 });
}
