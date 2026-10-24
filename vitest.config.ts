import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database tests share one Postgres database; run files one at a time.
    fileParallelism: false,
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 20000,
  },
});
