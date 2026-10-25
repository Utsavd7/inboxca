import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
// PORT lets the checks run beside a server that is already using 3000.
const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
// The job worker's secret for the test server only; never a real one.
export const TEST_WORKER_SECRET = "test-only-worker-secret";
export const FILE_WORKER_SECRET = process.env.FILE_WORKER_SECRET ||= randomBytes(32).toString("hex");
export const FILE_WORKER_URL = `http://127.0.0.1:${Number(process.env.PORT || 3000) + 1}`;
// Runs on one machine share the database and mail server: each port gets its own drive
// folder, and its server runs only the jobs of firms its own tests made (seedFirm marks them).
export const TEST_DRIVE = `${tmpdir()}/inboxca-test-drive-${process.env.PORT || 3000}`;
export const TEST_RUN = `port-${process.env.PORT || 3000}`;
// A phone notification key pair for the test server only, made fresh for each run.
const push = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
const pushPublic = Buffer.concat([Buffer.of(4), Buffer.from(push.x!, "base64url"), Buffer.from(push.y!, "base64url")]).toString("base64url");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: origin, trace: "on-first-retry" },
  webServer: [{
    command: "npm run worker", url: `${FILE_WORKER_URL}/health`,
    env: { FILE_WORKER_SECRET, FILE_WORKER_PORT: String(Number(process.env.PORT || 3000) + 1), FILE_WORKER_TEST: "1", MAIL_ALLOW_LOCAL: "1", DRIVE_LOCAL_DIR: TEST_DRIVE },
  }, {
    command: "npm run start",
    url: origin,
    reuseExistingServer: !process.env.CI,
    env: { FILE_WORKER_SECRET, FILE_WORKER_URL, JOB_WORKER_SECRET: TEST_WORKER_SECRET, MAIL_ALLOW_LOCAL: "1", REMINDERS_ANY_HOUR: "1", APP_BASE_URL: origin, OFFICE_IP_HEADER: "x-test-ip", DRIVE_LOCAL_DIR: TEST_DRIVE, JOB_FIRMS_TEST: TEST_RUN, VAPID_PUBLIC_KEY: pushPublic, VAPID_PRIVATE_KEY: push.d! },
  }],
});
