import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import type { Browser } from "@playwright/test";
import { serverCrypto } from "@/src/lib/crypto";
import { inventedGstin } from "../fixtures/portal";
import { appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// New from the government (D42): items the daily check found wait in the shared 'watch' row;
// tests add theirs and take them out after.
const local = localSupabase();
export const govItems = {
  add: (items: object[]) => query(local.dbUrl, "insert into public.platform_settings (key, value) values ('watch', jsonb_build_object('items', $1::jsonb)) on conflict (key) do update set value = jsonb_set(public.platform_settings.value, '{items}', coalesce(public.platform_settings.value -> 'items', '[]') || $1::jsonb)", [JSON.stringify(items)]),
  remove: (ids: string[]) => query(local.dbUrl, "update public.platform_settings set value = jsonb_set(value, '{items}', (select coalesce(jsonb_agg(i), '[]') from jsonb_array_elements(value -> 'items') i where not i ->> 'id' = any($1))) where key = 'watch'", [ids]),
};
export const indiaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// A firm whose one client has the given work on its GSTIN or PAN, with its owner signed in.
export async function firmWith(browser: Browser, kind: "gstin" | "pan", services: string[]) {
  loadEnvConfig(process.cwd());
  const key = appKey(), email = `gov-${randomUUID()}@invented.test`, client = randomUUID(), crypto = serverCrypto();
  const firm = await seedFirm(`Invented ${kind === "gstin" ? "GST" : "Income Tax"} Work Firm`, email, key);
  const number = kind === "gstin" ? inventedGstin() : "ZZZPZ0001Z";
  await query(local.dbUrl, "insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Invented Work Client', 'business')", [client, firm.firmId]);
  await query(local.dbUrl, "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, services) values ($1, $2, $3, $4, $5, $6)", [
    firm.firmId, client, kind, await crypto.encrypt(firm.firmId, `clients/${client}/${kind}`, number), await crypto.blindIndex(firm.firmId, kind, number), services,
  ]);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, key);
  return { page, firm, close: async () => { await context.close().catch(() => {}); await firm.remove(); } };
}
