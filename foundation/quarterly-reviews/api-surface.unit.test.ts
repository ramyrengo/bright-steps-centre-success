import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("quarterly review API surface", () => {
  test("requires Encore authentication on every exposed business endpoint", () => {
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    const endpointDeclarations = source.match(/= api\(/gu) ?? [];
    const authenticatedDeclarations = source.match(
      /\{ expose: true, auth: true, method: "(?:GET|POST|PUT|DELETE)", path: "[^"]+" \}/gu,
    ) ?? [];

    expect(endpointDeclarations).toHaveLength(19);
    expect(authenticatedDeclarations).toHaveLength(endpointDeclarations.length);
    expect(source).not.toMatch(/auth:\s*false/gu);
  });
});
