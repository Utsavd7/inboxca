"use server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { emailTemplates } from "@/src/lib/email-templates";
import { firmMailer } from "@/src/lib/firm-mail";
import { CODE_MINUTES, CODE_TRIES, codeHash, newCode, openCookie, openValue } from "@/src/lib/share-codes";
import { supabaseAdmin } from "@/src/lib/supabase";
import { shareRecipient } from "./recipient";

// The private paper behind a link, if the link is current.
async function privateShare(token: string) {
  const { data: share } = await supabaseAdmin()
    .from("shares")
    .select("id, firm_id, contact_id, needs_code, code_hash, link_expires_at, downloads, documents(client_id, clients(name, email_enc)), firms(name)")
    .eq("link_token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  return share?.needs_code && Date.parse(share.link_expires_at ?? "") > Date.now() && share.downloads < 5 ? share : null;
}

// Emails a new one-time code to the address the paper was sent to, never to one typed here.
// At most 5 codes a day for a link, so its 5 tries a code cannot be repeated without end.
export async function requestShareCode(form: FormData) {
  const token = String(form.get("token") ?? "");
  const share = await privateShare(token);
  if (!share?.documents?.clients || !share.firms) redirect(`/s/${token}`);
  const { count } = await supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true })
    .eq("firm_id", share.firm_id).eq("entity_id", share.id).eq("action", "share.code_sent").gte("at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 5) redirect(`/s/${token}?code=limit`);
  const to = await shareRecipient(share);
  const mailer = to ? await firmMailer(share.firm_id, share.firms.name) : null;
  const code = newCode();
  await supabaseAdmin()
    .from("shares")
    .update({ code_hash: codeHash(share.id, code), code_expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), code_attempts: 0 })
    .eq("id", share.id);
  const message=emailTemplates.code(code,share.firms.name);
  const sent=await mailer?.send(to,message.subject,message.text);
  if (!sent) await supabaseAdmin().from("shares").update({code_hash:null,code_expires_at:null}).eq("id",share.id);
  else await supabaseAdmin().from("activity_log").insert({ firm_id: share.firm_id, action: "share.code_sent", entity_type: "share", entity_id: share.id });
  redirect(`/s/${token}?code=${sent ? "sent" : "failed"}`);
}

// Checks a code: 5 tries and 10 minutes, then a new code is needed. A right code lets this
// browser download the paper for 30 minutes.
export async function enterShareCode(form: FormData) {
  const token = String(form.get("token") ?? "");
  const share = await privateShare(token);
  if (!share?.code_hash) redirect(`/s/${token}`);
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  // Counted and checked in one step (public.try_share_code), so guesses sent at once share the tries.
  const { data: answer } = await supabaseAdmin().rpc("try_share_code", { share: share.id, hash: codeHash(share.id, code), tries: CODE_TRIES });
  if (answer !== "right") redirect(`/s/${token}?code=${answer === "wrong" ? "wrong" : "again"}`);
  const { name, maxAge } = openCookie(share.id);
  (await cookies()).set(name, openValue(share.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: `/s/${token}`, maxAge });
  redirect(`/s/${token}`);
}
