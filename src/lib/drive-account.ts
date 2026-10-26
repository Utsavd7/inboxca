import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { serverCrypto } from "./crypto";
import { DRIVE_TERMS_VERSION, localDrive, type Drive } from "./drive";
import { dropboxDrive } from "./dropbox";
import { supabaseAdmin } from "./supabase";

// Holds the PKCE verifier and state between the Connect press and Dropbox's callback.
export const DRIVE_COOKIE = "inboxca_drive_connect";

// Saves the connected drive with the owner's consent (connect_drive logs drive.consent in
// the same statement). The address shown and the credentials are encrypted with the
// firm's key. Returns an error code for Settings when it could not be saved. InboxCA then
// sets the drive up by itself (drive_setup); the caller runs it at once (runJobsSoon).
export async function saveDrive(supabase: SupabaseClient<Database>, firmId: string, provider: "local" | "dropbox", address: string, credentials: string, settings: Record<string, string> = {}) {
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

// The firm's drive, opened with its saved credentials.
export async function openDrive(firmId: string, account: { id: string; provider: string; credentials_enc: string }): Promise<Drive> {
  if (account.provider === "local") return localDrive();
  const { refreshToken } = JSON.parse(await serverCrypto().decrypt(firmId, `accounts/${account.id}/credentials`, account.credentials_enc));
  return dropboxDrive(refreshToken);
}
