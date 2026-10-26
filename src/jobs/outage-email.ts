import { statusParts, type Part } from "@/src/lib/status";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail, systemMailReady } from "@/src/lib/system-mail";
import type { Handler } from "./runner";

// The outage email (PLAN.md 5.17 #43): one firm's owners are told what is not working and
// where to follow it. The words are the admin's public title, never a firm's or client's data.
export const outageEmail: Handler = async (job, { markSending }) => {
  if (!systemMailReady()) return { fail: "system_mail_off" };
  const admin = supabaseAdmin();
  const [{ data: incident }, { data: owners }] = await Promise.all([
    admin.from("incidents").select("title, parts, ended_at").eq("id", job.entity_id!).maybeSingle(),
    admin.from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("role", "owner").eq("status", "active"),
  ]);
  if (!incident || incident.ended_at) return { done: true };
  const parts = incident.parts.map((part) => statusParts[part as Part]).join(", ");
  const text = [
    `InboxCA is not working fully right now: ${incident.title}.`,
    `Affected: ${parts}.`,
    "Your papers stay safe in your firm's drive. New emails wait in your firm email until InboxCA reads them again.",
    `Follow progress at ${process.env.APP_BASE_URL ?? ""}/status`,
    "Orelu, the team behind InboxCA",
  ].join("\n\n");
  await markSending();
  for (const owner of owners ?? []) {
    const email = (await admin.auth.admin.getUserById(owner.user_id)).data.user?.email;
    if (email) await sendSystemMail(email, `InboxCA: ${incident.title}`, text);
  }
  return { done: true };
};
