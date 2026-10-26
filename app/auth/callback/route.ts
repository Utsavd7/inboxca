import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/src/lib/logger";
import { mailboxLogin } from "@/src/lib/mailbox-login";
import { requestOrigin } from "@/src/lib/origin";
import { afterFirstStep, inNoFirm, isProvider, refusal } from "@/src/lib/sign-in";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

// Back from Google or Microsoft through Supabase Auth: the code becomes the session, then the
// same steps as after the email code (the 2 step code, or the office PC's shortcut). Someone
// in no firm yet sets one up. Anything else goes back to sign in with one plain line, and
// the log names only the provider and the error code, never a code or a token.
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const params = request.nextUrl.searchParams;
  const via = isProvider(params.get("via")) ? params.get("via") : "google";
  const back = (reason: string) => NextResponse.redirect(`${origin}/sign-in?reason=${reason}&via=${via}`);
  const code = params.get("code");
  if (!code) {
    log.info("sign_in.provider_refused", { provider: via, error: params.get("error")?.slice(0, 40), code: params.get("error_code")?.slice(0, 60) });
    return back(refusal(params));
  }
  const supabase = await supabaseServer();
  // A shared PC (5.17.4 #3): whoever was signed in on this browser before is signed out.
  const { data: before } = await supabase.auth.getSession();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    log.warn("sign_in.provider_exchange_failed", { provider: via, code: error?.code, status: error?.status });
    return back("provider");
  }
  if (before.session && before.session.access_token !== data.session.access_token)
    await supabaseAdmin().auth.admin.signOut(before.session.access_token, "local");
  const email = data.user.email ?? "";
  // Supabase links an address only once the provider has confirmed it; this checks again, in
  // case its email confirmations are off.
  const verified = data.user.identities?.find((identity) => identity.provider === via)?.identity_data?.email_verified === true;
  const refused = !email || !verified ? "unverified" : (await mailboxLogin(email)) ? "mailbox" : null;
  if (refused) {
    log.info("sign_in.provider_refused", { provider: via, code: refused });
    await supabase.auth.signOut({ scope: "local" });
    return back(refused);
  }
  if (await inNoFirm(data.user.id)) return NextResponse.redirect(`${origin}/sign-up`);
  return NextResponse.redirect(`${origin}${await afterFirstStep(supabase, data.user.id, email)}`);
}
