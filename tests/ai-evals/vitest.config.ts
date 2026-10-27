import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The AI eval suite (npm run test:ai-evals, PLAN.md 5.11): real model calls, so it runs only
// with OPENAI_API_KEY set and skips itself otherwise, in CI too.
const root = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    include: ["tests/ai-evals/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    env: { APP_BASE_URL: "https://app.inboxca.test" },
  },
});
