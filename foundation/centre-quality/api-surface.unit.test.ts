import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function read(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

const SOURCE_FILES = [
  "contracts.ts",
  "service.ts",
  "review-source.ts",
  "action-source.ts",
  "focus.ts",
];

describe("Centre Quality API surface", () => {
  test("exposes exactly two authenticated reads and no mutation", () => {
    const source = read("api.ts");
    expect(source.match(/= api\(/gu)).toHaveLength(2);
    expect(source.match(/auth: true/gu)).toHaveLength(2);
    expect(source.match(/method: "GET"/gu)).toHaveLength(2);
    expect(source).toContain('path: "/centre-quality"');
    expect(source).toContain('path: "/centre-quality/centres/:centreId"');
    expect(source).not.toMatch(/method:\s*"(?:POST|PUT|PATCH|DELETE)"/gu);
  });

  test("never exposes an endpoint without authentication", () => {
    expect(read("api.ts")).not.toMatch(/expose:\s*true[^)]*auth:\s*false/su);
  });
});

describe("Centre Quality read-only boundary", () => {
  const source = SOURCE_FILES.map(read).join("\n");

  test("writes no row and creates no projection table of its own", () => {
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE/giu);
  });

  test("reads only inside a read-only repeatable-read snapshot", () => {
    expect(read("service.ts")).toContain(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  test("restricts every source query by an authorised centre identifier array", () => {
    const queries = [read("review-source.ts"), read("action-source.ts")].join("\n");
    const centreFilters = queries.match(/centre_id = (?:ANY\(\$\{|\$\{)/gu) ?? [];
    expect(centreFilters.length).toBeGreaterThanOrEqual(5);
    expect(queries).not.toMatch(/FROM\s+corrective_actions[\s\S]{0,400}?WHERE(?![\s\S]{0,400}?organisation_id)/giu);
  });

  test("computes no composite health score and claims no regulatory rating", () => {
    expect(source).not.toMatch(
      /healthScore|centre_health|overallHealth|weightedScore|compositeScore|\bnqs\b|acecqa/giu,
    );
  });

  test("uses no ranking or league-table language in any user-visible string", () => {
    const literals = source.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gu) ?? [];
    const prose = literals.filter((literal) => /\s/u.test(literal));
    expect(prose.length).toBeGreaterThan(10);
    for (const literal of prose) {
      expect(literal).not.toMatch(/\brank(?:ed|ing|s)?\b|league|\bbest\b|\bworst\b|top performer/iu);
    }
  });

  test("adds no Microsoft Graph or invitation-email dependency", () => {
    expect(source + read("api.ts")).not.toMatch(
      /graph\.microsoft|microsoft-graph|MicrosoftGraph|sendMail|invitation/giu,
    );
  });

  test("keeps responses private and uncached", () => {
    expect(read("service.ts").match(/"private, no-store"/gu)).toHaveLength(2);
  });
});
