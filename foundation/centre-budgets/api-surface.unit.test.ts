import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function read(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

function readMigration(file: string): string {
  return readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
}

/**
 * Strips comments so an assertion tests the code rather than the prose about
 * it. This module's comments legitimately discuss thresholds, colours and
 * floating point in order to explain why none of them are used.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1")
    .replace(/^\s*--.*$/gmu, "");
}

const MODULE_SOURCES = ["contracts.ts", "service.ts", "position.ts", "validation.ts"];

describe("Centre Budgets API surface", () => {
  const source = read("api.ts");

  test("exposes exactly three authenticated routes on resource-oriented paths", () => {
    expect(source.match(/= api\(/gu)).toHaveLength(3);
    expect(source.match(/expose: true/gu)).toHaveLength(3);
    expect(source.match(/auth: true/gu)).toHaveLength(3);
    expect(source).toContain('path: "/centre-budgets/months/:month/portfolio"');
    expect(source).toContain('path: "/centre-budgets/months/:month/centres/:centreId"');
    expect(source).toContain(
      'path: "/centre-budgets/months/:month/centres/:centreId/actuals"',
    );
  });

  test("declares two reads and exactly one mutation", () => {
    expect(source.match(/method: "GET"/gu)).toHaveLength(2);
    expect(source.match(/method: "POST"/gu)).toHaveLength(1);
    expect(source).not.toMatch(/method:\s*"(?:PUT|PATCH|DELETE)"/gu);
  });

  test("never exposes an endpoint without authentication", () => {
    expect(source).not.toMatch(/expose:\s*true[^)]*auth:\s*false/su);
  });

  /**
   * An `api()` wrapper without an explicit return annotation erases the
   * response type in the generated client. That has already happened once in
   * this repository, so it is asserted rather than trusted.
   */
  test("annotates every route handler with an explicit Promise return type", () => {
    const handlers = source.match(/\):\s*Promise<[A-Za-z]+>\s*=>/gu) ?? [];
    expect(handlers).toHaveLength(3);
    expect(source).toContain("Promise<PortfolioBudgetMonthResponse>");
    expect(source).toContain("Promise<CentreBudgetMonthResponse>");
    expect(source).toContain("Promise<RecordCentreBudgetActualResponse>");
  });

  test("keeps every response private and uncached", () => {
    expect(read("service.ts").match(/"private, no-store"/gu)).toHaveLength(3);
  });
});

describe("Centre Budgets governed-data boundary", () => {
  const source = MODULE_SOURCES.map(read).join("\n");

  /**
   * Categories are governed rows, so no category name may exist as a
   * TypeScript union. A union would mean the taxonomy could only change with a
   * deploy.
   */
  test("hard-codes no reporting category", () => {
    expect(source).not.toMatch(
      /\b(?:salaries|wages|payroll|consumables|utilities|rent|maintenance|marketing)\b/giu,
    );
    expect(read("contracts.ts")).not.toMatch(/categoryCode:\s*"/u);
  });

  /**
   * Threshold bands are versioned configuration. A literal percentage in
   * application code would be an invented financial rule, and
   * BUDGET_ACCOUNTABILITY.md lists overspend severities as candidates rather
   * than approved thresholds.
   */
  test("hard-codes no threshold percentage or traffic-light band", () => {
    const executable = code(source);
    expect(executable).not.toMatch(/\b(?:green|amber|red)\b/giu);
    // No numeric percentage literal compared against a percent-used value.
    expect(executable).not.toMatch(/percentUsed\s*[<>]=?\s*\d/u);
    expect(executable).not.toMatch(/[<>]=?\s*(?:70|75|80|85|90|95|100|110)\b/u);
  });

  test("seeds no threshold policy or band in any migration", () => {
    const migration = readMigration("027_centre_budget_domain.up.sql");
    expect(migration).toContain("CREATE TABLE budget_threshold_bands");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+budget_threshold_(?:policies|bands)/giu);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+budget_categories/giu);
  });
});

/**
 * The approved reporting taxonomy is data, and the seed migration is the only
 * place it is stated. It cannot be observed from an integration test, because
 * organisations are created at runtime and the seed reaches only those that
 * exist when it runs, so the governed decision is asserted at its source.
 */
describe("Centre Budgets approved reporting categories", () => {
  const migration = readMigration("028_centre_budget_reporting_categories.up.sql");

  test("seeds exactly the three approved categories in their approved order", () => {
    const seeded = [...code(migration).matchAll(/\('([a-z_]+)',\s*'([^']+)',\s*(\d+)\)/gu)].map(
      (match) => [match[1], match[2], Number(match[3])],
    );
    expect(seeded).toEqual([
      ["supplies", "Supplies", 1],
      ["staff_engagement", "Staff Engagement", 2],
      ["special_days", "Special Days", 3],
    ]);
  });

  test("seeds them active and for every organisation, inventing no other column", () => {
    expect(migration).toContain("FROM organisations AS organisation");
    expect(code(migration)).toContain("'active'");
    // A description would be invented prose on a governed row, and a monetary
    // or threshold column has no business in a taxonomy seed.
    expect(code(migration)).not.toMatch(/\bdescription\b/iu);
    expect(code(migration)).not.toMatch(/\b(?:amount|currency|percent)\b/iu);
  });

  /**
   * Both approved threshold rules were withheld because 027 cannot carry them.
   * If a later change seeds a band, it must be a deliberate act with its own
   * migration and its own review, never a quiet addition to this one.
   */
  test("seeds no threshold policy or band", () => {
    expect(migration).not.toMatch(/INSERT\s+INTO\s+budget_threshold_(?:policies|bands)/giu);
    expect(code(migration)).not.toMatch(/\b(?:green|amber|red)\b/giu);
    expect(code(migration)).not.toMatch(/\b(?:85|90|100)\b/u);
  });

  test("creates and alters nothing", () => {
    expect(code(migration)).not.toMatch(/\b(?:CREATE|ALTER|DROP)\b/iu);
  });
});

