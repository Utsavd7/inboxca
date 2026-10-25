import type { DocumentRequest } from "@/src/lib/checklists";
import { serverCrypto } from "@/src/lib/crypto";
import { emailTemplates } from "@/src/lib/email-templates";
import { firmMailer } from "@/src/lib/firm-mail";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// The client's receipt for papers sent through their upload link: one a sitting, from the
// firm's own mailbox, naming what arrived and what is still needed. Nothing is sent when the
// firm has no connected mailbox or the client no address. Each receipt is logged.
export const uploadReceipt: Handler = async (job, { markSending }) => {
  const admin = supabaseAdmin();
  const { data: request } = await admin.from("requests").select("id, firm_id, client_id, details, clients(name, email_enc), firms(name)").eq("id", job.entity_id!).maybeSingle();
  const details = request?.details as unknown as DocumentRequest | undefined;
  if (!request?.client_id || !request.clients?.email_enc || !request.firms || !details?.items.some((item) => item.received.length)) return { done: true };
  const mailer = await firmMailer(request.firm_id, request.firms.name);
  if (!mailer) return { done: true };
  const to = await serverCrypto().decrypt(request.firm_id, `clients/${request.client_id}/email`, request.clients.email_enc);
  const message = emailTemplates.receipt(request.clients.name, request.firms.name, details.period, details.items);
  await markSending();
  if (!(await mailer.send(to, message.subject, message.text))) return mailer.waitUntil ? { retry: "mail_wait", at: mailer.waitUntil } : { retry: "mail_not_sent" };
  await admin.from("activity_log").insert({ firm_id: request.firm_id, action: "request.receipt_sent", entity_type: "request", entity_id: request.id });
  return { done: true };
};
