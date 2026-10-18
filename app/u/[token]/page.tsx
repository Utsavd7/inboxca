import { createHash } from "node:crypto";
import { Check, FileUp } from "lucide-react";
import type { Metadata } from "next";
import { uploadToRequest } from "@/app/(app)/actions";
import { dueLabel } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { supabaseAdmin } from "@/src/lib/supabase";
import "../../(app)/app/app.css";

export const metadata: Metadata = { title: "Upload documents", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  file: "Choose a file of up to 25 MB.",
  later: "The upload could not be saved just now. Please try again in a few minutes.",
};

// Whether a link's end time is still ahead.
const current = (expiresAt: string | null) => Date.parse(expiresAt ?? "") > Date.now();

// The page a client reaches from a firm's request (PLAN.md 5.3.1, 8.6): no sign in, only the
// private link. It shows what the firm asked for and takes a file for each, straight into
// the client's folder in the firm's drive. It shows nothing else of the firm or client.
export default async function RequestUpload({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; got?: string }> }) {
  const [{ token }, { error, got }] = await Promise.all([params, searchParams]);
  const { data: request } = await supabaseAdmin()
    .from("requests")
    .select("status, expires_at, details, clients(name), firms(name)")
    .eq("kind", "documents")
    .eq("details->>link_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  const open = request?.status === "pending" && current(request.expires_at);
  const details = request?.details as unknown as DocumentRequest | undefined;

  return (
    <main className="ui ui-public">
      <div className="public-body">
        {!request || !details ? (
          <h1>This link is not valid.</h1>
        ) : (
          <>
            <p className="public-firm">{request.firms?.name}</p>
            <h1>Documents for {request.clients?.name}</h1>
            <p className="hint">
              {details.period ? `For ${periodName(details.period)}. ` : ""}
              {open ? `This link works until ${dueLabel(request.expires_at!.slice(0, 10))}. Files go straight to your CA's office.` : request.status === "done" ? "Everything asked for has arrived. Thank you." : "This link has expired. Ask your CA's office for a new one."}
            </p>
            {error && errors[error] && (
              <p className="alert" role="alert">
                {errors[error]}
              </p>
            )}
            {got !== undefined && details.items[Number(got)] && (
              <p className="notice" role="status">
                Received: {details.items[Number(got)].type}.
              </p>
            )}
            <ul className="public-items">
              {details.items.map((item, at) => (
                <li key={at}>
                  <span className={`public-tick${item.received.length ? " done" : ""}`}>{item.received.length ? <Check size={14} aria-label="Received" /> : at + 1}</span>
                  <span className="grow">
                    <strong>{item.type}</strong>
                    {!!item.received.length && <span className="sub">{item.received.length === 1 ? "1 file received" : `${item.received.length} files received`}</span>}
                  </span>
                  {open && (
                    <form action={uploadToRequest} className="public-upload">
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="item" value={at} />
                      <input name="file" type="file" required aria-label={`File for ${item.type}`} />
                      <button className="b b-primary b-small" type="submit">
                        <FileUp size={14} aria-hidden />
                        Upload
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
