import { currentMember } from "@/src/lib/member";
import { newRecoveryCodes, recoveryDigest } from "@/src/lib/session";
import { plainPage } from "@/src/lib/plain-page";
import { supabaseAdmin } from "@/src/lib/supabase";

// The owner's 10 recovery codes (PLAN.md 5.17.4 #23), new each time and shown only in this
// download; earlier codes stop working. Logged.
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_BASE_URL ?? request.url).origin;
  if (request.headers.get("origin") !== origin) return plainPage(403, "This download could not start. Go back to Settings and try again.", "/app/settings", "Go to Settings");
  const { userId, membership } = await currentMember();
  if (membership?.role !== "owner") return plainPage(404, "Only the owner has recovery codes.", "/app", "Go to Today");
  const codes = newRecoveryCodes();
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { recovery: codes.map((code) => recoveryDigest(userId, code)) } });
  if (error) return plainPage(503, "InboxCA could not make new codes just now. Your old codes still work. Try again in a minute.", "/app/settings", "Go to Settings");
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: userId, action: "recovery.codes_made", entity_type: "user", entity_id: userId });
  return new Response(`InboxCA recovery codes for ${membership.email}\n\nIf you lose the phone that gives your 2 step code, sign in with the email code. Then choose Lost your phone? Use a recovery code, and type one of these codes. Each code works once. If you download new codes, these stop working.\n\n${codes.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inboxca-recovery-codes.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
