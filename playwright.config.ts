import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
import { fakeKeyValues } from "./tests/fake-mail";
// PORT lets the checks run beside a server that is already using 3000.
const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
// The job worker's secret for the test server only; never a real one.
export const TEST_WORKER_SECRET = "test-only-worker-secret";
export const FILE_WORKER_SECRET = process.env.FILE_WORKER_SECRET ||= randomBytes(32).toString("hex");
export const FILE_WORKER_URL = `http://127.0.0.1:${Number(process.env.PORT || 3000) + 1}`;
// The file worker's virus check talks to a stand in for ClamAV that finds only the EICAR test string.
// PORT+2 is the fake mail providers' (MAIL_API_URL below).
const CLAMD_PORT = Number(process.env.PORT || 3000) + 3;
// Runs on one machine share the database and mail server: each port gets its own drive
// folder, and its server runs only the jobs of firms its own tests made (seedFirm marks them).
export const TEST_DRIVE = `${tmpdir()}/inboxca-test-drive-${process.env.PORT || 3000}`;
export const TEST_WORKSPACE = `${tmpdir()}/inboxca-test-workspace-${process.env.PORT || 3000}`;
export const TEST_RUN = `port-${process.env.PORT || 3000}`;
// The fake Google, Microsoft and Zoho (tests/fake-mail.ts) that mail sign in uses in tests,
// with invented keys for them; mail-sign-in.spec.ts starts it on this port.
export const MAIL_API_URL = `http://127.0.0.1:${Number(process.env.PORT || 3000) + 2}`;
// An invented Dropbox app secret, so the test server takes change notices signed with it.
export const DROPBOX_TEST_SECRET = "invented-dropbox-app-secret";
// The fake Dropbox (drive-reconnect.spec.ts starts it) that Connect and Reconnect sign in to,
// with an invented app key.
export const DROPBOX_TEST_URL = `http://127.0.0.1:${Number(process.env.PORT || 3000) + 4}`;
// Invented client IDs, so the test server shows Continue with Google and Microsoft; the tests
// answer Supabase's sign in themselves and never reach either (social-sign-in.spec.ts).
export const SIGN_IN_IDS = { SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "invented-google-sign-in", SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID: "invented-microsoft-sign-in" };
// An invented ITR software ID and city, so the test servers can make return files; never a real one.
const ITR = { ITR_SOFTWARE_ID: "SW00000000", ITR_SOFTWARE_CITY: "Invented City" };
// A phone notification key pair for the test server only, made fresh for each run.
const push = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
const pushPublic = Buffer.concat([Buffer.of(4), Buffer.from(push.x!, "base64url"), Buffer.from(push.y!, "base64url")]).toString("base64url");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // Mail, sign in and filing steps can pass 5 seconds when other runs load the machine.
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { baseURL: origin, trace: "on-first-retry" },
  webServer: [{
    command: "node --experimental-strip-types tests/fixtures/fake-clamd.ts", port: CLAMD_PORT, env: { CLAMD_PORT: String(CLAMD_PORT) },
  }, {
    command: "npm run worker", url: `${FILE_WORKER_URL}/health`,
    env: { FILE_WORKER_SECRET, FILE_WORKER_PORT: String(Number(process.env.PORT || 3000) + 1), FILE_WORKER_TEST: "1", MAIL_ALLOW_LOCAL: "1", MAIL_API_TEST_URL: MAIL_API_URL, DRIVE_LOCAL_DIR: TEST_DRIVE, CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(CLAMD_PORT), ...ITR },
  }, {
    command: "npm run start",
    url: origin,
    reuseExistingServer: !process.env.CI,
    env: { FILE_WORKER_SECRET, FILE_WORKER_URL, JOB_WORKER_SECRET: TEST_WORKER_SECRET, MAIL_ALLOW_LOCAL: "1", REMINDERS_ANY_HOUR: "1", APP_BASE_URL: origin, OFFICE_IP_HEADER: "x-test-ip", COUNTRY_HEADER: "x-test-country", DRIVE_LOCAL_DIR: TEST_DRIVE, WORKSPACE_LOCAL_DIR: TEST_WORKSPACE, JOB_FIRMS_TEST: TEST_RUN, VAPID_PUBLIC_KEY: pushPublic, VAPID_PRIVATE_KEY: push.d!, SYSTEM_MAIL_URL: "smtp://127.0.0.1:3025/?ignoreTLS=true", EMAIL_FROM_DOMAIN: "invented.test", MAIL_API_TEST_URL: MAIL_API_URL, DROPBOX_APP_SECRET: DROPBOX_TEST_SECRET, DROPBOX_APP_KEY: "invented-dropbox-app-key", DROPBOX_TEST_URL, ...fakeKeyValues, ...ITR, ...SIGN_IN_IDS },
  }],
});
