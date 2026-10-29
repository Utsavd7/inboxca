import { alertAdmins, dailyBilling, reconcile, retryRefund } from "@/src/lib/billing/billing";
import { todayInIndia } from "@/src/lib/calendar";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Orelu's billing runs (PLAN.md 5.14.1): each firm's day (notices, renewals, retries, states),
// the daily reconciliation, and a failed refund tried again.
export const billingDay: Handler = async (job) => {
  await dailyBilling(job.entity_id ?? "");
  return { done: true };
};
export const billingReconcile: Handler = async () => {
  await reconcile();
  return { done: true };
};
export const billingRefund: Handler = async (job) => ((await retryRefund(job.entity_id ?? "")) === false ? { retry: "refund_unsure" } : { done: true });
// Jobs the worker stopped part way (claim_jobs): one email a day tells Orelu's admins to look at
// Admin, Failed jobs.
export const jobsStopped: Handler = async () => {
  await alertAdmins(supabaseAdmin(), "jobs_stopped", todayInIndia());
  return { done: true };
};

// While a firm is read only for its plan (unpaid, or after the money back), InboxCA's own work
// for it waits: client emails stay in the mailbox and are read once the plan is paid.
export const PAUSED_WHILE_READ_ONLY = ["mail_poll", "file_mail", "notice_from_mail", "records_reply", "answer_mail", "reply_waiting", "reminders", "bulk_send", "read_document", "read_sales", "read_portal", "import_files", "fill_return", "ai_draft"];
export const pausedWhileReadOnly = (handler: Handler): Handler => async (job, tools) => {
  const { data } = job.firm_id ? await supabaseAdmin().from("firms").select("status").eq("id", job.firm_id).maybeSingle() : { data: null };
  return data?.status === "read_only" ? { retry: "firm_read_only", at: new Date(Date.now() + 6 * 3_600_000) } : handler(job, tools);
};
