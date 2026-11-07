import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

// The passkey proof for this session (PLAN.md 8.1), made by the server after a passkey check and
// sent to the database with every console request.
export const PROOF_COOKIE = "orelu_admin_proof";

// A listed admin past the 2 step code, before the passkey check. Anyone else meets a missing page.
export async function listedAdmin() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const userId = claims.claims.sub;
  const { data: listed } = await supabaseAdmin().from("orelu_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!listed) notFound();
  return { userId, session: String(claims.claims.session_id ?? ""), email: String(claims.claims.email ?? "") };
}

// The signed in Orelu admin with a passkey checked in this session, for every admin page and
// action. The database's admin functions refuse anyone else again.
export const currentAdmin = cache(async () => {
  const proof = (await cookies()).get(PROOF_COOKIE)?.value;
  const supabase = await supabaseServer(proof ? { "x-orelu-admin": proof } : undefined);
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data: admin } = await supabase.rpc("is_orelu_admin");
  if (!admin) {
    await listedAdmin();
    redirect("/sign-in/passkey");
  }
  return { supabase, userId: claims.claims.sub, email: String(claims.claims.email ?? "") };
});

// "25 Oct, 09:30" in India time.
export const when = (at: string | null) =>
  at ? new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "Never";

// Long lists show 50 rows a page: the page asked for, and its first and last row.
export const PAGE = 50;
export const pageRows = (asked?: string) => {
  const page = Math.max(1, Math.floor(Number(asked)) || 1);
  return { page, from: (page - 1) * PAGE, to: page * PAGE - 1 };
};

// Each job by what it does (src/jobs/handlers.ts), so a failed one reads as work, not a code.
export const jobNames: Record<string, string> = {
  regenerate_form: "Make a return file again", fill_return: "Fill a return", form_ack: "Read a filing acknowledgement", read_portal: "Read a portal file",
  read_sales: "Read a sales register", mailbox_reconnect: "Ask to connect the mailbox again", bulk_send: "Send papers to many clients", return_alert: "Return alert",
  notice_alert: "Notice alert", office_housekeeping: "Office only upkeep", calendar_top_up: "Add the next due dates", mail_poll: "Read new email",
  file_mail: "File an email's papers", drive_purge: "Empty removed papers", drive_check: "Check drive space", drive_setup: "Set up the drive folders",
  read_document: "Read a paper", file_link: "Save a file from a link", import_files: "Import files", undo_import: "Undo an import", reminders: "Send reminders",
  records_reply: "Reply from records", answer_mail: "Answer an email", reply_waiting: "Waiting replies list", notice_from_mail: "Read a notice email",
  notify_request: "Tell about a request", notify_devices: "Phone notification", approval_nudge: "Approval reminder", approval_summary: "Approval summary",
  forms_watch: "Daily forms check", delete_firm: "Delete a firm", outage_email: "Outage email", billing: "Daily billing", billing_reconcile: "Match payments with Cashfree",
  billing_refund: "Refund", jobs_stopped: "Stopped work alert", split_firms: "Find firms that may be one", usage_alert: "Fair use alert", ai_topup: "AI top-up",
  mail_held: "Held email alert", ai_draft: "AI reply draft", date_watch: "Sunday due date check",
};
export const jobName = (kind: string) => jobNames[kind] ?? kind;

// Mailbox and drive providers by name.
const providers: Record<string, string> = { imap: "IMAP", gmail: "Gmail", outlook: "Outlook", zoho: "Zoho Mail", local: "This server", onedrive: "OneDrive", dropbox: "Dropbox" };
export const providerName = (provider: string) => providers[provider] ?? provider;

// What trying a failed job again will do, said before it runs.
export const retryWords = (error: string | null) =>
  error === "uncertain" ? "It may have sent already, so a client could get it twice. Check first." : "It runs again from the start, with fresh tries.";
