import {redirect} from "next/navigation";
import {currentMember} from "@/src/lib/member";
import {mailboxLink} from "@/src/lib/mailbox";
import {serverCrypto} from "@/src/lib/crypto";
import {plainPage} from "@/src/lib/plain-page";
import {supabaseAdmin} from "@/src/lib/supabase";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}) {
  const {supabase,membership}=await currentMember();
  if (!membership) redirect("/app");
  const {id}=await params;
  const {data:event}=await supabase.from("email_events").select("account_id,provider_message_id").eq("firm_id",membership.firmId).eq("id",id).maybeSingle();
  const back=(words:string)=>plainPage(404,words,event ? `/app/inbox?mail=${id}` : "/app/inbox",event ? "Go back to the email" : "Go to Inbox");
  if (!event) return back("This email is not available.");
  const {data:account}=await supabaseAdmin().from("connected_accounts").select("id,provider,address_enc,settings").eq("firm_id",membership.firmId).eq("id",event.account_id).maybeSingle();
  if (!account) return back("This firm email is no longer connected. Ask the owner to connect it again in Settings.");
  const address=await serverCrypto().decrypt(membership.firmId,`accounts/${account.id}/address`,account.address_enc);
  // Gmail connected with Google sign in opens the same way as over IMAP.
  const url=mailboxLink(account.provider==="gmail" ? "imap.gmail.com" : (account.settings as {imap?:{host?:string}}).imap?.host ?? "",address,event.provider_message_id);
  if (!url) return back("Open this email in your firm email's own website or app.");
  redirect(url);
}
