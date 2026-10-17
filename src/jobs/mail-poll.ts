import { serverCrypto } from "@/src/lib/crypto";
import { readNewMail, type MailSettings } from "@/src/lib/mailbox";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Reads a connected mailbox's new mail (PLAN.md 4.5). Mail from anyone who is not a
// client or a contact of the firm is skipped without keeping anything. A refused password
// marks the mailbox to be connected again, which stops polling until the owner does.
export const mailPoll: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { data: account } = await admin
    .from("connected_accounts")
    .select("id, firm_id, address_enc, credentials_enc, sync_cursor, settings, status")
    .eq("id", job.entity_id ?? "")
    .maybeSingle();
  if (account?.status !== "connected") return { done: true };
  const firm = account.firm_id;
  const crypto = serverCrypto();
  const address = await crypto.decrypt(firm, `accounts/${account.id}/address`, account.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firm, `accounts/${account.id}/credentials`, account.credentials_enc));
  const read = await readNewMail(address, password, (account.settings as MailSettings).imap, account.sync_cursor);
  if ("error" in read) {
    if (read.error === "server") return { retry: "mail_unreachable" };
    await admin.from("connected_accounts").update({ status: "needs_reconnect" }).eq("id", account.id);
    return { done: true };
  }

  // Senders are matched by blind index, so no address is compared or kept in plain text.
  const senders = new Map(await Promise.all(read.mail.map(async (mail) => [mail.from, await crypto.blindIndex(firm, "email", mail.from)] as const)));
  const indexes = [...new Set(senders.values())];
  const [{ data: contacts }, { data: clients }] = await Promise.all([
    admin.from("contacts").select("id, email_bidx, contact_clients(client_id)").eq("firm_id", firm).in("email_bidx", indexes),
    admin.from("clients").select("id, email_bidx").eq("firm_id", firm).is("archived_at", null).in("email_bidx", indexes),
  ]);
  const events = read.mail.flatMap((mail) => {
    const index = senders.get(mail.from)!;
    const contact = contacts?.find((row) => row.email_bidx === index);
    const ownClients = clients?.filter((row) => row.email_bidx === index) ?? [];
    if (!contact && !ownClients.length) return [];
    const forClients = contact ? contact.contact_clients.map((link) => link.client_id) : ownClients.map((row) => row.id);
    return [
      {
        firm_id: firm,
        account_id: account.id,
        provider_message_id: mail.messageId,
        thread_id: mail.threadId,
        sender_bidx: index,
        contact_id: contact?.id ?? null,
        client_id: forClients.length === 1 ? forClients[0] : null,
        received_at: mail.receivedAt,
      },
    ];
  });
  if (events.length) {
    const { error } = await admin.from("email_events").upsert(events, { onConflict: "account_id,provider_message_id", ignoreDuplicates: true });
    if (error) return { retry: "events_not_saved" };
  }
  await admin.from("connected_accounts").update({ sync_cursor: read.cursor }).eq("id", account.id);
  return { done: true };
};
