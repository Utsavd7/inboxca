import { serverCrypto } from "@/src/lib/crypto";
import { supabaseAdmin } from "@/src/lib/supabase";

// The address a paper was sent to: its contact's, or else its client's. Codes go only here.
export async function shareRecipient(share: { firm_id: string; contact_id: string | null; documents: { client_id: string; clients: { email_enc: string | null } | null } | null }) {
  const crypto = serverCrypto();
  if (share.contact_id) {
    const { data: contact } = await supabaseAdmin().from("contacts").select("email_enc").eq("id", share.contact_id).maybeSingle();
    return contact ? crypto.decrypt(share.firm_id, `contacts/${share.contact_id}/email`, contact.email_enc) : "";
  }
  const sealed = share.documents?.clients?.email_enc;
  return sealed ? crypto.decrypt(share.firm_id, `clients/${share.documents!.client_id}/email`, sealed) : "";
}

// An address with all but its first letter hidden before the @, as a•••@client.test.
export const masked = (address: string) => address.replace(/^(.)[^@]*/, "$1•••");
