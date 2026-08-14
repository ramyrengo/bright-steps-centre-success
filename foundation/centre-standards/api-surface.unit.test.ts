import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Centre Standards API surface", () => {
  test("exposes only the three authenticated /standards contract endpoints", () => {
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    const declarations = source.match(/= api\(/gu) ?? [];
    const authenticated = source.match(
      /\{ expose: true, auth: true, method: "(?:GET|POST)", path: "\/standards[^"]*" \}/gu,
    ) ?? [];

    expect(declarations).toHaveLength(3);
    expect(authenticated).toHaveLength(3);
    expect(source).toContain('method: "GET", path: "/standards"');
    expect(source).toContain('method: "GET", path: "/standards/checks/:occurrenceId"');
    expect(source).toContain('method: "POST", path: "/standards/checks/:occurrenceId/complete"');
    expect(source).not.toMatch(/auth:\s*false/gu);
  });

  test("keeps completion source-owned and rejects generic task or notification seams", () => {
    const files = ["contracts.ts", "generator.ts", "service.ts", "synthetic-pilot.ts"];
    const source = files
      .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/daily_tasks|generic_tasks|notification_intents|manual_priority/giu);
    expect(source).toContain("operational_check_occurrences");
    expect(source).toContain("operational_check_responses");
  });

  test("keeps the three forward migrations safe under a repeated application", () => {
    const migration = (number: string) => readFileSync(
      new URL(`../migrations/${number}.up.sql`, import.meta.url),
      "utf8",
    );
    const subtype = migration("020_audit_template_subtypes");
    const operational = migration("021_centre_standards_operational_sources");
    const capability = migration("022_centre_standards_capabilities");

    expect(subtype).toContain("ADD COLUMN IF NOT EXISTS template_subtype");
    expect(subtype).toContain("version.template_subtype IS NULL");
    expect(subtype).toContain("CREATE OR REPLACE FUNCTION");
    expect(operational).toContain("CREATE TABLE IF NOT EXISTS operational_check_occurrences");
    expect(operational).toContain("ADD COLUMN IF NOT EXISTS source_family");
    expect(operational).toContain("CREATE INDEX IF NOT EXISTS");
    expect(capability).toContain("ON CONFLICT (code) DO NOTHING");
    expect(capability).toContain("existing.correlation_id = 'milestone-4a-educator-bundle-migration'");
  });
});
