import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/src/db/types";
import { serverCrypto } from "./crypto";
import { DRIVE_TERMS_VERSION, localDrive, type Drive } from "./drive";
import { dropboxAccessToken, dropboxDrive } from "./dropbox";
import { onedriveAccessToken, onedriveDrive } from "./onedrive";
import { supabaseAdmin } from "./supabase";

// Holds the PKCE verifier, the state and the drive between the Connect press and the callback.
export const DRIVE_COOKIE = "inboxca_drive_connect";

// Saves the connected drive with the owner's consent (connect_drive logs drive.consent in
// the same statement). The address shown and the credentials are encrypted with the
// firm's key. Returns an error code for Settings when it could not be saved. InboxCA then
// sets the drive up by itself (drive_setup); the caller runs it at once (runJobsSoon).
export async function saveDrive(supabase: SupabaseClient<Database>, firmId: string, provider: "local" | "dropbox" | "onedrive", address: string, credentials: string, settings: Record<string, string> = {}) {
  const id = randomUUID();
  const crypto = serverCrypto();
  const { data: connected } = await supabase.rpc("connect_drive", {
    target_firm: firmId,
    account: id,
    drive_provider: provider,
    address: await crypto.encrypt(firmId, `accounts/${id}/address`, address),
    credentials: await crypto.encrypt(firmId, `accounts/${id}/credentials`, credentials),
    drive_settings: { folder_order: "year_client_work", ...settings },
    level: "whole_drive",
    terms_version: DRIVE_TERMS_VERSION,
  });
  if (!connected) return { error: "drive_taken" };
  // Jobs are the server's own.
  await supabaseAdmin().from("jobs").insert({ firm_id: firmId, kind: "drive_setup", entity_type: "account", entity_id: id, idempotency_key: `drive_setup:${id}` });
  return { id };
}

// Reconnect (Settings → Firm drive): the owner signs in to the same drive again, and its
// record, folders and papers stay. A Dropbox or OneDrive sign in is saved over the old one with
// its account (for Dropbox's change notices, which a drive connected before them never had);
// another account is refused, as this drive's papers are not in it. The server's key writes it
// (the owner may add or remove a connection, never change one); the caller checked the owner. A
// check follows at once, which clears the drive away alert once it reaches the drive.
export async function renewDrive(firmId: string, accountId: string, actor: string, signedIn?: { address: string; credentials: string; account: string }) {
  const admin = supabaseAdmin();
  const { data: drive } = await admin.from("connected_accounts").select("id, provider, address_enc, settings").eq("firm_id", firmId).eq("kind", "drive").eq("id", accountId).maybeSingle();
  if (!drive || (signedIn && drive.provider === "local")) return { error: "drive_failed" };
  if (signedIn) {
    const crypto = serverCrypto();
    const settings = drive.settings as Record<string, Json>;
    const key = `${drive.provider}_account`;
    const same = settings[key] ? settings[key] === signedIn.account : (await crypto.decrypt(firmId, `accounts/${drive.id}/address`, drive.address_enc)) === signedIn.address;
    if (!same) return { error: "drive_other" };
    const { error } = await admin
      .from("connected_accounts")
      .update({
        address_enc: await crypto.encrypt(firmId, `accounts/${drive.id}/address`, signedIn.address),
        credentials_enc: await crypto.encrypt(firmId, `accounts/${drive.id}/credentials`, signedIn.credentials),
        settings: { ...settings, [key]: signedIn.account },
      })
      .eq("id", drive.id);
    if (error) return { error: "drive_failed" };
  }
  await admin.from("activity_log").insert({ firm_id: firmId, actor_id: actor, action: "drive.reconnected", entity_type: "account", entity_id: drive.id, details: { provider: drive.provider } });
  await admin.from("jobs").insert({ firm_id: firmId, kind: "drive_check", entity_type: "account", entity_id: drive.id, idempotency_key: `drive_check:${drive.id}:${randomUUID()}` });
  return {};
}

// The firm's drive, opened with its saved credentials.
type Account = { id: string; provider: string; credentials_enc: string };
export async function openDrive(firmId: string, account: Account): Promise<Drive> {
  if (account.provider === "local") return localDrive();
  const saved = await credentials(firmId, account);
  return account.provider === "onedrive" ? onedriveDrive(saved.refreshToken, keepToken(firmId, account, saved.at)) : dropboxDrive(saved.refreshToken);
}

// A short access token for the file worker, which reads a file from the drive itself; none for
// the test drive.
export async function driveToken(firmId: string, account: Account) {
  if (account.provider === "local") return "";
  const saved = await credentials(firmId, account);
  return account.provider === "onedrive" ? onedriveAccessToken(saved.refreshToken, keepToken(firmId, account, saved.at)) : dropboxAccessToken(saved.refreshToken);
}

const credentials = async (firmId: string, account: Account) =>
  JSON.parse(await serverCrypto().decrypt(firmId, `accounts/${account.id}/credentials`, account.credentials_enc)) as { refreshToken: string; at?: number };

// Microsoft gives a new refresh token at each use and ends each one 90 days after it was given,
// so the newest is saved, encrypted, at most once a day (the nightly check uses one every day),
// and only over the credentials this read, so a reconnect meanwhile is never undone. Logged,
// never the token. The server's key: the owner may add or remove a connection, never change one.
function keepToken(firmId: string, account: Account, savedAt = 0) {
  if (Date.now() - savedAt < 86_400_000) return undefined;
  return async (refreshToken: string) => {
    const admin = supabaseAdmin();
    const sealed = await serverCrypto().encrypt(firmId, `accounts/${account.id}/credentials`, JSON.stringify({ refreshToken, at: Date.now() }));
    const { data: kept } = await admin.from("connected_accounts").update({ credentials_enc: sealed }).eq("id", account.id).eq("credentials_enc", account.credentials_enc).select("id");
    if (kept?.length) await admin.from("activity_log").insert({ firm_id: firmId, action: "drive.token_saved", entity_type: "account", entity_id: account.id, details: { provider: account.provider } });
  };
}
