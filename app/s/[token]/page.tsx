import { createHash } from "node:crypto";
import { CalendarClock, Download, FileText, Lock, Mail } from "lucide-react";
import type { Metadata } from "next";
import { dueLabel } from "@/src/lib/calendar";
import { supabaseAdmin } from "@/src/lib/supabase";
import { cookies } from "next/headers";
import { CODE_MINUTES, openCookie, opens } from "@/src/lib/share-codes";
import { storage } from "@/app/(app)/app/ui";
import { FirmFoot, LinkEnded, PublicPage } from "@/app/public-link";
import { enterShareCode, requestShareCode } from "./actions";
import { masked, shareRecipient } from "./recipient";

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
// only the secure link. It names the file, its size, how long the link lasts and how many
// downloads are left, and offers its download, nothing else.
export default async function SharedDocument({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ code?: string }> }) {
  const [{ token }, { code }] = await Promise.all([params, searchParams]);
  const { data: share } = await supabaseAdmin()
    .from("shares")
    .select("id, firm_id, contact_id, needs_code, code_hash, link_expires_at, downloads, documents(name, size, client_id, clients(email_enc)), firms(name)")
    .eq("link_token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  // A private paper opens only after its one-time code, in this browser.
  const locked = !!share?.needs_code && !opens(share.id, (await cookies()).get(openCookie(share.id).name)?.value);
  const sentTo = share && locked && code === "sent" ? masked(await shareRecipient(share)) : "";

  if (!share?.documents || !share.firms) return <LinkEnded />;
  const left = 5 - share.downloads;

  return (
    <PublicPage
      firm={share.firms.name}
      band={
        <>
          <h1 className="public-doc">{locked ? "A private paper for you" : share.documents.name}</h1>
          <p className="public-for">Shared with you by {share.firms.name}</p>
        </>
      }
    >
      {current(share) ? (
        <section className="public-card public-file" aria-label="The paper">
          <p className="public-file-head">
            <span className="public-file-icon" aria-hidden>
              {locked ? <Lock size={20} /> : <FileText size={20} />}
            </span>
            <span>
              <strong>{/\.(\w+)$/.exec(share.documents.name)?.[1].toUpperCase() ?? "A"} file</strong>
              <span className="sub">{storage(share.documents.size)}</span>
            </span>
          </p>
          <ul className="public-facts">
            <li>
              <CalendarClock size={16} aria-hidden />
              Link works until {dueLabel(share.link_expires_at!.slice(0, 10))}
            </li>
            <li>
              <Download size={16} aria-hidden />
              {left} {left === 1 ? "download" : "downloads"} left
            </li>
          </ul>
          {locked ? (
            <div className="public-step">
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
                    <button className="b b-ghost" type="submit">
                      Send a new code
                    </button>
                  </form>
                </>
              ) : (
                <form action={requestShareCode}>
                  <input type="hidden" name="token" value={token} />
                  <button className="b b-primary public-download" type="submit">
                    <Mail size={18} aria-hidden />
                    Email me a code
                  </button>
                </form>
              )}
            </div>
          ) : (
            <a className="b b-primary public-download" href={`/s/${token}/file`} download>
              <Download size={18} aria-hidden />
              Download
            </a>
          )}
        </section>
      ) : (
        <p className="public-card hint">This link has ended or has been used up. Ask {share.firms.name} to send the paper again.</p>
      )}
      <FirmFoot firmId={share.firm_id} name={share.firms.name} />
    </PublicPage>
  );
}