describe("Centre Budgets money handling", () => {
  const source = MODULE_SOURCES.map(read).join("\n");

  /**
   * Every amount stays an exact decimal string end to end. A single
   * `Number()`, `parseFloat` or `::float8` on a monetary column would silently
   * reintroduce the floating-point money the schema forbids.
   */
  test("never converts a monetary value to a JavaScript number", () => {
    const executable = code(source);
    expect(executable).not.toMatch(/parseFloat|parseInt|Number\.parseFloat/u);
    // Every numeric coercion must be over a count, a version or a sort order,
    // never over a monetary value.
    const coercions = executable.match(/Number\(([^)]*)\)/gu) ?? [];
    expect(coercions.length).toBeGreaterThan(0);
    for (const coercion of coercions) {
      expect(coercion, coercion).toMatch(
        /Number\(\s*(?:row\.sort_order|row\.version|row\.currency_count|match\[1\])\s*\)/u,
      );
    }
  });

  test("casts every monetary column to text on the way out of PostgreSQL", () => {
    const service = read("service.ts");
    expect(service).not.toMatch(/(?:amount|remaining|percent_used)\w*::float8/u);
    for (const cast of [
      "budget_amount_numeric::text",
      "actual_amount_numeric::text",
      "remaining_numeric::text",
      "percent_used_numeric::text",
      "total_budget_numeric::text",
      "total_actual_numeric::text",
      "total_remaining_numeric::text",
      "total_percent_used_numeric::text",
    ]) {
      expect(service, cast).toContain(cast);
    }
  });

  test("stores money as an exact numeric type with an explicit currency", () => {
    const migration = code(readMigration("027_centre_budget_domain.up.sql"));
    expect(migration.match(/amount NUMERIC\(14,2\) NOT NULL/gu)).toHaveLength(2);
    expect(migration).not.toMatch(/\b(?:REAL|DOUBLE PRECISION|FLOAT\d*)\b/giu);
    expect(migration.match(/currency_code TEXT NOT NULL/gu)).toHaveLength(2);
    // No monetary column may default, which is what would turn unknown into zero.
    expect(migration).not.toMatch(/amount NUMERIC\(14,2\)[^,]*DEFAULT/u);
  });
});

describe("Centre Budgets authorisation boundary", () => {
  test("evaluates capability per centre and never from a role name", () => {
    const service = read("service.ts");
    expect(service).toContain("budgetPositionRead");
    expect(service).toContain("budgetActualEnter");
    expect(service).not.toMatch(
      /roleKey\s*===|"centre_director"|"area_manager"|"system_administrator"/u,
    );
  });

  test("reads inside a read-only repeatable-read snapshot and writes serializably", () => {
    const service = read("service.ts");
    expect(service).toContain("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(service).toContain("inSerializableTransaction");
  });

  test("restricts every budget query by organisation and an authorised centre array", () => {
    const service = read("service.ts");
    const centreFilters = service.match(/centre_id = ANY\(\$\{/gu) ?? [];
    expect(centreFilters.length).toBeGreaterThanOrEqual(4);
    const organisationFilters = service.match(/organisation_id = \$\{/gu) ?? [];
    expect(organisationFilters.length).toBeGreaterThanOrEqual(8);
  });

  test("grants no budget capability to the System Administrator bundle", () => {
    const migration = readMigration("026_centre_budget_capabilities.up.sql");
    expect(migration).toContain("'budget.position.read'");
    expect(migration).toContain("'budget.actual.enter'");
    expect(migration).not.toMatch(/'system_administrator',\s*\d+,\s*'budget\./u);
  });

  test("keeps finance detail out of the audit context", () => {
    const service = read("service.ts");
    const auditCall = code(
      service.slice(
        service.indexOf("recordAuditEventWithExecutor(transaction"),
        service.indexOf("occurredAt: decisionAt,"),
      ),
    );
    expect(auditCall).toContain("periodMonth");
    // The value itself lives in the immutable domain row, not the audit payload.
    expect(auditCall).not.toMatch(/\bamount\b|\bcurrency\b/u);
  });
});

describe("Centre Budgets append-only guarantees", () => {
  const migration = readMigration("027_centre_budget_domain.up.sql");

  test("rejects deletion and in-place edits of a recorded financial fact", () => {
    expect(migration).toContain("centre budget facts are append-only");
    expect(migration).toContain("centre budget actuals are append-only");
    expect(migration).toContain(
      "recorded centre budget actual values and attribution are immutable",
    );
    expect(migration.match(/BEFORE UPDATE OR DELETE ON centre_budget_\w+/gu)).toHaveLength(2);
  });

  test("permits at most one current row per centre-month-category", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX centre_budget_lines_one_current");
    expect(migration).toContain("CREATE UNIQUE INDEX centre_budget_actuals_one_current");
    expect(migration.match(/WHERE superseded_at IS NULL/gu)?.length).toBeGreaterThanOrEqual(4);
  });

  test("builds no approval workflow on top of confirmation", () => {
    const source = code(MODULE_SOURCES.map(read).join("\n") + migration);
    expect(source).not.toMatch(/approved_by_principal_id UUID[^,]*,\s*\n\s*confirmed/u);
    expect(source).not.toMatch(/\bpending_approval\b|\bawaiting_approval\b|approverPrincipalId/iu);
    // Confirmation names who and when, and nothing more.
    expect(migration).toContain("confirmed_by_principal_id");
    expect(migration).toContain("centre_budget_actuals_confirmation_check");
  });
});
