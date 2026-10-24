"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";

// Whether this browser holds a sign in session. Read here, not on the server, so the page
// stays static and the site's own pages with it; the app checks the session itself.
const signedIn = () => /(^|; )sb-[^=]+-auth-token/.test(document.cookie);

// The way back from a missing page: Today for someone signed in, the home page for others.
export function NotFoundLink() {
  const inside = useSyncExternalStore(() => () => {}, signedIn, () => false);
  return (
    <Link className="b b-primary public-download" href={inside ? "/app" : "/"}>
      {inside ? "Go to Today" : "Go to Home"}
    </Link>
  );
}
