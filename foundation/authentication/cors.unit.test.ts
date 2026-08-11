import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

interface EncoreConfiguration {
  global_cors?: {
    allow_origins_without_credentials?: string[];
    allow_origins_with_credentials?: string[];
  };
}

describe("authenticated local CORS boundary", () => {
  test("allows only the reviewed local frontend origin", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../encore.app", import.meta.url), "utf8"),
    ) as EncoreConfiguration;

    expect(config.global_cors?.allow_origins_without_credentials).toEqual([
      "http://localhost:3000",
    ]);
    expect(config.global_cors?.allow_origins_with_credentials).toEqual([
      "http://localhost:3000",
    ]);
    expect(JSON.stringify(config.global_cors)).not.toContain("*");
  });
});
