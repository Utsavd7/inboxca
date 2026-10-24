import type { Metadata } from "next";
import "./(app)/app/app.css";
import { NotFoundLink } from "./not-found-link";

export const metadata: Metadata = { title: "Page not found | InboxCA", robots: { index: false, follow: false } };

// Any address the site does not have.
export default function NotFound() {
  return (
    <main className="ui ui-public">
      <div className="public-body">
        <p className="public-firm">InboxCA</p>
        <h1>Page not found</h1>
        <p className="hint">It may have been moved or removed, or the address was copied wrong.</p>
        <NotFoundLink />
      </div>
    </main>
  );
}
