import type { EnvironmentMeta } from "encore.dev";
import { describe, expect, test } from "vitest";
import {
  assertSyntheticStandardsEnvironment,
  SyntheticStandardsSeedError,
} from "./synthetic-environment";

function environment(
  cloud: EnvironmentMeta["cloud"],
  name: string,
  type: EnvironmentMeta["type"],
): Pick<EnvironmentMeta, "cloud" | "name" | "type"> {
  return { cloud, name, type };
}

describe("synthetic Centre Standards environment boundary", () => {
  test.each([
    environment("local", "local", "development"),
    environment("encore", "staging", "development"),
  ])("permits only the reviewed local/test path and exact staging: %o", (candidate) => {
    expect(() => assertSyntheticStandardsEnvironment(candidate)).not.toThrow();
  });

  test.each([
    environment("encore", "production", "production"),
    environment("encore", "staging", "production"),
    environment("encore", "pr-123", "ephemeral"),
    environment("encore", "other-development", "development"),
    environment("local", "test", "test"),
  ])("fails closed outside exact staging/local development: %o", (candidate) => {
    expect(() => assertSyntheticStandardsEnvironment(candidate))
      .toThrow(SyntheticStandardsSeedError);
  });
});
