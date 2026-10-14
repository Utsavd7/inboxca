import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/src/lib/supabase";

// The link in the sign in email, for the same device. It ends where typing the code
// ends: at the 2 step page.
export async function GET(request: NextRequest) {
  // Redirect on the address the visitor used, so the session cookie set here comes along
  // (the server's own idea of its address can differ, such as localhost for 127.0.0.1).
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const scheme = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  const origin = host ? `${scheme}://${host}` : request.nextUrl.origin;
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) return NextResponse.redirect(`${origin}/sign-in?link=expired`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  return NextResponse.redirect(`${origin}${error ? "/sign-in?link=expired" : "/sign-in/two-step"}`);
}
