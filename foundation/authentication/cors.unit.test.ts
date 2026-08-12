import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

interface EncoreConfiguration {
  global_cors?: {
    allow_origins_without_credentials?: string[];
    allow_origins_with_credentials?: string[];
  };
}

describe("authenticated browser CORS boundary", () => {
  test("allows only the reviewed local and staging frontend origins", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../encore.app", import.meta.url), "utf8"),
    ) as EncoreConfiguration;

    expect(config.global_cors?.allow_origins_without_credentials).toEqual([
      "http://localhost:3000",
    ]);
    expect(config.global_cors?.allow_origins_with_credentials).toEqual([
      "http://localhost:3000",
      "https://bright-steps-centre-success-staging.vercel.app",
    ]);
    const serializedCors = JSON.stringify(config.global_cors);
    expect(serializedCors).not.toContain("*");
    expect(serializedCors).not.toContain("https://*.vercel.app");
    expect(serializedCors).not.toContain(
      "https://staging-bright-steps-centre-success-uwhi.encr.app",
    );
  });
});
