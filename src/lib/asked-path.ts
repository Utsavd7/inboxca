// A link a signed out person opened (from a notification email, say) is kept through sign in in
// an HttpOnly cookie for 15 minutes, then opened once (proxy.ts, landing in sign-in.ts). Only a
// page of the app on this site counts: "/app/..." with no "//", backslash or control character,
// at most 500 characters, and still under /app/ once dot segments are read; else no link.
export const ASKED_COOKIE = "asked_path";
const BASE = "http://inboxca.invalid";

export function askedPath(path: string | undefined) {
  if (!path || path.length > 500 || !path.startsWith("/app/") || path.includes("//") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  const url = new URL(path, BASE);
  return url.origin === BASE && url.pathname.startsWith("/app/") ? url.pathname + url.search : null;
}
