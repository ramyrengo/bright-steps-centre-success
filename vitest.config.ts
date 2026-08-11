import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "foundation/authorization/policy.test.ts",
      "foundation/**/*.unit.test.ts",
    ],
  },
});
