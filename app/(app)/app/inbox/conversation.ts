import { serverCrypto } from "@/src/lib/crypto";
import { mailLive } from "@/src/lib/mail-live";
import type { MailMessage } from "@/src/lib/mail-view";
import type { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";

type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];

// The clients each address writes for, by blind index: a client's own address or one of its
// contacts'. Addresses are compared only as keyed hashes, as when mail is read.
export async function clientsOf(firm: string, addresses: string[]) {
  const crypto = serverCrypto();
  const index = new Map(await Promise.all([...new Set(addresses)].map(async (address) => [address, await crypto.blindIndex(firm, "email", address)] as const)));
  const values = [...new Set(index.values())];
  if (!values.length) return new Map<string, string[]>();
  const admin = supabaseAdmin();
  const [{ data: clients }, { data: contacts }] = await Promise.all([
    admin.from("clients").select("id, email_bidx").eq("firm_id", firm).is("archived_at", null).in("email_bidx", values),
    admin.from("contacts").select("email_bidx, contact_clients(client_id)").eq("firm_id", firm).in("email_bidx", values),
  ]);
  return new Map(
    [...index].map(([address, bidx]) => [
      address,
      [...(clients ?? []).filter((row) => row.email_bidx === bidx).map((row) => row.id), ...(contacts ?? []).filter((row) => row.email_bidx === bidx).flatMap((row) => row.contact_clients.map((link) => link.client_id))],
    ]),
  );
}

// One email and its conversation, read live, or null when the person may not see it. An
// email of the inbox is found by its email_events row (row level security decides); a sent
// one by its Message-ID, shown only when it went to a client the person may see. Messages
// of the conversation with anyone else are left out.
export async function conversation(supabase: Db, firm: string, open: { mail?: string; sent?: string }) {
  const { data: event } = open.mail
    ? await supabase.from("email_events").select("id, client_id, contact_id, sender_bidx, provider_message_id, label, decision_source, received_at, clients(name), contacts(name_enc)").eq("firm_id", firm).eq("id", open.mail).maybeSingle()
    : { data: null };
  if (open.mail && !event) return null;
  const messageId = event?.provider_message_id ?? open.sent ?? "";
  if (!messageId) return null;
  const read = await mailLive(firm, "thread", { box: event ? "inbox" : "sent", messageId });
  const messages = "error" in read ? [] : read.messages;
  const opened = messages.find((message) => message.messageId === messageId);
  const parties = await clientsOf(firm, messages.flatMap((message) => [message.from, ...message.to]));
  let client = event?.client_id ? { id: event.client_id, name: event.clients?.name ?? "" } : null;
  if (!event) {
    const ids = [...new Set((opened?.to ?? []).flatMap((address) => parties.get(address) ?? []))];
    const { data: visible } = ids.length ? await supabase.from("clients").select("id, name").in("id", ids).limit(1) : { data: [] };
    client = visible?.[0] ?? null;
    if (!client) return "error" in read ? { event, client, messages, opened, error: read.error } : null;
  }
  const own = (message: MailMessage) =>
    message.messageId === messageId ||
    (message.box === "inbox" ? [message.from] : message.to).some((address) => (client ? parties.get(address)?.includes(client.id) : opened && address === opened.from));
  return { event, client, messages: messages.filter(own), opened, error: "error" in read ? read.error : null };
}

export const contactName = async (firm: string, event: { contact_id: string | null; contacts: { name_enc: string } | null }) =>
  event.contacts ? serverCrypto().decrypt(firm, `contacts/${event.contact_id}/name`, event.contacts.name_enc) : "";
