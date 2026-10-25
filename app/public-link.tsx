import { Lock, Mail } from "lucide-react";
import { initials } from "@/app/(app)/app/ui";
import { firmAddress } from "@/src/lib/firm-mail";
import "./(app)/app/app.css";
import "./public-link.css";

// A client's private link page: the firm's band (its initials, its name, what the page is
// for), then the page's own content. On a phone the band sits on top; on a laptop, beside.
export function PublicPage({ firm, band, children }: { firm?: string; band: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="ui ui-public">
      <header className="public-band">
        {firm && (
          <p className="public-firm">
            <span className="public-tile" aria-hidden>
              {initials(firm)}
            </span>
            <strong>{firm}</strong>
          </p>
        )}
        {band}
        {firm && (
          <p className="public-private">
            <Lock size={13} aria-hidden />
            Private link, only for you
          </p>
        )}
      </header>
      <div className="public-body">{children}</div>
    </main>
  );
}

// What a client's private link shows when it is wrong or no longer known: nothing of the
// firm or the link, only what to do next.
export function LinkEnded() {
  return (
    <PublicPage band={<h1>This link has ended or was copied wrong.</h1>}>
      <p className="public-card hint">Ask your CA&apos;s office to send a new one.</p>
    </PublicPage>
  );
}

// The foot of a client's private link: the firm and how to reach it.
export async function FirmFoot({ firmId, name }: { firmId: string; name: string }) {
  const email = await firmAddress(firmId);
  return (
    <footer className="public-foot">
      <Mail size={16} aria-hidden />
      <span>
        <strong>{name}</strong>
        {email && (
          <span>
            Questions? Email <a href={`mailto:${email}`}>{email}</a>
          </span>
        )}
      </span>
    </footer>
  );
}
