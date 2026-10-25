import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/src/lib/origin";
import { SEEN_COOKIE } from "@/src/lib/session";
import { supabaseServer } from "@/src/lib/supabase";

// Signs this browser out when a firm's limit is reached (reason: idle, session or country), and
// says why on the sign in page. Other devices stay signed in.
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  const asked = request.nextUrl.searchParams.get("reason") ?? "";
  const reason = ["session", "country"].includes(asked) ? asked : "idle";
  const response = NextResponse.redirect(`${requestOrigin(request)}/sign-in?reason=${reason}`);
  response.cookies.delete(SEEN_COOKIE);
  return response;
}
