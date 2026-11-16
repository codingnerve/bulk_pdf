import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/tests/global-setup.ts"],
    setupFiles: ["src/tests/setup.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
