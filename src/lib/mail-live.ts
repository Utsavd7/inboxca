import { mailAccess } from "./firm-mail";
import { signMail, type ListAsk, type MailItem, type MailMessage, type ThreadAsk } from "./mail-view";
import { supabaseAdmin } from "./supabase";

type Failed = { error: "not_connected" | "unreachable" };
// Reads the firm's mailbox live through the file worker, which runs the mail library
// (PLAN.md D28: the app's host has no sockets for it). Nothing read is stored or cached; the
// request carries the mailbox sign in (the password, or a short access token for a mailbox
// connected with sign in), signed and valid for a minute. Called only after the caller
// checked what the person may see, and it shows only that.
export async function mailLive(firm: string, op: "list", ask: ListAsk): Promise<{ inbox: MailItem[]; sent: MailItem[] | null } | Failed>;
export async function mailLive(firm: string, op: "thread", ask: ThreadAsk): Promise<{ messages: MailMessage[] } | Failed>;
export async function mailLive(firm: string, op: "list" | "thread", ask: ListAsk | ThreadAsk) {
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("id, provider, address_enc, credentials_enc, settings, status").eq("firm_id", firm).eq("kind", "mail").maybeSingle();
  if (account?.status !== "connected") return { error: "not_connected" };
  if (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) return { error: "unreachable" };
  const access = await mailAccess(firm, account);
  if ("error" in access) return { error: "unreachable" };
  const signIn = access.provider === "imap" ? { password: access.password, server: access.settings.imap } : { provider: access.provider, token: access.token, api: access.settings };
  const body = JSON.stringify({ firm, expires: Math.floor(Date.now() / 1000) + 60, address: access.address, ...signIn, op, ask });
  try {
    const response = await fetch(`${process.env.FILE_WORKER_URL.replace(/\/$/, "")}/mail/${op}`, {
      method: "POST",
      headers: { Authorization: await signMail(body, process.env.FILE_WORKER_SECRET), "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const read = response.ok ? await response.json() : { error: "server" };
    return "error" in read ? { error: "unreachable" } : read;
  } catch {
    return { error: "unreachable" };
  }
}
