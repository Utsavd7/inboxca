import { currentMember } from "@/src/lib/member";
import { newRecoveryCodes, recoveryDigest } from "@/src/lib/session";
import { supabaseAdmin } from "@/src/lib/supabase";

// The owner's 10 recovery codes (PLAN.md 5.17.4 #23), new each time and shown only in this
// download; earlier codes stop working. Logged.
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Not allowed", { status: 403 });
  const { userId, membership } = await currentMember();
  if (membership?.role !== "owner") return new Response("Not found", { status: 404 });
  const codes = newRecoveryCodes();
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { recovery: codes.map((code) => recoveryDigest(userId, code)) } });
  if (error) throw new Error(`Recovery codes not saved: ${error.code}`);
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "recovery.codes_made", entity_type: "user", entity_id: userId });
  return new Response(`InboxCA recovery codes for ${membership.email}\n\nIf you lose the phone with your 2 step code, sign in with the email code, choose Use a recovery code and type one of these. Each code works once.\n\n${codes.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inboxca-recovery-codes.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
