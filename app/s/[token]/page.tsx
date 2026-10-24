import { createHash } from "node:crypto";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { dueLabel } from "@/src/lib/calendar";
import { supabaseAdmin } from "@/src/lib/supabase";
import { cookies } from "next/headers";
import { CODE_MINUTES, openCookie, opens } from "@/src/lib/share-codes";
import { FirmFoot, LinkEnded } from "@/app/public-link";
import { enterShareCode, requestShareCode } from "./actions";
import { masked, shareRecipient } from "./recipient";
import "../../(app)/app/app.css";

const codeNotes: Record<string, string> = {
  failed: "The code could not be emailed just now. Please try again in a few minutes.",
  wrong: "That code is not right. Check the latest email and try again.",
  again: "That code has expired or had too many tries. Ask for a new one.",
  limit: "Too many codes asked for today. Try again tomorrow, or ask your CA's office.",
};

export const metadata: Metadata = { title: "A document for you", robots: { index: false, follow: false } };

// Whether a link is still current: before its end time and under 5 downloads.
const current = (share: { link_expires_at: string | null; downloads: number }) => Date.parse(share.link_expires_at ?? "") > Date.now() && share.downloads < 5;

// The page a client reaches from a document the firm sent (PLAN.md 5.10, 8.6): no sign in,
// only the secure link. It names the file and offers its download, nothing else.
export default async function SharedDocument({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ code?: string }> }) {
  const [{ token }, { code }] = await Promise.all([params, searchParams]);
  const { data: share } = await supabaseAdmin()
    .from("shares")
    .select("id, firm_id, contact_id, needs_code, code_hash, link_expires_at, downloads, documents(name, client_id, clients(email_enc)), firms(name)")
    .eq("link_token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  // A private paper opens only after its one-time code, in this browser.
  const locked = !!share?.needs_code && !opens(share.id, (await cookies()).get(openCookie(share.id).name)?.value);
  const sentTo = share && locked && code === "sent" ? masked(await shareRecipient(share)) : "";

  return (
    <main className="ui ui-public">
      <div className="public-body">
        {!share?.documents ? (
          <LinkEnded />
        ) : (
          <>
            <p className="public-firm">{share.firms?.name}</p>
            <h1>{share.documents.name}</h1>
            {current(share) && locked ? (
              <>
                <p className="hint">This paper is private. We email a 6 digit code to the address it was sent to, and you type it here to open it.</p>
                {sentTo ? (
                  <p className="notice" role="status">
                    We sent a code to {sentTo}. It works for {CODE_MINUTES} minutes.
                  </p>
                ) : (
                  code &&
                  codeNotes[code] && (
                    <p className="alert" role="status">
                      {codeNotes[code]}
                    </p>
                  )
                )}
                {share.code_hash && code !== "again" ? (
                  <>
                    <form action={enterShareCode} className="public-code">
                      <input type="hidden" name="token" value={token} />
                      <label htmlFor="share-code">Code from the email</label>
                      <input id="share-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="num" autoFocus />
                      <button className="b b-primary" type="submit">
                        Open
                      </button>
                    </form>
                    <form action={requestShareCode} className="public-again">
                      <input type="hidden" name="token" value={token} />
                      <span className="hint">No email after a few minutes? Check spam, or</span>
                      <button className="b b-secondary" type="submit">
                        Send a new code
                      </button>
                    </form>
                  </>
                ) : (
                  <form action={requestShareCode}>
                    <input type="hidden" name="token" value={token} />
                    <button className="b b-primary public-download" type="submit">
                      Email me a code
                    </button>
                  </form>
                )}
              </>
            ) : current(share) ? (
              <>
                <p className="hint">
                  This link works until {dueLabel(share.link_expires_at!.slice(0, 10))}, for {5 - share.downloads} more {5 - share.downloads === 1 ? "download" : "downloads"}.
                </p>
                <a className="b b-primary public-download" href={`/s/${token}/file`} download>
                  <Download size={15} aria-hidden />
                  Download
                </a>
              </>
            ) : (
              <p className="hint">This link has ended or has been used up. Ask {share.firms?.name ?? "your CA's office"} to send the paper again.</p>
            )}
            {share.firms && <FirmFoot firmId={share.firm_id} name={share.firms.name} />}
          </>
        )}
      </div>
    </main>
  );
}
