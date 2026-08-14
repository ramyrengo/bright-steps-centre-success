import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Structural guards for the ADR-0021 D5 ceremony.
 *
 * These read source text rather than behaviour on purpose. The two properties
 * they protect — that the ceremony has no API surface, and that the existing
 * local-only guards keep refusing every non-local environment — are things that
 * would be silently lost by an edit, not by a failing call. A behavioural test
 * cannot fail when an assertion is deleted from a file it never reaches.
 */

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** Collapses formatting so the assertions survive a reformat but not a rewrite. */
function normalise(source: string): string {
  return source.replace(/\s+/g, " ");
}

const ceremonySource = readSource("./first-administrator-ceremony.ts");
const scriptSource = readSource("../../scripts/bootstrap-first-administrator.ts");
const linkerSource = readSource("./local-identity-linker.ts");
const localBootstrapSource = readSource(
  "./local-first-administrator-bootstrap.ts",
);
const gateSource = readSource("../operations/reviewed-environment-gate.ts");

describe("first-administrator ceremony — no API surface", () => {
  test("is reachable only through the Encore exec package commands", () => {
    const packageJson = JSON.parse(
      readSource("../../package.json"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["admin:bootstrap:dry-run"]).toBe(
      "encore exec -- npx --no-install tsx scripts/bootstrap-first-administrator.ts",
    );
    expect(packageJson.scripts?.["admin:bootstrap:apply"]).toBe(
      "encore exec -- npx --no-install tsx scripts/bootstrap-first-administrator.ts --apply",
    );
  });

  test("neither the ceremony nor its script defines or calls an HTTP surface", () => {
    for (const source of [ceremonySource, scriptSource]) {
      expect(source).not.toMatch(/from "encore\.dev\/api"/);
      expect(source).not.toMatch(/from "~encore\/auth"/);
      expect(source).not.toContain("getAuthData");
      expect(source).not.toContain("expose:");
      expect(source).not.toMatch(/\bapi\(/);
      expect(source).not.toContain("fetch(");
    }
  });

  test("no service module imports the ceremony, so nothing can expose it", () => {
    const importers: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = readFileSync(path, "utf8");
        if (!/from "[^"]*first-administrator-ceremony"/.test(source)) continue;
        importers.push(path.slice(repositoryRoot.length));
      }
    };
    walk(`${repositoryRoot}foundation`);

    // Only integration tests import it: its own, and the one that proves the
    // organisation reference load hands off to it. Nothing in a request path
    // does, so it cannot reach an Encore endpoint or the generated client.
    expect(importers.sort()).toEqual([
      "foundation/authentication/first-administrator-ceremony.test.ts",
      "foundation/organisation-reference/organisation-reference.integration.test.ts",
    ]);

    // The list above is exact so that a new importer has to be added
    // deliberately. This states the property that list exists to protect, so
    // that adding one cannot quietly admit something on a request path.
    for (const importer of importers) {
      expect(importer).toMatch(/\.test\.ts$/);
    }
  });

  test("the committed generated client carries no trace of the ceremony", () => {
    const client = readSource("../../frontend/src/lib/client.generated.ts");
    for (const marker of [
      "first-administrator",
      "firstAdministrator",
      "FirstAdministrator",
      "first_administrator",
      "admin:bootstrap",
    ]) {
      expect(client).not.toContain(marker);
    }
  });

  test("applying is confined to a closed allow-list that only review can widen", () => {
    // The three lists moved to operations/reviewed-environment-gate.ts so the
    // organisation reference load could pass the identical gate instead of a
    // second copy of it. They are still closed literals in one reviewed place.
    expect(normalise(gateSource)).toContain(
      'export const REVIEWED_APPLY_ENVIRONMENT_NAMES = ["staging", "production"] as const;',
    );
    expect(normalise(gateSource)).toContain(
      'export const REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES = ["production"] as const;',
    );
    expect(normalise(gateSource)).toContain(
      'export const REFUSED_APPLY_ENVIRONMENT_TYPES = ["ephemeral", "test"] as const;',
    );
  });

  test("the ceremony's own allow-list is still those lists and nothing added", () => {
    // Not "the shared list plus something". If a later tool needs another
    // environment it names it in its own policy, as the organisation reference
    // load names local; this ceremony's list stays the reviewed deployed two.
    expect(normalise(ceremonySource)).toContain(
      "export const CEREMONY_APPLY_ENVIRONMENT_NAMES = REVIEWED_APPLY_ENVIRONMENT_NAMES;",
    );
    expect(normalise(ceremonySource)).toContain(
      "export const CEREMONY_CONFIRMATION_ENVIRONMENT_NAMES = REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES;",
    );
    expect(normalise(ceremonySource)).toContain(
      normalise(`
        applyEnvironmentNames: CEREMONY_APPLY_ENVIRONMENT_NAMES,
        confirmationEnvironmentNames: CEREMONY_CONFIRMATION_ENVIRONMENT_NAMES,
      `).trim(),
    );
  });

  test("the gate still runs before the ceremony can open a transaction", () => {
    const gateIndex = ceremonySource.indexOf(
      "assertEnvironmentGate(input, dependencies.environment, apply)",
    );
    const transactionIndex = ceremonySource.indexOf(
      "await centreSuccessDB.begin()",
    );
    expect(gateIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(transactionIndex);
  });

  /**
   * Exactly the kind of property this file exists for: it would be lost by an
   * edit, not by a failing call.
   *
   * `effective_from` was once stamped from the application clock before the
   * transaction opened, while migration 017's reachability guard compared it
   * against the database clock fixed at BEGIN. Two clocks with no margin, so a
   * database milliseconds behind the application made the ceremony reach nobody
   * and refuse `exactly_one_violated` — fail-closed, but indistinguishable to an
   * operator from a serious invariant breach, on a ceremony that will not run
   * twice. It was found only by running the load and the ceremony in sequence
   * against a real database with a −2 ms skew.
   *
   * No behavioural test can be trusted to protect it. On a machine whose clocks
   * agree, an application-clock stamp passes every time. So assert the source.
   */
  test("effective_from is taken from the database clock, inside the transaction", () => {
    expect(normalise(ceremonySource)).toContain(
      "const clock = await transaction.queryRow<{ at: Date }>`SELECT now() AS at`;",
    );
    expect(normalise(ceremonySource)).toContain("const occurredAt = clock.at;");

    // Read after BEGIN, so it is this transaction's clock and not another's.
    const beginIndex = ceremonySource.indexOf("await centreSuccessDB.begin()");
    const clockIndex = ceremonySource.indexOf("SELECT now() AS at");
    expect(clockIndex).toBeGreaterThan(beginIndex);

    // No application clock, and no seam to inject one back through. A test that
    // supplied its own clock would restore the blindness that hid this.
    expect(ceremonySource).not.toContain("new Date(");
    expect(ceremonySource).not.toContain("Date.now(");
    expect(ceremonySource).not.toMatch(/\bnow\?:\s*\(\)\s*=>\s*Date/);
  });
});

describe("the local-only guards are intact — ADR-0021 D5", () => {
  /**
   * The exact refusal. This fails if any of the three comparisons is removed,
   * if `&&` replaces `||`, or if a new environment is admitted alongside local
   * development. D5 requires that no P1 work weakens it.
   */
  test("assertLocalDevelopmentEnvironment still demands exact local development", () => {
    expect(normalise(linkerSource)).toContain(
      normalise(`
        export function assertLocalDevelopmentEnvironment(
          environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
        ): void {
          if (
            environment.cloud !== "local" ||
            environment.name !== "local" ||
            environment.type !== "development"
          ) {
            throw new LocalIdentityLinkError("local_environment_required");
          }
        }
      `).trim(),
    );
  });

  test("both local paths still assert before they can open a transaction", () => {
    for (const [label, source] of [
      ["local identity linker", linkerSource],
      ["local first-administrator bootstrap", localBootstrapSource],
    ] as const) {
      const assertions = source.match(
        /assertLocalDevelopmentEnvironment\(dependencies\.environment\)/g,
      );
      expect(assertions, `${label} must keep its local assertion`).toHaveLength(1);

      const assertionIndex = source.indexOf(
        "assertLocalDevelopmentEnvironment(dependencies.environment)",
      );
      const transactionIndex = source.indexOf("await centreSuccessDB.begin()");
      expect(transactionIndex).toBeGreaterThan(-1);
      expect(
        assertionIndex,
        `${label} must assert before beginning a transaction`,
      ).toBeLessThan(transactionIndex);
    }
  });

  test("the ceremony neither imports nor reuses the local-only guard", () => {
    // Widening the local path to accept production is the failure mode D5 names.
    // This ceremony is a separate route with its own gate, and must stay that way.
    expect(ceremonySource).not.toContain("assertLocalDevelopmentEnvironment");
    expect(ceremonySource).not.toMatch(/from "[^"]*local-identity-linker"/);
    expect(ceremonySource).not.toMatch(
      /from "[^"]*local-first-administrator-bootstrap"/,
    );
  });
});
