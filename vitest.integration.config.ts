import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~encore/auth": fileURLToPath(
        new URL("./encore.gen/auth/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    include: ["foundation/**/*.test.ts"],
    exclude: [
      "foundation/authorization/policy.test.ts",
      "foundation/**/*.unit.test.ts",
    ],
  },
});
