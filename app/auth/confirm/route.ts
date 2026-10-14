import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/src/lib/origin";
import { supabaseServer } from "@/src/lib/supabase";

// The link in the sign in email, for the same device. It ends where typing the code
// ends: at the 2 step page.
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) return NextResponse.redirect(`${origin}/sign-in?reason=link`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  return NextResponse.redirect(`${origin}${error ? "/sign-in?reason=link" : "/sign-in/two-step"}`);
}
