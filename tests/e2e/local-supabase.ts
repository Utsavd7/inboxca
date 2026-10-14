import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// The local Supabase connection, from .env.local (written by `npm run db:env`) or the
// environment. Tests that need it skip themselves when it is missing.
export function localSupabase() {
  const file = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const fromFile = Object.fromEntries(
    file
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  const get = (key: string) => process.env[key] || fromFile[key] || "";
  return {
    url: get("SUPABASE_URL"),
    secretKey: get("SUPABASE_SECRET_KEY"),
    dbUrl: get("TEST_DB_URL"),
    mailUrl: get("TEST_MAIL_URL"),
  };
}

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
