import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    include: ["test/**/*.test.ts"],
    // Integration tests share one disposable database; run files serially.
    fileParallelism: false,
    testTimeout: 30000
  }
});
