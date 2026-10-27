import type { Json } from "@/src/db/types";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// One firm signing up as several small accounts (PLAN.md D38 (6), 5.14), checked once a night
// across every firm not closed. Any one of these flags two firms: the same firm PAN (from its
// own GSTIN), the same owner login, the same mailbox or the same drive account. Clients count
// only in bulk, as two firms often serve the same client: at least 10 client PANs in common,
// making at least 30% of the smaller firm's. One query (split_firm_pairs) compares identity
// hashes, the same in every firm for the same PAN, mailbox or drive account (src/lib/crypto.ts),
// so nothing is opened, however many firms there are. Only the pair and what matched, as kinds
// and counts, are saved under platform_settings 'split_firms' for an Orelu admin, who decides.
// No firm sees it, and nothing is blocked.
const CLIENTS = 10, SHARE = 0.3;
type Flag = { firms: string[]; evidence: string[]; clients?: number; share?: number; since: string; checked?: { evidence: string[] } };
type Pair = { firms: string[]; evidence: string[]; clients: number; smaller: number };

export const splitFirms: Handler = async () => {
  const admin = supabaseAdmin();
  const { data: pairs, error: checkError } = await admin.rpc("split_firm_pairs", { least_clients: CLIENTS, least_share: SHARE });
  const { data: kept, error } = await admin.from("platform_settings").select("value").eq("key", "split_firms").maybeSingle();
  if (checkError || error) return { retry: "split_firms_not_read" };
  const before = new Map(((kept?.value as { flags?: Flag[] } | undefined)?.flags ?? []).map((flag) => [flag.firms.join(" "), flag]));
  const flags = (pairs as Pair[]).map(({ firms, evidence, clients, smaller }): Flag => {
    const old = before.get(firms.join(" "));
    // A verdict stands until a new kind of match appears.
    const checked = old?.checked && evidence.every((kind) => old.checked!.evidence.includes(kind)) ? old.checked : undefined;
    return { firms, evidence, ...(clients && { clients, share: Math.round(100 * (clients / smaller)) }), since: old?.since ?? new Date().toISOString(), ...(checked && { checked }) };
  });
  const { error: saveError } = await admin.from("platform_settings").upsert({ key: "split_firms", value: { flags, at: new Date().toISOString() } as unknown as NonNullable<Json> });
  return saveError ? { retry: "split_firms_not_saved" } : { done: true };
};
