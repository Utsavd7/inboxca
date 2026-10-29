import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/src/lib/origin";
import { supabaseServer } from "@/src/lib/supabase";
import { finishSignUp } from "@/app/(auth)/sign-up/finish";

// The link in the sign in email, for the same device. It ends where typing the code
// ends: at the 2 step page, with the firm of a sign up in this browser made.
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) return NextResponse.redirect(`${origin}/sign-in?reason=link`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (data.user) await finishSignUp(data.user.id, data.user.email ?? "");
  return NextResponse.redirect(`${origin}${error ? "/sign-in?reason=link" : "/sign-in/two-step"}`);
}
