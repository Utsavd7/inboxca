// npm run preview: the real InboxCA on this laptop, with the invented demo firm, in one go. Starts
// Docker (colima), the local Supabase and the test mail server when they are stopped, sets up
// .env.local's local lines when they are missing, applies new migrations, makes or refreshes the
// demo firm, builds when the code changed, then runs the app with its file worker and jobs runner
// and opens the sign in page. Ctrl C stops what it started here; Docker keeps running.
// PORT picks the port (3300 by default); --no-build uses the last build; --no-open opens no browser.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { DEMO_PEOPLE } from "../src/lib/dev-login.ts";

const port = Number(process.env.PORT || 3300);
const origin = `http://127.0.0.1:${port}`;
const step = (text) => console.log(`\n> ${text}`);
const stop = (text) => {
  console.error(`\nStopped: ${text}`);
  process.exit(1);
};
const ok = (command, args) => spawnSync(command, args, { stdio: "ignore" }).status === 0;
const run = (command, ...args) => {
  if (spawnSync(command, args, { stdio: "inherit" }).status !== 0) stop(`${command} ${args.join(" ")} did not finish (see above).`);
};
// .env.local's lines by name, kept in memory only: none is ever printed.
const local = () => Object.fromEntries((existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "").split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));

step("Docker");
if (ok("docker", ["info"])) console.log("Docker is running.");
else if (ok("colima", ["version"])) run("colima", "start");
else stop("Docker is not running. Start it (colima start, or Docker Desktop), then run npm run preview again.");

step("Local Supabase");
if (ok("npx", ["supabase", "status"])) console.log("Supabase is running.");
else run("npx", "supabase", "start");

step("Test mail server (GreenMail)");
const greenmail = spawnSync("docker", ["ps", "-a", "--filter", "name=^greenmail$", "--format", "{{.State}}"], { encoding: "utf8" }).stdout.trim();
if (greenmail && greenmail !== "running") run("docker", "start", "greenmail");
console.log(greenmail ? "GreenMail is running." : "No greenmail container, so the demo firm's mailbox stays empty (README, See the app on your laptop).");

step("Settings in .env.local");
// When one the app needs is missing, npm run db:env writes the local lines and keeps every other.
if (["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "TEST_DB_URL", "LOCAL_KEK", "APP_HMAC_KEY"].some((name) => !local()[name])) run("npm", "run", "db:env");
else console.log("The local Supabase lines are there.");

step("Database changes");
run("npx", "supabase", "migration", "up");

step("Demo firm, with invented data only");
run("npm", "run", "demo");
run("npm", "run", "demo:data");
if (greenmail) run("npm", "run", "demo:mail");

step("Build");
const newest = (path) => (statSync(path).isDirectory() ? Math.max(0, ...readdirSync(path).map((name) => newest(`${path}/${name}`))) : statSync(path).mtimeMs);
const built = existsSync(".next/BUILD_ID") ? statSync(".next/BUILD_ID").mtimeMs : 0;
const changed = built < Math.max(...["app", "components", "content", "public", "src", "next.config.ts", "proxy.ts", "instrumentation.ts", "package-lock.json"].filter(existsSync).map(newest));
if (process.argv.includes("--no-build") || !changed) {
  if (!built) stop("there is no build yet: run npm run preview without --no-build.");
  console.log(changed ? "Using the last build (--no-build)." : "The last build is up to date.");
} else run("npm", "run", "build");

step(`Starting InboxCA on ${origin}`);
const env = local();
const files = { FILE_WORKER_URL: `http://127.0.0.1:${port + 1}`, FILE_WORKER_SECRET: randomBytes(32).toString("hex") };
const jobs = randomBytes(32).toString("hex");
// For this run only, never written to a file. Lines already in .env.local or the shell win
// where they exist; DEV_LOGIN turns on the developer person switcher (src/lib/dev-login.ts).
const unset = (values) => Object.fromEntries(Object.entries(values).filter(([name]) => !(name in process.env) && !(name in env)));
const shared = { ...unset({ MAIL_ALLOW_LOCAL: "1", ...(greenmail && { SYSTEM_MAIL_URL: "smtp://127.0.0.1:3025/?ignoreTLS=true", EMAIL_FROM_DOMAIN: "invented.test" }) }), ...files };
const children = [
  // The file worker reads no .env file itself (next start does), so it gets .env.local's lines
  // here: without MAIL_ALLOW_LOCAL it refuses the test mail server and the Inbox shows no mail.
  spawn(process.execPath, ["--experimental-strip-types", "worker/server.ts"], { stdio: "inherit", env: { ...env, ...process.env, ...shared, FILE_WORKER_PORT: String(port + 1) } }),
  // Only on this laptop's own address, so no one else on the network reaches it.
  spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", String(port)], { stdio: "inherit", env: { ...process.env, ...shared, JOB_WORKER_SECRET: jobs, APP_BASE_URL: origin, DEV_LOGIN: "1" } }),
];
let runner;
let stopping = false;
const end = (code) => {
  if (stopping) return;
  stopping = true;
  clearInterval(runner);
  for (const child of children) child.kill("SIGTERM");
  console.log("\nInboxCA stopped. Docker and the local Supabase keep running: stop them with npx supabase stop, then colima stop.");
  process.exit(code);
};
process.on("SIGINT", () => end(0));
process.on("SIGTERM", () => end(0));
for (const child of children) child.on("exit", () => end(stopping ? 0 : 1));

for (let tries = 0; ; tries++) {
  if (await fetch(`${origin}/sign-in`).then((response) => response.ok, () => false)) break;
  if (tries > 120) stop(`InboxCA did not answer on ${origin}.`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
// The jobs runner: in a deployment Supabase Cron calls /api/jobs every minute; here this does.
const sweep = () => fetch(`${origin}/api/jobs`, { method: "POST", headers: { Authorization: `Bearer ${jobs}` } }).catch(() => {});
sweep();
runner = setInterval(sweep, 60_000);
if (!process.argv.includes("--no-open")) spawn(process.platform === "darwin" ? "open" : "xdg-open", [`${origin}/sign-in`], { stdio: "ignore" }).on("error", () => {});

console.log(`
InboxCA is running at ${origin}/sign-in (Ctrl C stops it). Every firm, person and paper in it is invented.

Sign in with the real two steps:
  1. Email: ${DEMO_PEOPLE.owner} (the demo owner). The email code arrives in the local mail viewer: ${env.TEST_MAIL_URL ?? "http://127.0.0.1:54324"}
  2. 2 step code: run npm run demo:code in another terminal.
Other demo people, each with their own 2 step code (npm run demo:code <role>):
${Object.entries(DEMO_PEOPLE).slice(1).map(([role, email]) => `  ${role.padEnd(11)} ${email}`).join("\n")}
Or click a person in the "Developer preview, demo firm only" bar at the foot of the page.`);
