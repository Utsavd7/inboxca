import { supabaseAdmin } from "./supabase";
import type { Right } from "./rights";

// The person's unused grant for a right on a client (and file), if they have one now.
export async function grantFor(firmId: string, userId: string, right: Right, clientId: string, documentId?: string) {
  let query = supabaseAdmin()
    .from("requests")
    .select("id")
    .eq("firm_id", firmId)
    .eq("kind", "permission")
    .eq("status", "approved")
    .eq("reason_code", right)
    .eq("client_id", clientId)
    .eq("details->>by", userId)
    .gt("expires_at", new Date().toISOString());
  if (documentId) query = query.eq("details->>document_id", documentId);
  return (await query.limit(1).maybeSingle()).data?.id ?? null;
}
