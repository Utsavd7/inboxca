import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findSecrets, scan } from "@/scripts/secret-scan.mjs";

// The fake secrets are put together here at run time, so this file never holds one itself.
const fake = {
  aws: ["AKIA", "Q".repeat(16)].join(""),
  key: ["-----BEGIN ", "RSA PRIVATE KEY-----"].join(""),
  supabase: ["sb_", "secret_", "x".repeat(32)].join(""),
  jwt: ["eyJ", "a".repeat(20), ".eyJ", "b".repeat(20), ".", "c".repeat(20)].join(""),
  github: ["ghp_", "A".repeat(36)].join(""),
  openai: ["sk-", "proj-", "z".repeat(40)].join(""),
  address: ["postgresql://admin:", "hunter2hunter2", "@db.example.com/inboxca"].join(""),
  env: ["JOB_WORKER_", "SECRET=", "s3cr3t-value-1234"].join(""),
};

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

// A small git repository with these files, and a .gitignore that keeps env files out.
function repo(files: Record<string, string>, ignore = ".env\n.env.*\n!.env.example\n") {
  const dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(dir, ".gitignore"), ignore);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  git("add", "-A", "-f");
  return dir;
}

describe("the secret scan", () => {
  it("catches each kind of key and token, and names the kind, never the secret", () => {
    for (const [name, secret] of Object.entries(fake)) {
      const found = findSecrets(`fixture-${name}.ts`, `const ok = 1;\n${name === "env" ? secret : `const value = "${secret}";`}\n`);
      expect(found, name).toHaveLength(1);
      expect(found[0]).toMatch(new RegExp(`^fixture-${name}\\.ts:2: `));
      expect(found[0]).not.toContain(secret);
    }
  });

  it("leaves ordinary code, ids, hashes and the local test database alone", () => {
    const text = [
      'const id = "00000000-0000-4000-8000-00000000000a";',
      'const hash = "' + "ab".repeat(32) + '";',
      'const db = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";',
      "# smtps://SMTP_USER:SMTP_PASSWORD@email-smtp.ap-south-1.amazonaws.com:465",
      "// smtps://user:password@email-smtp.ap-south-1.amazonaws.com:465",
      "SUPABASE_SECRET_KEY=",
      "JOB_WORKER_SECRET: secret,",
      `const example = "${["AKIA", "IOSFODNN7EXAMPLE"].join("")}"; // ggignore: AWS published example key`,
    ].join("\n");
    expect(findSecrets("ordinary.ts", text)).toEqual([]);
  });

  it("fails a repository with a key in a file, or an env file in git, and passes a clean one", () => {
    expect(scan(repo({ "app.ts": "export const ok = 1;\n", ".env.example": "JOB_WORKER_SECRET=\n" }))).toEqual([]);
    expect(scan(repo({ "config.ts": `export const key = "${fake.aws}";\n` }))).toEqual(["config.ts:1: an AWS access key"]);
    expect(scan(repo({ ".env.local": `${fake.env}\n` }))).toEqual([".env.local: an env file in git", ".env.local:1: a secret set in a file"]);
    expect(scan(repo({ "app.ts": "export const ok = 1;\n" }, "node_modules/\n"))).toEqual(
      [".env", ".env.local", ".env.production", ".env.development", ".env.test"].map((file) => `${file}: not ignored by .gitignore`),
    );
  });
});
