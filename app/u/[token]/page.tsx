import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { FirmFoot, LinkEnded } from "@/app/public-link";
import { dueLabel } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { supabaseAdmin } from "@/src/lib/supabase";
import "../../(app)/app/app.css";
import { AddFiles } from "./add-files";

export const metadata: Metadata = { title: "Upload documents", robots: { index: false, follow: false } };

// Whether a link's end time is still ahead.
const current = (expiresAt: string | null) => Date.parse(expiresAt ?? "") > Date.now();

// The page a client reaches from a firm's request (PLAN.md 5.3.1, 8.6): no sign in, only the
// private link. It shows what the firm asked for and takes files for each, straight into
// the client's folder in the firm's drive. It shows nothing else of the firm or client but
// how to reach the firm.
export default async function RequestUpload({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: request } = await supabaseAdmin()
    .from("requests")
    .select("firm_id, status, expires_at, details, clients(name), firms(name)")
    .eq("kind", "documents")
    .eq("details->>link_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  const open = request?.status === "pending" && current(request.expires_at);
  const details = request?.details as unknown as DocumentRequest | undefined;

  return (
    <main className="ui ui-public">
      <div className="public-body">
        {!request || !details ? (
          <LinkEnded />
        ) : (
          <>
            <p className="public-firm">{request.firms?.name}</p>
            <h1>Documents for {request.clients?.name}</h1>
            <p className="hint">
              {details.period ? `For ${periodName(details.period)}. ` : ""}
              {open
                ? `Add each paper below and it goes straight to your CA's office. This link works until ${dueLabel(request.expires_at!.slice(0, 10))}.`
                : request.status === "done"
                  ? "Everything asked for has arrived. Thank you."
                  : `This link has ended. Ask ${request.firms?.name ?? "your CA's office"} to send a new one.`}
            </p>
            <ul className="public-items">
              {details.items.map((item, at) => (
                <li key={at}>
                  <AddFiles token={token} item={at} type={item.type} received={item.received.length} open={open} />
                </li>
              ))}
            </ul>
            {request.firms && <FirmFoot firmId={request.firm_id} name={request.firms.name} />}
          </>
        )}
      </div>
    </main>
  );
}
