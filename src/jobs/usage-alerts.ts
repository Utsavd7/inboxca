import { autoTopUp } from "@/src/lib/billing/billing";
import { notify } from "@/src/lib/push";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import type { Handler } from "./runner";

// Fair use (PLAN.md D26, 5.14): the owner is told when this month's downloads through InboxCA
// reach 80%, and when they pause until the owner allows more; and so for AI credits (5.18).
const words: Record<string, { title: string; body: string; url?: string }> = {
  downloads_80: { title: "Downloads this month", body: "Your firm has used 80% of this month's downloads through InboxCA." },
  downloads_100: { title: "Downloads are paused", body: "Your firm has used this month's downloads through InboxCA. Allow more in Settings, Your data, or open papers in your drive." },
  ai_80: { title: "AI credits this month", body: "Your firm has used 80% of this month's AI credits. At 90% automatic reading pauses. Add credits in Settings, Billing.", url: "/app/settings?group=billing#addons" },
  ai_100: { title: "AI is paused", body: "Your firm has used this month's AI credits, so AI is paused until next month. Emails are still filed by your rules. Add credits in Settings, Billing.", url: "/app/settings?group=billing#addons" },
};
export const usageAlert: Handler = async (job) => {
  const message = words[job.idempotency_key.split(":")[1]];
  const { data: owners, error } = await supabaseAdmin().from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("role", "owner").eq("status", "active");
  if (error) return { retry: "owner_not_read" };
  if (message) await notify((owners ?? []).map((owner) => owner.user_id), { url: "/app/settings?group=data#caps", ...message }, job.firm_id!);
  return { done: true };
};

// From 90% of the month's AI credits: one auto top-up, only when the owner set a monthly limit
// (off by default), and within it and the plan's cap (autoTopUp).
export const aiTopUp: Handler = async (job) => {
  await autoTopUp(job.firm_id!);
  return { done: true };
};

// 09:00 the day after a person's email copies waited past the firm's emails for the day: one
// note, which itself always goes, saying where to find what they were about.
export const mailHeld: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: member, error } = await admin.from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("user_id", job.entity_id!).eq("status", "active").maybeSingle();
  if (error) return { retry: "member_not_read" };
  const email = member && (await admin.auth.admin.getUserById(member.user_id)).data.user?.email;
  if (email) await sendSystemMail(email, "InboxCA: some alerts were not emailed yesterday", [
    "Yesterday your firm reached the most emails InboxCA sends it in a day, so some alerts were not emailed to you.",
    `Everything they were about is in InboxCA. Open it to see what needs you today: ${process.env.APP_BASE_URL ?? ""}/app`,
  ].join("\n\n"));
  return { done: true };
};
