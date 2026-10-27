import type { Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// One firm signing up as several small accounts (PLAN.md D38 (6), 5.14), checked once a night
// across every firm not closed. Any one of these flags two firms: the same firm PAN (from its
// own GSTIN), the same owner login, the same mailbox or the same drive account. Clients count
// only in bulk, as two firms often serve the same client: at least 10 client PANs in common,
// making at least 30% of the smaller firm's. Values are decrypted and compared in memory and
// never kept; only the pair and what matched, as kinds and counts, are saved under
// platform_settings 'split_firms' for an Orelu admin, who decides. No firm sees it, and nothing
// is blocked.
const CLIENTS = 10, SHARE = 0.3;
type Flag = { firms: string[]; evidence: string[]; clients?: number; share?: number; since: string; checked?: { evidence: string[] } };

// Every row a query reads, a page of the API's thousand at a time.
async function* pages<T>(read: (from: number) => PromiseLike<{ data: T[] | null; error: { code: string } | null }>) {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from);
    if (error) throw new Error(`Split firms not read: ${error.code}`);
    yield data ?? [];
    if ((data?.length ?? 0) < 1000) return;
  }
}
const twos = (list: string[]) => list.flatMap((a, at) => list.slice(at + 1).map((b) => (a < b ? `${a} ${b}` : `${b} ${a}`)));

export const splitFirms: Handler = async () => {
  const admin = supabaseAdmin(), crypto = serverCrypto();
  const open = new Set<string>();
  // Firms holding the same value, by "kind value"; and each client PAN's firms.
  const holders = new Map<string, Set<string>>(), pans = new Map<string, Set<string>>(), clients = new Map<string, number>();
  const hold = (key: string, firm: string) => open.has(firm) && holders.set(key, (holders.get(key) ?? new Set()).add(firm));
  for await (const rows of pages((from) => admin.from("firms").select("id, gstin").neq("status", "closed").order("id").range(from, from + 999)))
    for (const firm of rows) {
      open.add(firm.id);
      if (firm.gstin) hold(`pan ${firm.gstin.slice(2, 12).toUpperCase()}`, firm.id);
    }
  for await (const rows of pages((from) => admin.from("firm_members").select("firm_id, user_id").eq("role", "owner").order("firm_id").order("user_id").range(from, from + 999)))
    for (const owner of rows) hold(`owner ${owner.user_id}`, owner.firm_id);
  for await (const rows of pages((from) => admin.from("connected_accounts").select("id, firm_id, kind, provider, address_enc").neq("provider", "local").order("id").range(from, from + 999)))
    for (const account of rows) {
      const address = (await crypto.decrypt(account.firm_id, `accounts/${account.id}/address`, account.address_enc).catch(() => "")).trim().toLowerCase();
      // A mailbox is the same over any provider; a drive account is its provider's.
      if (address) hold(account.kind === "mail" ? `mail ${address}` : `drive ${account.provider}:${address}`, account.firm_id);
    }
  for await (const rows of pages((from) => admin.from("client_registrations").select("id, firm_id, client_id, kind, number_enc").in("kind", ["pan", "gstin"]).order("id").range(from, from + 999)))
    for (const row of rows.filter((row) => open.has(row.firm_id))) {
      const number = (await crypto.decrypt(row.firm_id, `clients/${row.client_id}/${row.kind}`, row.number_enc).catch(() => "")).toUpperCase();
      const pan = row.kind === "gstin" ? number.slice(2, 12) : number;
      if (pan.length !== 10) continue;
      const firms = pans.get(pan) ?? pans.set(pan, new Set()).get(pan)!;
      if (firms.has(row.firm_id)) continue;
      firms.add(row.firm_id);
      clients.set(row.firm_id, (clients.get(row.firm_id) ?? 0) + 1);
    }

  const pairs = new Map<string, Set<string>>();
  for (const [key, firms] of holders) for (const pair of twos([...firms])) pairs.set(pair, (pairs.get(pair) ?? new Set()).add(key.split(" ")[0]));
  const shared = new Map<string, number>();
  for (const firms of pans.values()) for (const pair of twos([...firms])) shared.set(pair, (shared.get(pair) ?? 0) + 1);
  const shareOf = (pair: string, count: number) => count / Math.min(...pair.split(" ").map((firm) => clients.get(firm) ?? 1));
  for (const [pair, count] of shared) if (count >= CLIENTS && shareOf(pair, count) >= SHARE) pairs.set(pair, (pairs.get(pair) ?? new Set()).add("clients"));

  const { data: kept, error } = await admin.from("platform_settings").select("value").eq("key", "split_firms").maybeSingle();
  if (error) return { retry: "split_firms_not_read" };
  const before = new Map(((kept?.value as { flags?: Flag[] } | undefined)?.flags ?? []).map((flag) => [flag.firms.join(" "), flag]));
  const flags = [...pairs].map(([pair, kinds]): Flag => {
    const old = before.get(pair), evidence = [...kinds].sort(), count = shared.get(pair) ?? 0;
    // A verdict stands until a new kind of match appears.
    const checked = old?.checked && evidence.every((kind) => old.checked!.evidence.includes(kind)) ? old.checked : undefined;
    return { firms: pair.split(" "), evidence, ...(count && { clients: count, share: Math.round(100 * shareOf(pair, count)) }), since: old?.since ?? new Date().toISOString(), ...(checked && { checked }) };
  });
  const { error: saveError } = await admin.from("platform_settings").upsert({ key: "split_firms", value: { flags, at: new Date().toISOString() } as unknown as NonNullable<Json> });
  return saveError ? { retry: "split_firms_not_saved" } : { done: true };
};
