import type { Metadata } from "next";
import { NotFoundLink } from "./not-found-link";

export const metadata: Metadata = { title: "Page not found | InboxCA", robots: { index: false, follow: false } };

// Any address the site does not have. Its styles are the site's own (globals.css .plain-page):
// this page's style sheets load on every site page.
export default function NotFound() {
  return (
    <main className="plain-page">
      <header className="public-band">
        <p className="public-firm">
          <strong>InboxCA</strong>
        </p>
        <h1>Page not found</h1>
      </header>
      <div className="public-body">
        <div className="public-card">
          <p className="hint">It may have been moved or removed, or the address was copied wrong.</p>
          <NotFoundLink />
        </div>
      </div>
    </main>
  );
}
