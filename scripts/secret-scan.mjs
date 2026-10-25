// Fails when a file in git holds a key, a token or a private key, or when an env file is not
// ignored (PLAN.md 8.9). No dependency: git lists the files and these patterns read them. It
// names the file, the line and the kind of secret, never the secret. Run in CI.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const patterns = [
  ["a private key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a Stripe or Razorpay key", /\b(?:[sr]k_live_[A-Za-z0-9]{16,}|rzp_(?:live|test)_[A-Za-z0-9]{10,})/],
  ["an OpenAI key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a Supabase key", /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}/],
  ["a SendGrid key", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/],
  ["a signed token (JWT)", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a password in an address", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]+)@(?!(?:127\.0\.0\.1|localhost)[:/])/i],
  ["a secret set in a file", /^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|API_KEY|TOTP)[A-Z0-9_]*\s*=\s*['"]?[^\s'"#]{8,}/],
];

// A caught password that only shows where one goes, as in smtps://user:password@host.
const placeholder = /^(password|passwd|pass|secret|[A-Z0-9_]+|\$\{?[\w.]+\}?|<[^>]*>|x+|\*+)$/;

// Env files must stay out of git; only the example, with no values for secrets, is kept.
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.development", ".env.test"];

export function findSecrets(file, text) {
  const found = [];
  text.split("\n").forEach((line, at) => {
    if (/\bggignore\b/.test(line)) return; // a published example key, marked for GitGuardian to skip
    for (const [kind, pattern] of patterns) {
      const match = pattern.exec(line);
      if (match && !(match[1] && placeholder.test(match[1]))) found.push(`${file}:${at + 1}: ${kind}`);
    }
  });
  return found;
}

export function scan(cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const problems = [];
  for (const file of git("ls-files", "-z").split("\0").filter(Boolean)) {
    if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".env.example")) problems.push(`${file}: an env file in git`);
    if (file === "package-lock.json") continue;
    let bytes;
    try {
      bytes = readFileSync(`${cwd}/${file}`);
    } catch {
      continue; // removed from the working tree, not yet from git
    }
    if (bytes.subarray(0, 8000).includes(0)) continue; // images, fonts, sound
    problems.push(...findSecrets(file, bytes.toString("utf8")));
  }
  for (const file of ENV_FILES) {
    try {
      git("check-ignore", "-q", "--no-index", file);
    } catch {
      problems.push(`${file}: not ignored by .gitignore`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = scan();
  for (const problem of problems) console.error(problem);
  if (problems.length) {
    console.error(`Secret scan: ${problems.length} found. Remove them, rotate any real key, and keep secrets in .env.local.`);
    process.exit(1);
  }
  console.log("Secret scan: nothing found.");
}
