import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect } from "./db";

// Supabase Auth asks this hook before it makes a new login: only Google and Microsoft may.
let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const event = (provider: string) => ({
  metadata: { uuid: "00000000-0000-4000-8000-000000000001", time: "2026-10-26T10:00:00Z", name: "before-user-created", ip_address: "127.0.0.1" },
  user: { email: "owner@invented.test", app_metadata: { provider, providers: [provider] } },
});

it("lets Google and Microsoft make a login and refuses a password, an email code or a phone", async () => {
  const ask = async (provider: string) => (await db.query("select private.only_provider_sign_ups($1) as answer", [event(provider)])).rows[0].answer;
  expect(await ask("google")).toEqual({});
  expect(await ask("azure")).toEqual({});
  for (const provider of ["email", "phone", "anonymous", ""])
    expect(await ask(provider)).toEqual({ error: { http_code: 403, message: "Sign up with Google or Microsoft, or on the sign up page." } });
});

it("is for Supabase Auth only", async () => {
  const may = async (role: string) => (await db.query("select has_function_privilege($1, 'private.only_provider_sign_ups(jsonb)', 'execute') as yes", [role])).rows[0].yes;
  expect(await may("supabase_auth_admin")).toBe(true);
  for (const role of ["anon", "authenticated", "service_role"]) expect(await may(role), role).toBe(false);
});
