import { serverCrypto } from "./crypto";
import { supabaseAdmin } from "./supabase";

// A firm's connected mailbox is for client mail, never for a person's sign in.
// Only the firms the address could sign in to are checked: the given one, or the firms of
// the person with that address (someone with no account cannot sign in anyway).
export async function mailboxLogin(email: string, firmId?: string) {
  const admin = supabaseAdmin();
  let firms = firmId ? [firmId] : [];
  if (!firmId) {
    const { data: userId } = await admin.rpc("user_id_for_email", { address: email });
    if (!userId) return false;
    const { data: memberships } = await admin.from("firm_members").select("firm_id").eq("user_id", userId);
    firms = memberships?.map((membership) => membership.firm_id) ?? [];
    if (!firms.length) return false;
  }
  const request = admin.from("connected_accounts").select("id, firm_id, address_enc, address_bidx").eq("kind", "mail").in("firm_id", firms);
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
