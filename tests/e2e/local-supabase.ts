import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { localSupabase } from "../local-env";

export { localSupabase };

// The newest sign in email to an address, from the local mail catcher (Mailpit).
export async function latestEmail(mailUrl: string, to: string, after = 0) {
  for (let tries = 0; tries < 40; tries++) {
    const search = await fetch(
      `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((response) => response.json());
    const newest = (search.messages ?? []).find(
      (message: { Created: string }) => Date.parse(message.Created) > after,
    );
    if (newest) {
      const message = await fetch(`${mailUrl}/api/v1/message/${newest.ID}`).then((response) =>
        response.json(),
      );
      const html = String(message.HTML ?? "");
      const code = html.match(/>\s*(\d{6})\s*</)?.[1] ?? String(message.Text).match(/\b(\d{6})\b/)?.[1];
      const link = html.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
      if (code) return { code, link };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign in email reached ${to}`);
}

// The 6 digit code an authenticator app shows for a key (RFC 6238, 30 second steps).
export function totp(secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  const value = (hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

export async function query(dbUrl: string, sql: string, params: unknown[] = []) {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

// An active firm and its owner, who can sign in by email. With a key, the owner's
// authenticator app is already set up. remove() deletes the firm, its log lines (which
// needs the purge flag) and the given people. The firm is marked with this run's tag, so
// only this run's test server runs its jobs.
export async function seedFirm(firmName: string, ownerEmail: string, totpKey?: string) {
  const local = localSupabase();
  const { TEST_RUN } = await import("../../playwright.config");
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email: ownerEmail, email_confirm: true });
  if (error) throw error;
  const ownerId = data.user.id;
  const [{ id: firmId }] = await query(
    local.dbUrl,
    "insert into public.firms (name, state_code, status, settings) values ($1, '27', 'active', $2) returning id",
    [firmName, { test_run: TEST_RUN }],
  );
  await query(
    local.dbUrl,
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
    [firmId, ownerId],
  );
  if (totpKey)
    await query(
      local.dbUrl,
      "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())",
      [ownerId, totpKey],
    );
  const remove = async (...emails: string[]) => {
    const client = new Client({ connectionString: local.dbUrl });
    await client.connect();
    await client.query("begin");
    await client.query("select set_config('app.log_purge', 'on', true)");
    await client.query("delete from public.firms where id = $1", [firmId]);
    await client.query("delete from auth.users where email = any($1)", [[ownerEmail, ...emails]]);
    await client.query("commit");
    await client.end();
  };
  return { ownerId, firmId, remove };
}

// Asks the sign in page for a code and returns that email. Supabase refuses a second code
// to the same address within a second or so, hence the wait.
let lastRequest = 0;
export async function askForCode(page: Page, email: string) {
  const wait = lastRequest + 2000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const sent = Date.now() - 1000;
  await page.goto("/sign-in");
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  return latestEmail(localSupabase().mailUrl, email, sent);
}

// The email step of signing in, through the real page.
export async function emailStep(page: Page, email: string) {
  const { code } = await askForCode(page, email);
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

// Use the server's form before browser hydration removes its action fields.
export async function actionFields(page: Page, path: string, values: Record<string, string>) {
  const html = await (await page.request.get(path)).text();
  return page.evaluate(({ html, values }) => {
    const forms = [...new DOMParser().parseFromString(html, "text/html").forms];
    const form = forms.find((form) => Object.entries(values).every(([name, value]) => [...form.querySelectorAll<HTMLInputElement>("input,button,select")].some((input) => input.name === name && input.value === value)));
    if (!form) throw new Error("No matching form");
    const fields = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));
    if (!Object.keys(fields).some((name) => name.startsWith("$ACTION_"))) throw new Error("No action in the server form");
    return fields;
  }, { html, values });
}

// Only the isolated file worker test server counts reads, without storing file contents.
export async function workerReads(file: string) {
  const { FILE_WORKER_URL, FILE_WORKER_SECRET } = await import("../../playwright.config");
  const response = await fetch(`${FILE_WORKER_URL}/_reads?file=${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${FILE_WORKER_SECRET}` } });
  if (!response.ok) throw new Error("Cannot read test count");
  return (await response.json()).reads as number;
}
