import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

// The open source software and fonts InboxCA is built with, and each one's licence text, as
// their licences ask when copies are passed on (the pages send parts of them to the browser).
// Written at build time from package-lock.json and the installed packages, so it never drifts:
// every package the app needs to run (not test or build tools) that is installed here.
export function GET() {
  const root = process.cwd();
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string; license?: string; dev?: boolean; devOptional?: boolean }> };
  const parts = Object.entries(lock.packages)
    .filter(([at, info]) => at.startsWith("node_modules/") && !info.dev && !info.devOptional && existsSync(path.join(root, at)))
    .map(([at, info]) => {
      const name = at.slice(at.lastIndexOf("node_modules/") + 13);
      const file = readdirSync(path.join(root, at)).find((entry) => /^(licen[cs]e|copying)/i.test(entry));
      const text = file ? readFileSync(path.join(root, at, file), "utf8").trim() : `Licence: ${info.license ?? "see the package"}`;
      return `${name} ${info.version ?? ""}\n\n${text}`;
    })
    .sort();
  const fonts = ["Plus-Jakarta-Sans-OFL.txt", "IBM-Plex-Mono-OFL.txt"].map((file) => readFileSync(path.join(root, "app/fonts", file), "utf8").trim());
  const line = `\n\n${"=".repeat(72)}\n\n`;
  const body = `InboxCA is made by Orelu with the open source software and fonts below. Each is used under its own licence, given in full.${line}${[...fonts, ...parts].join(line)}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
