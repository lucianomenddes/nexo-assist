import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@nexo-assist/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/database/src/**/*.integration.test.ts",
      "apps/ticket-service/src/**/*.integration.test.ts",
      "apps/nexo-assist-agent/src/**/*.integration.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
