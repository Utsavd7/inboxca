import { defineConfig } from "@playwright/test";
// PORT lets the checks run beside a server that is already using 3000.
const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
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
  },
});
