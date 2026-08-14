import { describe, expect, test } from "vitest";
import {
  evaluateReviewedEnvironmentGate,
  REFUSED_APPLY_ENVIRONMENT_TYPES,
  REVIEWED_APPLY_ENVIRONMENT_NAMES,
  REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
  type ReviewedEnvironmentGatePolicy,
} from "./reviewed-environment-gate";

/**
 * The gate is a pure function of the operator's declaration and the running
 * environment, so it is exercised here without a database. The two tools that
 * pass it keep their own integration tests for the writes it protects, and
 * their structural unit tests assert that the policies below are the policies
 * they actually pass.
 */

const STAGING = { cloud: "encore", name: "staging", type: "development" } as const;
const PRODUCTION = { cloud: "gcp", name: "production", type: "production" } as const;
const LOCAL = { cloud: "local", name: "local", type: "development" } as const;
const PREVIEW = { cloud: "encore", name: "pr-42", type: "ephemeral" } as const;

/** What `first-administrator-ceremony.ts` passes: no local. */
const CEREMONY_POLICY: ReviewedEnvironmentGatePolicy = {
  applyEnvironmentNames: REVIEWED_APPLY_ENVIRONMENT_NAMES,
  confirmationEnvironmentNames: REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
  refusedTypeConsequence: "create a real administrator",
  notPermittedNote: "local development keeps its own separate guarded bootstrap",
};

/** What `organisation-load.ts` passes: the same list plus local. */
const LOAD_POLICY: ReviewedEnvironmentGatePolicy = {
  applyEnvironmentNames: ["local", ...REVIEWED_APPLY_ENVIRONMENT_NAMES],
  confirmationEnvironmentNames: REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
  refusedTypeConsequence: "create the organisation for real",
  notPermittedNote:
    "widening that list is a source change under review, not an operator flag",
};

describe("the reviewed environment gate", () => {
  test("the closed lists are the reviewed ones", () => {
    expect([...REVIEWED_APPLY_ENVIRONMENT_NAMES]).toEqual([
      "staging",
      "production",
    ]);
    expect([...REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES]).toEqual(["production"]);
    expect([...REFUSED_APPLY_ENVIRONMENT_TYPES]).toEqual(["ephemeral", "test"]);
    // The shared list is the DEPLOYED environments only. A tool that also runs
    // in local development names local in its own policy, visibly.
    expect(REVIEWED_APPLY_ENVIRONMENT_NAMES).not.toContain("local");
  });

  test("refuses when the operator does not name the target environment", () => {
    for (const policy of [CEREMONY_POLICY, LOAD_POLICY]) {
      expect(
        evaluateReviewedEnvironmentGate(
          { declaredEnvironment: "   ", apply: false },
          LOCAL,
          policy,
        ),
      ).toMatchObject({ code: "environment_not_declared" });
    }
  });

  test("refuses when the declared environment is not the running one", () => {
    // The operator believes they are on staging; the deployment says otherwise.
    const refusal = evaluateReviewedEnvironmentGate(
      { declaredEnvironment: "staging", apply: true },
      PRODUCTION,
      LOAD_POLICY,
    );
    expect(refusal).toMatchObject({ code: "environment_mismatch" });
    expect(refusal?.detail).toContain('"staging"');
    expect(refusal?.detail).toContain('"production"');
  });

  test("holds the mismatch check on dry runs too, so a rehearsal proves something", () => {
    expect(
      evaluateReviewedEnvironmentGate(
        { declaredEnvironment: "staging", apply: false },
        PRODUCTION,
        LOAD_POLICY,
      ),
    ).toMatchObject({ code: "environment_mismatch" });
  });

  test("permits a dry run in any environment once it is named correctly", () => {
    for (const environment of [LOCAL, STAGING, PRODUCTION, PREVIEW] as const) {
      for (const policy of [CEREMONY_POLICY, LOAD_POLICY]) {
        expect(
          evaluateReviewedEnvironmentGate(
            { declaredEnvironment: environment.name, apply: false },
            environment,
            policy,
          ),
        ).toBeNull();
      }
    }
  });

  test("refuses to apply outside the policy's closed allow-list", () => {
    const refusal = evaluateReviewedEnvironmentGate(
      { declaredEnvironment: "development", apply: true },
      { name: "development", type: "development" },
      LOAD_POLICY,
    );
    expect(refusal).toMatchObject({ code: "environment_not_permitted" });
    expect(refusal?.detail).toBe(
      "only local, staging and production may apply; widening that list is a " +
        "source change under review, not an operator flag",
    );
  });

  test("renders two allowed names exactly as the ceremony always has", () => {
    // The ceremony's refusal text is unchanged by the extraction.
    expect(
      evaluateReviewedEnvironmentGate(
        { declaredEnvironment: "local", apply: true },
        LOCAL,
        CEREMONY_POLICY,
      ),
    ).toEqual({
      code: "environment_not_permitted",
      detail:
        "only staging and production may apply; local development keeps its " +
        "own separate guarded bootstrap",
    });
  });

  test("refuses ephemeral and test types whatever they are named", () => {
    for (const type of REFUSED_APPLY_ENVIRONMENT_TYPES) {
      for (const name of ["staging", "production", "local"] as const) {
        expect(
          evaluateReviewedEnvironmentGate(
            {
              declaredEnvironment: name,
              apply: true,
              confirmProduction: name === "production",
            },
            { name, type },
            LOAD_POLICY,
          ),
        ).toMatchObject({ code: "environment_type_not_permitted" });
      }
    }
  });

  test("refuses a production apply without the explicit confirmation flag", () => {
    expect(
      evaluateReviewedEnvironmentGate(
        { declaredEnvironment: "production", apply: true },
        PRODUCTION,
        LOAD_POLICY,
      ),
    ).toMatchObject({ code: "production_confirmation_required" });
  });

  test("refuses the confirmation flag anywhere but production, dry run included", () => {
    // It must not become a habitual paste that is already on the command line
    // when the operator finally points at production.
    for (const apply of [false, true]) {
      for (const environment of [LOCAL, STAGING] as const) {
        expect(
          evaluateReviewedEnvironmentGate(
            {
              declaredEnvironment: environment.name,
              apply,
              confirmProduction: true,
            },
            environment,
            LOAD_POLICY,
          ),
        ).toMatchObject({ code: "confirmation_not_applicable" });
      }
    }
  });

  test("lets a correctly declared and confirmed production apply through", () => {
    expect(
      evaluateReviewedEnvironmentGate(
        {
          declaredEnvironment: "production",
          apply: true,
          confirmProduction: true,
        },
        PRODUCTION,
        LOAD_POLICY,
      ),
    ).toBeNull();
  });

  test("lets local apply only under the load's policy, never the ceremony's", () => {
    expect(
      evaluateReviewedEnvironmentGate(
        { declaredEnvironment: "local", apply: true },
        LOCAL,
        LOAD_POLICY,
      ),
    ).toBeNull();
    expect(
      evaluateReviewedEnvironmentGate(
        { declaredEnvironment: "local", apply: true },
        LOCAL,
        CEREMONY_POLICY,
      ),
    ).toMatchObject({ code: "environment_not_permitted" });
  });
});
