import { serverCrypto } from "./crypto";
import { supabaseAdmin } from "./supabase";

// A firm's connected mailbox is for client mail, never for a person's sign in.
export async function mailboxLogin(email: string, firmId?: string) {
  const admin = supabaseAdmin();
  let request = admin.from("connected_accounts").select("id, firm_id, address_enc, address_bidx").eq("kind", "mail");
  if (firmId) request = request.eq("firm_id", firmId);
  const { data: accounts, error } = await request;
  if (error) throw new Error(`mailbox login check failed: ${error.code}`);
  const crypto = serverCrypto();
  for (const account of accounts ?? []) {
    const wanted = await crypto.blindIndex(account.firm_id, "email", email);
    let saved = account.address_bidx;
    if (!saved) {
      const address = await crypto.decrypt(account.firm_id, `accounts/${account.id}/address`, account.address_enc);
      saved = await crypto.blindIndex(account.firm_id, "email", address);
      const { error: updateError } = await admin.from("connected_accounts").update({ address_bidx: saved }).eq("id", account.id);
      if (updateError) throw new Error(`mailbox login index failed: ${updateError.code}`);
    }
    if (saved === wanted) return true;
  }
  return false;
}
