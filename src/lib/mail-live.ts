import { serverCrypto } from "./crypto";
import type { MailSettings } from "./mailbox";
import { signMail, type ListAsk, type MailItem, type MailMessage, type ThreadAsk } from "./mail-view";
import { supabaseAdmin } from "./supabase";

type Failed = { error: "not_connected" | "unreachable" };
// Reads the firm's mailbox live through the file worker, which runs the mail library
// (PLAN.md D28: the app's host has no sockets for it). Nothing read is stored or cached; the
// request carries the mailbox sign in, signed and valid for a minute. Called only after the
// caller checked what the person may see, and it shows only that.
export async function mailLive(firm: string, op: "list", ask: ListAsk): Promise<{ inbox: MailItem[]; sent: MailItem[] | null } | Failed>;
export async function mailLive(firm: string, op: "thread", ask: ThreadAsk): Promise<{ messages: MailMessage[] } | Failed>;
export async function mailLive(firm: string, op: "list" | "thread", ask: ListAsk | ThreadAsk) {
  const { data: account } = await supabaseAdmin().from("connected_accounts").select("id, address_enc, credentials_enc, settings, status").eq("firm_id", firm).eq("kind", "mail").maybeSingle();
  if (account?.status !== "connected") return { error: "not_connected" };
  if (!process.env.FILE_WORKER_URL || !process.env.FILE_WORKER_SECRET) return { error: "unreachable" };
  const crypto = serverCrypto();
  const address = await crypto.decrypt(firm, `accounts/${account.id}/address`, account.address_enc);
  const { password } = JSON.parse(await crypto.decrypt(firm, `accounts/${account.id}/credentials`, account.credentials_enc));
  const body = JSON.stringify({ firm, expires: Math.floor(Date.now() / 1000) + 60, address, password, server: (account.settings as MailSettings).imap, op, ask });
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
