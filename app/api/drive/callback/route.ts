import { NextResponse, type NextRequest } from "next/server";
import { DRIVE_COOKIE, saveDrive } from "@/src/lib/drive-account";
import { dropboxConnect, dropboxDrive } from "@/src/lib/dropbox";
import { log } from "@/src/lib/logger";
import { currentMember } from "@/src/lib/member";
import { requestOrigin } from "@/src/lib/origin";

// Dropbox sends the owner back here after they press Allow. The state must match the one
// set at Connect; the refresh token is saved encrypted with the owner's consent, and
// InboxCA's own folder is made at once.
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const finish = (error?: string) => {
    const response = NextResponse.redirect(`${origin}/app/settings${error ? `?error=${error}` : ""}#drive`);
    response.cookies.delete({ name: DRIVE_COOKIE, path: "/api/drive" });
    return response;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish("drive_denied");
  const saved = request.cookies.get(DRIVE_COOKIE)?.value;
  const { state, verifier } = saved ? (JSON.parse(Buffer.from(saved, "base64url").toString()) as { state?: string; verifier?: string }) : {};
  const code = params.get("code");
  if (!state || !verifier || !code || params.get("state") !== state) return finish("drive_failed");
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") return finish("drive_failed");
  try {
    const { refreshToken, email } = await dropboxConnect(code, verifier, `${origin}/api/drive/callback`);
    await dropboxDrive(refreshToken).ensureFolder([]);
    const { error } = await saveDrive(supabase, membership.firmId, "dropbox", `Dropbox, ${email}`, JSON.stringify({ refreshToken }));
    return finish(error);
  } catch (error) {
    log.warn("drive.connect_failed", { provider: "dropbox", error: (error as Error).message });
    return finish("drive_failed");
  }
}
