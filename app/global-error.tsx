"use client";
import "./globals.css";

// The last catch, when even the page frame failed to open: InboxCA's own plain page with Try
// again and the way back, instead of the browser's technical one.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-IN">
      <body>
        <title>Page did not open | InboxCA</title>
        <main className="plain-page">
          <header className="public-band">
            <p className="public-firm">
              <strong>InboxCA</strong>
            </p>
            <h1>This page did not open</h1>
          </header>
          <div className="public-body">
            <div className="public-card">
              <p className="hint">InboxCA could not open this page just now. Nothing was changed. Try again in a minute.</p>
              <p className="form-row">
                <button className="b b-primary" type="button" onClick={() => retry()}>
                  Try again
                </button>
                <a className="b b-secondary" href="/app">
                  Go to Today
                </a>
              </p>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
