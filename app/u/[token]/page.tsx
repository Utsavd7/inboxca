import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { FirmFoot, LinkEnded, PublicPage } from "@/app/public-link";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { askName } from "@/src/lib/paper-type";
import { nextFollowUp } from "@/src/lib/reminders";
import { supabaseAdmin } from "@/src/lib/supabase";
import { AddFiles } from "./add-files";

export const metadata: Metadata = { title: "Upload documents", robots: { index: false, follow: false } };

// Whether a link's end time is still ahead.
const current = (expiresAt: string | null) => Date.parse(expiresAt ?? "") > Date.now();
const papers = (count: number) => (count === 1 ? "1 paper" : `${count} papers`);
const list = (items: { type: string }[]) => items.map((item) => askName(item.type)).join(", ");

// The page a client reaches from a firm's request (PLAN.md 5.3.1, 8.6): no sign in, only the
// private link. It shows what the firm asked for, how much has arrived, and takes files for
// each, straight into the client's folder in the firm's drive. After the last paper it thanks
// them. It shows nothing else of the firm or client but how to reach the firm.
export default async function RequestUpload({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: request } = await supabaseAdmin()
    .from("requests")
    .select("firm_id, status, expires_at, details, clients(name, email_enc, reminders_paused), firms(name, settings)")
    .eq("kind", "documents")
    .eq("details->>link_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  const details = request?.details as unknown as DocumentRequest | undefined;
  if (!request?.firms || !details) return <LinkEnded />;
  const open = request.status === "pending" && current(request.expires_at);
  const done = request.status === "done";
  const firm = request.firms.name;
  const total = details.items.length;
  const arrived = details.items.filter((item) => item.received.length);
  const needed = details.items.filter((item) => !item.received.length);
  const got = arrived.length;
  // A receipt follows by email when the firm's mailbox can send one to the client.
  const { data: mailbox } = done && request.clients?.email_enc ? await supabaseAdmin().from("connected_accounts").select("status").eq("firm_id", request.firm_id).eq("kind", "mail").maybeSingle() : { data: null };
  // The next reminder email for this request, when the firm has them on for this client
  // (src/jobs/reminders.ts sends it); nothing when none is planned.
  const reminders = (request.firms.settings as { reminders?: boolean }).reminders === true && !!request.clients?.email_enc && !request.clients.reminders_paused;
  const next = open && reminders ? nextFollowUp({ expires_at: request.expires_at!, details }, todayInIndia()) : null;

  return (
    <PublicPage
      firm={firm}
      band={
        <>
          <h1>{done ? `Thank you. ${firm} has all ${papers(total)}.` : open ? `${firm} needs ${papers(total)}. This link works until ${dueLabel(request.expires_at!.slice(0, 10))}.` : "This link has ended"}</h1>
          <p className="public-for">
            Papers for {request.clients?.name}
            {details.period ? `, ${periodName(details.period)}` : ""}
          </p>
        </>
      }
    >
      {done ? (
        <section className="public-card public-thanks" aria-label="All received">
          <span className="public-big-tick" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
            </svg>
          </span>
          <h2>All {papers(total)} received</h2>
          <p>Everything asked for has arrived. You can close this page.</p>
          {mailbox?.status === "connected" && <p className="hint">A receipt listing what you sent is on its way to your email.</p>}
        </section>
      ) : (
        <section className="public-card public-progress" aria-label="Progress">
          <p aria-live="polite">
            <strong className="num">{got}</strong> of {papers(total)} received
          </p>
          <span className="public-bar" aria-hidden>
            <span style={{ "--got": got / total } as React.CSSProperties} />
          </span>
          <p className="hint">{open ? `Add each paper below. It goes straight to ${firm}.` : `Ask ${firm} to send a new one.`}</p>
          {open && (
            <p className="hint">
              Still needed: {list(needed)}.{!!got && ` Arrived: ${list(arrived)}.`}
              {next && ` Next reminder from ${firm}: ${next === todayInIndia() ? "today" : dueLabel(next)}.`}
            </p>
          )}
          {open && <p className="hint">If a file has a password, you will be asked for it once.</p>}
        </section>
      )}
      <ul className="public-items" aria-label={done ? "What you sent" : "Papers asked for"}>
        {details.items.map((item, at) => (
          <AddFiles key={at} token={token} item={at} type={item.type} received={item.received.length} open={open} />
        ))}
      </ul>
      <FirmFoot firmId={request.firm_id} name={firm} />
    </PublicPage>
  );
}
