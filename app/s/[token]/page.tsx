import { createHash } from "node:crypto";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { dueLabel } from "@/src/lib/calendar";
import { supabaseAdmin } from "@/src/lib/supabase";
import "../../(app)/app/app.css";

export const metadata: Metadata = { title: "A document for you", robots: { index: false, follow: false } };

// Whether a link is still current: before its end time and under 5 downloads.
const current = (share: { link_expires_at: string; downloads: number }) => Date.parse(share.link_expires_at) > Date.now() && share.downloads < 5;

// The page a client reaches from a document the firm sent (PLAN.md 5.10, 8.6): no sign in,
// only the secure link. It names the file and offers its download, nothing else.
export default async function SharedDocument({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: share } = await supabaseAdmin()
    .from("shares")
    .select("link_expires_at, downloads, documents(name), firms(name)")
    .eq("link_token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();

  return (
    <main className="ui ui-public">
      <div className="public-body">
        {!share?.documents ? (
          <h1>This link is not valid.</h1>
        ) : (
          <>
            <p className="public-firm">{share.firms?.name}</p>
            <h1>{share.documents.name}</h1>
            {current(share) ? (
              <>
                <p className="hint">
                  This link works until {dueLabel(share.link_expires_at.slice(0, 10))}, for {5 - share.downloads} more {5 - share.downloads === 1 ? "download" : "downloads"}.
                </p>
                <a className="b b-primary public-download" href={`/s/${token}/file`} download>
                  <Download size={15} aria-hidden />
                  Download
                </a>
              </>
            ) : (
              <p className="hint">This link has expired or has been used up. Ask your CA&apos;s office to send the document again.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
