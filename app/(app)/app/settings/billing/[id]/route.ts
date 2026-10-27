import { docHtml, type Doc } from "@/src/lib/billing/documents";
import { currentMember } from "@/src/lib/member";
import { plainPage } from "@/src/lib/plain-page";

// A receipt, tax invoice, credit note or refund receipt as issued (PLAN.md 5.14.1), on a plain
// page to print or save as a PDF. Read as the owner: nobody else sees the firm's payments.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, membership } = await currentMember();
  const { id } = await params;
  if (membership?.role !== "owner") return plainPage(404, "Only the owner sees the firm's receipts.", "/app", "Go to Today");
  const { data } = /^[0-9a-f-]{36}$/.test(id) ? await supabase.from("payments").select("doc").eq("id", id).maybeSingle() : { data: null };
  if (!data?.doc) return plainPage(404, "This receipt is not ready yet.", "/app/settings?group=billing", "Go to Billing");
  return new Response(docHtml(data.doc as unknown as Doc), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" },
  });
}
