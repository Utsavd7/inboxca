import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure code: no browser, no server, no network.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Tests without a scanner keep the optional check; those of the required one say so themselves.
    env: { SCAN_OPTIONAL: "1" },
  },
});
