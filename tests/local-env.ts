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
    hmacKey: get("APP_HMAC_KEY"),
    dbUrl: get("TEST_DB_URL"),
    mailUrl: get("TEST_MAIL_URL"),
  };
}
