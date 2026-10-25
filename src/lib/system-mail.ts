import nodemailer from "nodemailer";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

// Orelu's own emails to firm owners (PLAN.md D28: Amazon SES), sent over SES's SMTP address.
// Off until SYSTEM_MAIL_URL (smtps://user:password@host:465, the SES SMTP credentials) and
// EMAIL_FROM_DOMAIN are both set: nothing is sent or billed before then, and the admin
// console says so.
export const systemMailReady = () => !!process.env.SYSTEM_MAIL_URL && !!process.env.EMAIL_FROM_DOMAIN;

// One plain message, written and sent in memory and never kept (D6).
export async function sendSystemMail(to: string, subject: string, text: string) {
  if (!systemMailReady()) return false;
  await nodemailer.createTransport(process.env.SYSTEM_MAIL_URL!).sendMail({ from: `InboxCA <no-reply@${process.env.EMAIL_FROM_DOMAIN}>`, to, subject, text });
  return true;
}

// The email copy of a phone notification (#20), in the same words, which never name a
// client. Its link only opens InboxCA, where the person signs in and decides, so a mail
// scanner that opens it approves nothing (#57).
export async function mailCopy(userIds: string[], message: { title: string; body: string; url: string }) {
  if (!systemMailReady()) return;
  const admin = supabaseAdmin();
  const text = [message.body, `Open InboxCA to see it: ${process.env.APP_BASE_URL ?? ""}${message.url}`, "This link only opens InboxCA. Nothing changes until you sign in and choose."].join("\n\n");
  for (const userId of userIds) {
    const email = (await admin.auth.admin.getUserById(userId)).data.user?.email;
    if (email) await sendSystemMail(email, `InboxCA: ${message.title}`, text).catch(() => log.warn("system_mail.copy_failed"));
  }
}
