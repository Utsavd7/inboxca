// Writes the local Supabase connection into .env.local (kept out of git), so that
// `npm run dev`, `npm run start` and the browser tests reach the local database.
// Run after `npx supabase start`. Other lines already in .env.local are kept.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const status = JSON.parse(
  execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const existing = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const values = {
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  TEST_DB_URL: status.DB_URL,
  TEST_MAIL_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
  // The outer encryption key for development and tests only (production uses AWS KMS).
  // Kept once made: data encrypted with it can not be read with another.
  LOCAL_KEK: existing.match(/^LOCAL_KEK=(.+)$/m)?.[1] ?? randomBytes(32).toString("base64"),
  // A test drive in a folder of this checkout (kept out of git), until a real one is linked.
  DRIVE_LOCAL_DIR: `${process.cwd()}/.test-drive`,
};
for (const [key, value] of Object.entries(values))
  if (!value) throw new Error(`supabase status did not report ${key}; is it running?`);

const kept = existing
  ? existing
      .split("\n")
      .filter((line) => line && !Object.keys(values).some((key) => line.startsWith(`${key}=`)))
  : [];
writeFileSync(
  ".env.local",
  [...kept, ...Object.entries(values).map(([key, value]) => `${key}=${value}`)].join("\n") + "\n",
);
console.log("Wrote the local Supabase connection to .env.local");
