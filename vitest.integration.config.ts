import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["foundation/**/*.test.ts"],
    exclude: ["foundation/authorization/policy.test.ts"],
  },
});
