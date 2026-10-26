import { createHmac, randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
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

// A base32 key for a person's authenticator app, for seedFirm and signIn.
export const appKey = () => Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");

// Another active member of a seeded firm, with their authenticator app set up. The firm's
// remove() deletes them when given their email.
export async function addPerson(firmId: string, email: string, role: string, key: string) {
  const local = localSupabase();
  const admin = createClient(local.url, local.secretKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  await query(local.dbUrl, "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, $3, 'active')", [firmId, data.user.id, role]);
  await query(local.dbUrl, "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Test app', 'totp', 'verified', $2, now(), now())", [data.user.id, key]);
  return data.user.id;
}

// The whole sign in, for someone whose authenticator app is already set up.
export async function signIn(page: Page, email: string, key: string) {
  await emailStep(page, email);
  await page.getByLabel("6 digit code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

// The local GreenMail server makes a mailbox (its password the address) for every address it
// receives mail for, so a first email makes one.
export const testSmtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
export const makeMailbox = (address: string) => testSmtp.sendMail({ from: "setup@invented.test", to: address, subject: "Invented test setup", text: "Makes the test mailbox" });

// The text of every email in a GreenMail mailbox but the one that made it, oldest first.
export async function mailTexts(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  await imap.connect();
  try {
    const texts: string[] = [];
    if ((await imap.mailboxOpen("INBOX")).exists) for await (const message of imap.fetch("1:*", { source: true })) texts.push((await simpleParser(message.source!)).text ?? "");
    return texts.filter((text) => !text.includes("Makes the test mailbox"));
  } finally {
    await imap.logout();
  }
}

// Connects the firm's email to a GreenMail mailbox.
export async function connectTestMailbox(page: Page, address: string) {
  await makeMailbox(address);
  await page.goto("/app/settings?group=email");
  const card = page.locator("section#mailbox");
  await card.getByLabel("The firm's email address").fill(address);
  await card.getByLabel("Its password").fill(address);
  await card.getByText("Change server settings").click();
  await card.getByLabel("Incoming (IMAP) server").fill("127.0.0.1");
  await card.getByLabel("Incoming port").fill("3143");
  await card.getByLabel("Outgoing (SMTP) server").fill("127.0.0.1");
  await card.getByLabel("Outgoing port").fill("3025");
  await card.getByRole("button", { name: "Connect email" }).click();
  await expect(card.getByRole("status")).toHaveText(`Connected: ${address}`);
}

// Runs the test server's job worker until the firm has no due or running job. Every worker of
// a run shares that server, and another worker's sweep may be holding this firm's job, so a
// fixed number of sweeps can return before the work is done.
export async function runJobs(request: APIRequestContext, firmId: string) {
  const { TEST_WORKER_SECRET } = await import("../../playwright.config");
  const left = "select count(*)::int as n from public.jobs where firm_id = $1 and (state = 'claimed' or state = 'pending' and run_at <= now())";
  await expect.poll(async () => {
    await request.post("/api/jobs", { headers: { Authorization: `Bearer ${TEST_WORKER_SECRET}` } });
    return (await query(localSupabase().dbUrl, left, [firmId]))[0].n;
  }, { timeout: 60_000 }).toBe(0);
}

// Reads the firm's mailbox now, with every job that starts. private.queue_mail_polls() queues
// at most one poll an account a minute, for every firm in the shared database, so another
// run's call can leave this firm's poll already done (or held by another sweep) before the
// mail arrived. This waits for any poll under way, then runs one of the firm's own.
export async function pollFirmMail(request: APIRequestContext, firmId: string) {
  await runJobs(request, firmId);
  await query(localSupabase().dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) select firm_id, 'mail_poll', 'account', id, 'mail_poll:test:' || gen_random_uuid() from public.connected_accounts where firm_id = $1 and kind = 'mail' and status = 'connected'", [firmId]);
  await runJobs(request, firmId);
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

// The newest email to an address on the local test mail server (GreenMail), where the test
// server sends Orelu's system email, as text; empty until one arrives.
export async function systemMail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX");
    const message = await imap.fetchOne("*", { source: true });
    return message && message.source ? ((await simpleParser(message.source)).text ?? "") : "";
  } catch {
    return "";
  } finally {
    await imap.logout().catch(() => {});
  }
}
