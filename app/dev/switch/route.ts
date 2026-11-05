import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, newDeviceToken } from "@/src/lib/device";
import { DEMO_FIRM, demoEmail, demoKeyName, devLoginOpen, type DemoRole } from "@/src/lib/dev-login";
import { requestOrigin } from "@/src/lib/origin";
import { withThisComputer } from "@/src/lib/owner-device";
import { totp } from "@/src/lib/pc-key";
import { oneSession, PASSKEY_FACTOR } from "@/src/lib/sign-in";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

const notFound = () => new NextResponse(null, { status: 404 });
export const GET = notFound;

// The developer preview's switcher (src/lib/dev-login.ts): signs this browser in as a demo
// person through the same two steps as the sign in page, the email code from Supabase's admin
// side and the 2 step code from their key in .env.local, so the app then treats them exactly
// as that person. Not found unless every guard passes.
export async function POST(request: NextRequest) {
  if (!devLoginOpen(process.env, request.headers.get("host"), request.headers.get("origin"))) return notFound();
  const role = String((await request.formData()).get("role") ?? "");
  const email = demoEmail(role);
  const key = email ? process.env[demoKeyName(role as DemoRole)] : undefined;
  if (!email || !key) return notFound();
  const admin = supabaseAdmin();
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = users?.users.find((person) => person.email === email);
  const { data: member } = user
    ? await admin.from("firm_members").select("firm_id, firms!inner(name)").eq("user_id", user.id).eq("role", role).eq("status", "active").eq("firms.name", DEMO_FIRM).maybeSingle()
    : { data: null };
  if (!user || !member) return notFound();
  // The owner's login works only on computers already approved (src/lib/owner-device.ts): for the
  // demo owner the switcher approves this browser, as the owner's other computer would.
  if (role === "owner") {
    const jar = await cookies();
    if (!jar.has(DEVICE_COOKIE)) jar.set(DEVICE_COOKIE, newDeviceToken(), { httpOnly: true, maxAge: 365 * 24 * 60 * 60, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    await admin.auth.admin.updateUserById(user.id, { app_metadata: { devices: await withThisComputer(user.id, user.app_metadata.devices) } });
  }

  const supabase = await supabaseServer();
  const { data: before } = await supabase.auth.getSession();
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { error } = link?.properties ? await supabase.auth.verifyOtp({ email, token: link.properties.email_otp, type: "email" }) : { error: true };
  if (error) return NextResponse.redirect(`${requestOrigin(request)}/sign-in`, 303);
  if (before.session) await admin.auth.admin.signOut(before.session.access_token, "local");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((one) => one.status === "verified" && !one.friendly_name?.startsWith(PASSKEY_FACTOR));
  const { error: refused } = factor ? await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(key) }) : { error: true };
  if (refused) return NextResponse.redirect(`${requestOrigin(request)}/sign-in/two-step`, 303);
  await oneSession(supabase, user.id, email);
  return NextResponse.redirect(`${requestOrigin(request)}/app`, 303);
}
