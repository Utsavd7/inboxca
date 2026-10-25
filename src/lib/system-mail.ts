import nodemailer from "nodemailer";

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
