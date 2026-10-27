import { notify } from "@/src/lib/push";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import type { Handler } from "./runner";

// Fair use (PLAN.md D26, 5.14): the owner is told when this month's downloads through InboxCA
// reach 80%, and when they pause until the owner allows more.
const words: Record<string, { title: string; body: string }> = {
  downloads_80: { title: "Downloads this month", body: "Your firm has used 80% of this month's downloads through InboxCA." },
  downloads_100: { title: "Downloads are paused", body: "Your firm has used this month's downloads through InboxCA. Allow more in Settings, Your data, or open papers in your drive." },
};
export const usageAlert: Handler = async (job) => {
  const message = words[job.idempotency_key.split(":")[1]];
  const { data: owners, error } = await supabaseAdmin().from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("role", "owner").eq("status", "active");
  if (error) return { retry: "owner_not_read" };
  if (message) await notify((owners ?? []).map((owner) => owner.user_id), { ...message, url: "/app/settings?group=data#caps" }, job.firm_id!);
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
