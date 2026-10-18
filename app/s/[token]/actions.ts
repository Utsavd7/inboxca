"use server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverCrypto } from "@/src/lib/crypto";
import { firmMailer } from "@/src/lib/firm-mail";
import { CODE_MINUTES, CODE_TRIES, codeHash, newCode, openCookie, openValue } from "@/src/lib/share-codes";
import { supabaseAdmin } from "@/src/lib/supabase";

// The private paper behind a link, if the link is current.
async function privateShare(token: string) {
  const { data: share } = await supabaseAdmin()
    .from("shares")
    .select("id, firm_id, contact_id, needs_code, code_hash, code_expires_at, code_attempts, link_expires_at, downloads, documents(client_id, clients(name, email_enc)), firms(name)")
    .eq("link_token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  return share?.needs_code && Date.parse(share.link_expires_at ?? "") > Date.now() && share.downloads < 5 ? share : null;
}

// Emails a new one-time code to the address the paper was sent to, never to one typed here.
export async function requestShareCode(form: FormData) {
  const token = String(form.get("token") ?? "");
  const share = await privateShare(token);
  if (!share?.documents?.clients || !share.firms) redirect(`/s/${token}`);
  const crypto = serverCrypto();
  let to = "";
  if (share.contact_id) {
    const { data: contact } = await supabaseAdmin().from("contacts").select("email_enc").eq("id", share.contact_id).maybeSingle();
    if (contact) to = await crypto.decrypt(share.firm_id, `contacts/${share.contact_id}/email`, contact.email_enc);
  } else if (share.documents.clients.email_enc) to = await crypto.decrypt(share.firm_id, `clients/${share.documents.client_id}/email`, share.documents.clients.email_enc);
  const mailer = to ? await firmMailer(share.firm_id, share.firms.name) : null;
  const code = newCode();
  await supabaseAdmin()
    .from("shares")
    .update({ code_hash: codeHash(share.id, code), code_expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), code_attempts: 0 })
    .eq("id", share.id);
  const sent = await mailer?.send(to, "Your code to open the document", [`Your code is ${code}.`, "", `It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`, "", share.firms.name].join("\n"));
  redirect(`/s/${token}?code=${sent ? "sent" : "failed"}`);
}

// Checks a code: 5 tries and 10 minutes, then a new code is needed. A right code lets this
// browser download the paper for 30 minutes.
export async function enterShareCode(form: FormData) {
  const token = String(form.get("token") ?? "");
  const share = await privateShare(token);
  if (!share?.code_hash) redirect(`/s/${token}`);
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const current = Date.parse(share.code_expires_at ?? "") > Date.now() && share.code_attempts < CODE_TRIES;
  if (!current || codeHash(share.id, code) !== share.code_hash) {
    await supabaseAdmin().from("shares").update({ code_attempts: Math.min(CODE_TRIES, share.code_attempts + 1) }).eq("id", share.id);
    redirect(`/s/${token}?code=${current && share.code_attempts + 1 < CODE_TRIES ? "wrong" : "again"}`);
  }
  await supabaseAdmin().from("shares").update({ code_hash: null, code_expires_at: null }).eq("id", share.id);
  const { name, maxAge } = openCookie(share.id);
  (await cookies()).set(name, openValue(share.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: `/s/${token}`, maxAge });
  redirect(`/s/${token}`);
}
