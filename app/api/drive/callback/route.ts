import { NextResponse, type NextRequest } from "next/server";
import { runJobsSoon } from "@/src/jobs/run-soon";
import { DRIVE_COOKIE, renewDrive, saveDrive } from "@/src/lib/drive-account";
import { dropboxConnect, dropboxDrive } from "@/src/lib/dropbox";
import { log } from "@/src/lib/logger";
import { currentMember } from "@/src/lib/member";
import { requestOrigin } from "@/src/lib/origin";

// Dropbox sends the owner back here after they press Allow. The state must match the one
// set at Connect; the refresh token is saved encrypted with the owner's consent, and
// InboxCA's own folder is made at once. A Reconnect names the drive it signs in to again,
// which keeps its record (renewDrive).
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const finish = (error?: string, saved?: string) => {
    const response = NextResponse.redirect(`${origin}/app/settings?group=email${error ? `&error=${error}` : saved ? `&saved=${saved}` : ""}#drive`);
    response.cookies.delete({ name: DRIVE_COOKIE, path: "/api/drive" });
    return response;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish("drive_denied");
  const saved = request.cookies.get(DRIVE_COOKIE)?.value;
  // A cookie that is not the one Connect set counts as none.
  let asked: { state?: string; verifier?: string; account?: string } = {};
  try {
    if (saved) asked = JSON.parse(Buffer.from(saved, "base64url").toString()) ?? {};
  } catch {
    asked = {};
  }
  const { state, verifier, account: again } = asked;
  const code = params.get("code");
  if (!state || !verifier || !code || params.get("state") !== state) return finish("drive_failed");
  const { supabase, userId, membership } = await currentMember();
  if (membership?.role !== "owner") return finish("drive_failed");
  try {
    const { refreshToken, email, account } = await dropboxConnect(code, verifier, `${origin}/api/drive/callback`);
    await dropboxDrive(refreshToken).ensureFolder([]);
    const [address, credentials] = [`Dropbox, ${email}`, JSON.stringify({ refreshToken })];
    const { error } = again
      ? await renewDrive(membership.firmId, String(again), userId, { address, credentials, dropboxAccount: account })
      : await saveDrive(supabase, membership.firmId, "dropbox", address, credentials, { dropbox_account: account });
    if (!error) runJobsSoon();
    return finish(error, again && "drive");
  } catch (error) {
    log.warn("drive.connect_failed", { provider: "dropbox", error: (error as Error).message });
    return finish("drive_failed");
  }
}
