import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
    // Integration tests hit the real dev database sequentially -- the pglite
    // dev DB is a single connection-pooled instance, and tests create/clean
    // up their own uniquely-emailed users rather than needing isolation.
    fileParallelism: false,
  },
});
