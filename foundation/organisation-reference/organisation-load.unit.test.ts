import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Structural guards for the reviewed organisation reference load.
 *
 * These read source text rather than behaviour on purpose, exactly as the D5
 * ceremony's guards do. The properties they protect — that the load has no API
 * surface, that its gate runs before a transaction can open, that it admits
 * local only through the untouched local guard, and that the local-only
 * bootstrap paths are still refusing every non-local environment — are things an
 * edit would silently remove rather than break. A behavioural test cannot fail
 * when an assertion is deleted from a file it never reaches.
 */

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** Collapses formatting so the assertions survive a reformat but not a rewrite. */
function normalise(source: string): string {
  return source.replace(/\s+/g, " ");
}

const loadSource = readSource("./organisation-load.ts");
const scriptSource = readSource("../../scripts/load-bright-steps-organisation.ts");
const linkerSource = readSource("../authentication/local-identity-linker.ts");
const localBootstrapSource = readSource(
  "../authentication/local-first-administrator-bootstrap.ts",
);

describe("organisation reference load — no API surface", () => {
  test("is reachable only through the Encore exec package commands", () => {
    const packageJson = JSON.parse(readSource("../../package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["organisation:load:dry-run"]).toBe(
      "encore exec -- npx --no-install tsx scripts/load-bright-steps-organisation.ts",
    );
    expect(packageJson.scripts?.["organisation:load:apply"]).toBe(
      "encore exec -- npx --no-install tsx scripts/load-bright-steps-organisation.ts --apply",
    );
    // Neither command bakes in --environment or the production confirmation.
    // Both are typed by the operator, every run, in every environment.
    for (const command of [
      packageJson.scripts?.["organisation:load:dry-run"] ?? "",
      packageJson.scripts?.["organisation:load:apply"] ?? "",
    ]) {
      expect(command).not.toContain("--environment");
      expect(command).not.toContain("--confirm-production");
    }
  });

  test("neither the load nor its script defines or calls an HTTP surface", () => {
    for (const source of [loadSource, scriptSource]) {
      expect(source).not.toMatch(/from "encore\.dev\/api"/);
      expect(source).not.toMatch(/from "~encore\/auth"/);
      expect(source).not.toContain("getAuthData");
      expect(source).not.toContain("expose:");
      expect(source).not.toMatch(/\bapi\(/);
      expect(source).not.toContain("fetch(");
    }
  });

  test("no service module imports the load, so nothing can expose it", () => {
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
        if (!/from "[^"]*organisation-load"/.test(source)) continue;
        importers.push(path.slice(repositoryRoot.length));
      }
    };
    walk(`${repositoryRoot}foundation`);

    // Only its own integration test imports it. Nothing in a request path does,
    // so it cannot reach an Encore endpoint or the generated client.
    expect(importers.sort()).toEqual([
      "foundation/organisation-reference/organisation-reference.integration.test.ts",
    ]);
    for (const importer of importers) {
      expect(importer.endsWith(".test.ts")).toBe(true);
    }
  });
});

describe("organisation reference load — the environment gate", () => {
  test("applying is confined to the reviewed list plus local, spelled out", () => {
    // Not a free-form string built at run time, and not a widening of the
    // shared list: local is added here, for this tool, in source, under review.
    expect(normalise(loadSource)).toContain(
      normalise(`
        export const ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES = [
          "local",
          ...REVIEWED_APPLY_ENVIRONMENT_NAMES,
        ] as const;
      `).trim(),
    );
    expect(normalise(loadSource)).toContain(
      "confirmationEnvironmentNames: REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,",
    );
  });

  test("the gate runs before the load can open a transaction", () => {
    const gateIndex = loadSource.indexOf("assertEnvironmentGate(options, apply)");
    const transactionIndex = loadSource.indexOf("await centreSuccessDB.begin()");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(transactionIndex);
  });

  test("local is admitted by calling the untouched local guard, not by copying it", () => {
    expect(loadSource).toMatch(
      /from "\.\.\/authentication\/local-identity-linker"/,
    );
    expect(
      loadSource.match(/assertLocalDevelopmentEnvironment\(options\.environment\)/g),
    ).toHaveLength(1);
    // The predicate itself must not be reimplemented here, where it could drift.
    expect(loadSource).not.toContain('environment.cloud !== "local"');
    expect(loadSource).not.toContain('environment.type !== "development"');
  });

  test("the dry run forces the deferred guard before it decides to roll back", () => {
    const constraintsIndex = loadSource.indexOf("SET CONSTRAINTS ALL IMMEDIATE");
    const rollbackIndex = loadSource.indexOf("await transaction.rollback();");
    expect(constraintsIndex).toBeGreaterThan(-1);
    expect(constraintsIndex).toBeLessThan(rollbackIndex);
  });
});

describe("the local-only guards are intact — ADR-0021 D5", () => {
  /**
   * Widening the organisation load to reach staging and production must not
   * have widened the separate local-only bootstrap paths by so much as a
   * comparison. This is the same assertion the ceremony's guards make, repeated
   * here so it also fails from the side of the change that could break it.
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

  test("both local bootstrap paths still assert before opening a transaction", () => {
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

  test("neither local path learned about the reviewed environment gate", () => {
    for (const source of [linkerSource, localBootstrapSource]) {
      expect(source).not.toContain("reviewed-environment-gate");
      expect(source).not.toContain("evaluateReviewedEnvironmentGate");
      expect(source).not.toContain("staging");
      expect(source).not.toContain("production");
    }
  });
});
