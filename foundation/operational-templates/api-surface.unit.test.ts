import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("operational template API surface", () => {
  test("exposes only authenticated resource-oriented Centre Standards routes", () => {
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    expect(source.match(/= api\(/gu)).toHaveLength(10);
    expect(source.match(/expose:\s*true,\s*auth:\s*true/gu)).toHaveLength(10);
    expect(source).toContain('path: "/standards/templates"');
    expect(source).toContain('path: "/standards/templates/:templateId/draft"');
    expect(source).toContain('path: "/standards/templates/:templateId/publish"');
    expect(source).toContain('path: "/standards/templates/:templateId/retire"');
    expect(source).toContain('path: "/standards/templates/:templateId/versions/:versionId"');
    expect(source).toContain('path: "/standards/templates/:templateId/preview"');
    expect(source).toContain('path: "/standards/templates/:templateId/assignments"');
    expect(source).toContain('path: "/standards/templates/:templateId"');
    // Deliberately not nested under `/standards/templates/...`, where a literal
    // segment would sit alongside `:templateId` and routing would depend on
    // precedence rather than on the path being unambiguous.
    expect(source).toContain('path: "/standards/template-assignment-options"');
    expect(source).not.toMatch(/auth:\s*false/gu);
    expect(source).not.toMatch(/path: "\/(?:forms|form-builder)/gu);
  });
});
