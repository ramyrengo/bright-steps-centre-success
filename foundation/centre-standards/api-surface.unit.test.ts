import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Centre Standards API surface", () => {
  test("exposes only the three authenticated /standards contract endpoints", () => {
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    const authenticated = source.match(
      /\{ expose: true, auth: true, method: "(?:GET|POST)", path: "\/standards[^"]*" \}/gu,
    ) ?? [];

    expect(authenticated).toHaveLength(3);
    expect(source).toContain('method: "GET", path: "/standards"');
    expect(source).toContain('method: "GET", path: "/standards/checks/:occurrenceId"');
    expect(source).toContain('method: "POST", path: "/standards/checks/:occurrenceId/complete"');
    expect(source).not.toMatch(/auth:\s*false/gu);
  });

  test("the only other endpoint is the administrative pilot seed", () => {
    // The count guard is kept, not relaxed: the reader experience is still
    // exactly three `/standards` endpoints, and anything else on this service
    // has to be named here. The seed is administrative rather than part of the
    // Centre Standards contract, so it lives under `/admin` and is called out
    // separately instead of being absorbed into the count above.
    const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
    const declarations = source.match(/= api\(/gu) ?? [];
    const administrative = source.match(
      /\{ expose: true, auth: true, method: "POST", path: "\/admin\/[^"]*" \}/gu,
    ) ?? [];

    expect(declarations).toHaveLength(4);
    expect(administrative).toHaveLength(1);
    expect(source).toContain('method: "POST", path: "/admin/centre-standards/synthetic-pilot"');
    // It must never be reachable without authentication, and never sit under
    // the `/standards` prefix an Educator reads.
    expect(source).not.toMatch(/path: "\/standards[^"]*"[^)]*auth:\s*false/gu);
  });

  test("the pilot seed is gated on environment and technical administration", () => {
    const operation = readFileSync(
      new URL("./synthetic-pilot-operation.ts", import.meta.url),
      "utf8",
    );
    // The environment assertion has to come before any database work, so that a
    // wrong-environment attempt is refused rather than half-performed.
    const gate = operation.indexOf("assertSyntheticStandardsEnvironment(environment)");
    // The invocation, not the import at the top of the file.
    const firstTransaction = operation.indexOf("await inSerializableTransaction(");
    expect(gate).toBeGreaterThan(-1);
    expect(firstTransaction).toBeGreaterThan(gate);
    // Seeding is technical administration, deliberately not template authorship.
    expect(operation).toContain("capability.systemConfigure");
    expect(operation).not.toContain("templateCreate");
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
