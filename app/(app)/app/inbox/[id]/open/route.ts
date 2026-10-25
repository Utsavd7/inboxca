import {redirect} from "next/navigation";
import {currentMember} from "@/src/lib/member";
import {mailboxLink} from "@/src/lib/mailbox";
import {serverCrypto} from "@/src/lib/crypto";
import {supabaseAdmin} from "@/src/lib/supabase";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}) {
  const {supabase,membership}=await currentMember();
  if (!membership) redirect("/app");
  const {id}=await params;
  const {data:event}=await supabase.from("email_events").select("account_id,provider_message_id").eq("firm_id",membership.firmId).eq("id",id).maybeSingle();
  if (!event) return new Response("This email is not available.",{status:404});
  const {data:account}=await supabaseAdmin().from("connected_accounts").select("id,provider,address_enc,settings").eq("firm_id",membership.firmId).eq("id",event.account_id).maybeSingle();
  if (!account) return new Response("This mailbox is not connected.",{status:404});
  const address=await serverCrypto().decrypt(membership.firmId,`accounts/${account.id}/address`,account.address_enc);
  // Gmail connected with Google sign in opens the same way as over IMAP.
  const url=mailboxLink(account.provider==="gmail" ? "imap.gmail.com" : (account.settings as {imap?:{host?:string}}).imap?.host ?? "",address,event.provider_message_id);
  if (!url) return new Response("Open this email in your firm's mailbox.",{status:404});
  redirect(url);
}
