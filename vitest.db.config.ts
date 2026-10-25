import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests run against local Supabase (npx supabase start). One file at a time,
// because they share one database; each test rolls its own changes back.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    // Other runs share the database and the machine. A test cut off mid transaction leaves
    // the next one outside it (its rows then commit), so give lock waits and load room.
    testTimeout: 30_000,
    env: { MAIL_ALLOW_LOCAL: "1" },
  },
});
