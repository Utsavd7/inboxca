import nodemailer from "nodemailer";
import { addDays, todayInIndia } from "./calendar";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

// Orelu's own emails to firm owners (PLAN.md D28: Amazon SES), sent over SES's SMTP address.
// Off until SYSTEM_MAIL_URL (smtps://user:password@host:465, the SES SMTP credentials) and
// EMAIL_FROM_DOMAIN are both set: nothing is sent or billed before then, and the admin
// console says so.
export const systemMailReady = () => !!process.env.SYSTEM_MAIL_URL && !!process.env.EMAIL_FROM_DOMAIN;

// One firm's emails from Orelu today against plan_formula's fair use (PLAN.md 5.14, D26);
// send counts this one first. Billing, outage and closing emails name no firm and always go.
export async function systemMailUse(firmId: string, send = false) {
  const { data, error } = await supabaseAdmin().rpc("system_mail_use", { target_firm: firmId, send });
  if (error) throw new Error(`System mail not counted: ${error.code}`);
  return data as { used: number; most: number };
}
async function room(firmId?: string) {
  if (!firmId) return true;
  const { used, most } = await systemMailUse(firmId, true);
  return used <= most;
}

// One plain message, written and sent in memory and never kept (D6). False when not set up, or
// when the firm named has used today's emails.
export async function sendSystemMail(to: string, subject: string, text: string, firmId?: string) {
  if (!systemMailReady() || !(await room(firmId))) return false;
  await nodemailer.createTransport(process.env.SYSTEM_MAIL_URL!).sendMail({ from: `InboxCA <no-reply@${process.env.EMAIL_FROM_DOMAIN}>`, to, subject, text });
  return true;
}

// The email copy of a phone notification (#20), in the same words, which never name a
// client. Its link only opens InboxCA, where the person signs in and decides, so a mail
// scanner that opens it approves nothing (#57). Past the firm's emails for today a copy is not
// kept to send later (D6): what it was about stays in InboxCA, and the person gets one note at
// 09:00 tomorrow saying so (mail_held).
export async function mailCopy(userIds: string[], message: { title: string; body: string; url: string }, firmId?: string) {
  if (!systemMailReady()) return;
  const admin = supabaseAdmin();
  const text = [message.body, `Open InboxCA to see it: ${process.env.APP_BASE_URL ?? ""}${message.url}`, "This link only opens InboxCA. Nothing changes until you sign in and choose."].join("\n\n");
  for (const userId of userIds) {
    const email = (await admin.auth.admin.getUserById(userId)).data.user?.email;
    if (!email) continue;
    if (await room(firmId)) await sendSystemMail(email, `InboxCA: ${message.title}`, text).catch(() => log.warn("system_mail.copy_failed"));
    else {
      const day = addDays(todayInIndia(), 1);
      const { error } = await admin.from("jobs").upsert({ firm_id: firmId, kind: "mail_held", entity_type: "person", entity_id: userId, run_at: `${day}T09:00:00+05:30`, idempotency_key: `mail_held:${firmId}:${userId}:${day}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw new Error(`Held email not noted: ${error.code}`);
    }
  }
}
