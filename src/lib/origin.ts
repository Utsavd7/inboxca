import type { NextRequest } from "next/server";

// The address the visitor used, for redirects that must keep the session cookie (the
// server's own idea of its address can differ, such as localhost for 127.0.0.1).
export function requestOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const scheme = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  return host ? `${scheme}://${host}` : request.nextUrl.origin;
}
