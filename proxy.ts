import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, newDeviceToken } from "@/src/lib/device";

// Keeps the sign in session fresh on the product's pages. It decides nothing: each page
// checks the session and the 2 step level itself, and the database checks again.
// The public site never runs this, so its pages stay static and fast.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (data?.claims && !request.cookies.has(DEVICE_COOKIE)) {
    const authCookies = response.cookies.getAll();
    const authHeaders = [...response.headers];
    const token = newDeviceToken();
    request.cookies.set(DEVICE_COOKIE, token);
    response = NextResponse.next({ request });
    for (const cookie of authCookies) response.cookies.set(cookie);
    for (const [name, value] of authHeaders) response.headers.set(name, value);
    response.cookies.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/sign-in/:path*", "/auth/:path*"],
};
