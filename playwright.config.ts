import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";
// PORT lets the checks run beside a server that is already using 3000.
const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
// The job worker's secret for the test server only; never a real one.
export const TEST_WORKER_SECRET = "test-only-worker-secret";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: origin, trace: "on-first-retry" },
  webServer: {
    command: "npm run start",
    url: origin,
    reuseExistingServer: !process.env.CI,
    env: { JOB_WORKER_SECRET: TEST_WORKER_SECRET, MAIL_ALLOW_LOCAL: "1", DRIVE_LOCAL_DIR: `${tmpdir()}/inboxca-test-drive` },
  },
});
