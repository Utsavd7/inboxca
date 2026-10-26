import { serverCrypto } from "@/src/lib/crypto";
import { supabaseAdmin } from "@/src/lib/supabase";

// The firm whose enquiry form this key opens, while the owner keeps the form on and the firm
// is working (PLAN.md 5.12), with the websites the owner lets show it (proxy.ts). No one is
// signed in on the form, so it is looked up with the server's key, by the key alone.
export async function formFirm(key: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(key)) return null;
  const { data } = await supabaseAdmin().from("firms").select("id, name, status, sites:settings->enquiry_form->sites").eq("settings->enquiry_form->>key", key).maybeSingle();
  return data && ["active", "grace"].includes(data.status) ? data : null;
}

// When the form was opened, signed with the firm's key so a bot cannot make one up; and that
// time read back from a sent form, or 0 when the signature does not match.
export async function formStamp(firm: string, at = Date.now()) {
  return `${at}.${await serverCrypto().blindIndex(firm, "form_time", String(at))}`;
}
export async function stampTime(firm: string, stamp: string) {
  const [at] = stamp.split(".");
  return /^\d{13}$/.test(at) && stamp === (await formStamp(firm, Number(at))) ? Number(at) : 0;
}
