import type { Metadata } from "next";
import { PublicPage } from "./public-link";
import { NotFoundLink } from "./not-found-link";

export const metadata: Metadata = { title: "Page not found | InboxCA", robots: { index: false, follow: false } };

// Any address the site does not have.
export default function NotFound() {
  return (
    <PublicPage
      band={
        <>
          <p className="public-firm">
            <strong>InboxCA</strong>
          </p>
          <h1>Page not found</h1>
        </>
      }
    >
      <div className="public-card">
        <p className="hint">It may have been moved or removed, or the address was copied wrong.</p>
        <NotFoundLink />
      </div>
    </PublicPage>
  );
}
