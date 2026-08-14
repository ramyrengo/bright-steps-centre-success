import { describe, expect, test } from "vitest";
import type { ApprovedBudgetAmount, RecordedActualAmount } from "./contracts";
import {
  buildPositionFacts,
  CentreBudgetPositionError,
  summariseCentreMonth,
  toCategoryPosition,
  type BudgetCategoryDescriptor,
  type ThresholdPolicyContext,
} from "./position";

const CATEGORY: BudgetCategoryDescriptor = {
  categoryId: "11111111-1111-4111-8111-111111111111",
  categoryCode: "consumables",
  categoryName: "Consumables",
  categoryStatus: "active",
  sortOrder: 1,
};

const POLICY: ThresholdPolicyContext = {
  policyKey: "synthetic_test_policy",
  version: 1,
  effectiveFromMonth: "2036-01",
};

function budget(amount: string): ApprovedBudgetAmount {
  return {
    budgetLineId: "22222222-2222-4222-8222-222222222222",
    amount,
    currency: "AUD",
    sourceKind: "manual_entry",
    recordedAt: "2036-03-01T00:00:00.000Z",
  };
}

function actual(amount: string, confirmed = false): RecordedActualAmount {
  return {
    actualId: "33333333-3333-4333-8333-333333333333",
    amount,
    currency: "AUD",
    sourceKind: "manual_entry",
    enteredAt: "2036-03-15T00:00:00.000Z",
    enteredByPrincipalId: "44444444-4444-4444-8444-444444444444",
    confirmed,
    ...(confirmed
      ? {
          confirmedAt: "2036-03-15T00:00:00.000Z",
          confirmedByPrincipalId: "44444444-4444-4444-8444-444444444444",
        }
      : {}),
  };
}

describe("unknown is not zero", () => {
  test("a centre-month with no entry carries no amount and no derived value", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ approvedBudget: budget("1000.00") }),
      undefined,
    );

    expect(position.state).toBe("AWAITING_ACTUAL");
    expect(position.approvedBudget?.amount).toBe("1000.00");
    // The three fields a consumer could mistake for "nothing was spent".
    expect(position).not.toHaveProperty("actual");
    expect(position).not.toHaveProperty("remaining");
    expect(position).not.toHaveProperty("percentUsed");
    // Serialising must not reintroduce them as nulls either.
    expect(JSON.parse(JSON.stringify(position))).not.toHaveProperty("remaining");
  });

  test("an entry of zero is a present, recorded value and stays distinguishable", () => {
    const noEntry = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ approvedBudget: budget("1000.00") }),
      undefined,
    );
    const zeroEntry = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("1000.00"),
        actual: actual("0.00"),
        remaining: "1000.00",
        percentUsed: "0.00",
      }),
      undefined,
    );

    expect(noEntry.state).toBe("AWAITING_ACTUAL");
    expect(zeroEntry.state).toBe("BUDGET_AND_ACTUAL");
    expect(zeroEntry.actual?.amount).toBe("0.00");
    expect(zeroEntry.percentUsed).toBe("0.00");
    // The two states must never collapse into the same wire shape.
    expect(noEntry.state).not.toBe(zeroEntry.state);
    expect(JSON.stringify(noEntry)).not.toBe(JSON.stringify(zeroEntry));
  });

  test("an unconfirmed actual is a known state, not an omitted one", () => {
    const unconfirmed = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ actual: actual("250.00") }),
      undefined,
    );
    const confirmed = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ actual: actual("250.00", true) }),
      undefined,
    );

    // We know it is unconfirmed, so this is a boolean rather than an absence.
    expect(unconfirmed.actual?.confirmed).toBe(false);
    expect(unconfirmed.actual).not.toHaveProperty("confirmedAt");
    expect(unconfirmed.actual).not.toHaveProperty("confirmedByPrincipalId");
    expect(confirmed.actual?.confirmed).toBe(true);
    expect(confirmed.actual?.confirmedByPrincipalId).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  test("an actual with no approved budget yields no remaining and no percentage", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ actual: actual("250.00") }),
      undefined,
    );

    expect(position.state).toBe("ACTUAL_WITHOUT_BUDGET");
    expect(position.actual?.amount).toBe("250.00");
    expect(position).not.toHaveProperty("approvedBudget");
    expect(position).not.toHaveProperty("remaining");
    expect(position).not.toHaveProperty("percentUsed");
  });

  test("a category with neither value reports nothing rather than zeros", () => {
    const position = toCategoryPosition(CATEGORY, buildPositionFacts({}), undefined);

    expect(position.state).toBe("NOTHING_RECORDED");
    expect(position).not.toHaveProperty("approvedBudget");
    expect(position).not.toHaveProperty("actual");
    expect(position).not.toHaveProperty("remaining");
    expect(position).not.toHaveProperty("percentUsed");
  });

  test("a zero approved budget omits percent used rather than claiming 0% or 100%", () => {
    // Judged under a governing policy, so the outcome isolates the
    // divide-by-zero case rather than the absence of any policy.
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("0.00"),
        actual: actual("125.00"),
        remaining: "-125.00",
      }),
      POLICY,
    );

    expect(position.state).toBe("BUDGET_AND_ACTUAL");
    expect(position.remaining).toBe("-125.00");
    expect(position).not.toHaveProperty("percentUsed");
    expect(position.threshold).toEqual({
      state: "NOT_APPLICABLE",
      reason: "The approved budget is zero, so percent used is undefined.",
    });
  });

  test("no governing policy outranks every other threshold explanation", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("0.00"),
        actual: actual("125.00"),
        remaining: "-125.00",
      }),
      undefined,
    );

    // Without an approved policy the honest answer is that nobody has decided
    // the bands, not that this particular position could not be judged.
    expect(position.threshold).toEqual({ state: "NOT_CONFIGURED" });
  });

  test("both values present without a computed remaining fails closed", () => {
    // Only reachable if the two currency triggers were bypassed. Publishing a
    // comparison between two currencies would be worse than refusing.
    expect(() =>
      buildPositionFacts({ approvedBudget: budget("100.00"), actual: actual("50.00") }),
    ).toThrow(CentreBudgetPositionError);
  });

  test("money never passes through a JavaScript number", () => {
    // 0.1 + 0.2 is the canonical float failure. Values are carried as exact
    // decimal strings precisely so this class of error cannot occur.
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("0.30"),
        actual: actual("0.10"),
        remaining: "0.20",
        percentUsed: "33.33",
      }),
      undefined,
    );

    expect(position.approvedBudget?.amount).toBe("0.30");
    expect(position.remaining).toBe("0.20");
    expect(typeof position.remaining).toBe("string");
    expect(typeof position.percentUsed).toBe("string");
  });
});

describe("threshold bands are governed configuration", () => {
  test("no governing policy reports NOT_CONFIGURED rather than a reassuring band", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("1000.00"),
        actual: actual("2000.00"),
        remaining: "-1000.00",
        percentUsed: "200.00",
      }),
      undefined,
    );

    // 200% of budget with no policy must not be presented as within a band.
    expect(position.threshold).toEqual({ state: "NOT_CONFIGURED" });
    expect(position.threshold.bandCode).toBeUndefined();
  });

  test("a governed band carries the exact policy version that judged it", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({
        approvedBudget: budget("1000.00"),
        actual: actual("500.00"),
        remaining: "500.00",
        percentUsed: "50.00",
        band: { bandCode: "SYNTHETIC_LOW", bandLabel: "Synthetic test band" },
      }),
      POLICY,
    );

    expect(position.threshold).toEqual({
      state: "BANDED",
      bandCode: "SYNTHETIC_LOW",
      bandLabel: "Synthetic test band",
      policyKey: "synthetic_test_policy",
      policyVersion: 1,
      policyEffectiveFromMonth: "2036-01",
    });
  });

  test("a position without a percentage is not banded even under a policy", () => {
    const position = toCategoryPosition(
      CATEGORY,
      buildPositionFacts({ approvedBudget: budget("1000.00") }),
      POLICY,
    );

    expect(position.threshold.state).toBe("NOT_APPLICABLE");
    expect(position.threshold.bandCode).toBeUndefined();
  });
});

describe("summary totals under partial coverage", () => {
  const secondCategory: BudgetCategoryDescriptor = {
    ...CATEGORY,
    categoryId: "55555555-5555-4555-8555-555555555555",
    categoryCode: "utilities",
    categoryName: "Utilities",
    sortOrder: 2,
  };

  test("withholds every sum when one category is still awaiting its actual", () => {
    const positions = [
      toCategoryPosition(
        CATEGORY,
        buildPositionFacts({
          approvedBudget: budget("1000.00"),
          actual: actual("400.00"),
          remaining: "600.00",
          percentUsed: "40.00",
        }),
        undefined,
      ),
      toCategoryPosition(
        secondCategory,
        buildPositionFacts({ approvedBudget: budget("500.00") }),
        undefined,
      ),
    ];

    const summary = summariseCentreMonth(
      positions,
      {
        // PostgreSQL still returns sums over the rows that exist. They must not
        // be published: 400 of 1500 looks like healthy spend when in truth one
        // category simply has not been entered.
        totalApprovedBudget: "1500.00",
        totalRecordedActual: "400.00",
        totalRemaining: "600.00",
        totalPercentUsed: "26.67",
        currency: "AUD",
      },
      undefined,
    );

    expect(summary.coverage).toBe("partial");
    expect(summary.awaitingActualCount).toBe(1);
    expect(summary.recordedActualCount).toBe(1);
    // Every category is budgeted, so the approved total is a complete fact.
    expect(summary.totalApprovedBudget).toBe("1500.00");
    // Spend-side totals are not, and are withheld.
    expect(summary).not.toHaveProperty("totalRecordedActual");
    expect(summary).not.toHaveProperty("totalRemaining");
    expect(summary).not.toHaveProperty("totalPercentUsed");
  });

  test("publishes sums only when every category reported in one currency", () => {
    const positions = [
      toCategoryPosition(
        CATEGORY,
        buildPositionFacts({
          approvedBudget: budget("1000.00"),
          actual: actual("400.00"),
          remaining: "600.00",
          percentUsed: "40.00",
        }),
        undefined,
      ),
      toCategoryPosition(
        secondCategory,
        buildPositionFacts({
          approvedBudget: budget("500.00"),
          actual: actual("100.00"),
          remaining: "400.00",
          percentUsed: "20.00",
        }),
        undefined,
      ),
    ];

    const summary = summariseCentreMonth(
      positions,
      {
        totalApprovedBudget: "1500.00",
        totalRecordedActual: "500.00",
        totalRemaining: "1000.00",
        totalPercentUsed: "33.33",
        currency: "AUD",
      },
      undefined,
    );

    expect(summary.coverage).toBe("complete");
    expect(summary.totalApprovedBudget).toBe("1500.00");
    expect(summary.totalRecordedActual).toBe("500.00");
    expect(summary.totalRemaining).toBe("1000.00");
    expect(summary.totalPercentUsed).toBe("33.33");
    expect(summary.threshold).toEqual({ state: "NOT_CONFIGURED" });
  });

  test("withholds every sum when the month mixes currencies", () => {
    const positions = [
      toCategoryPosition(
        CATEGORY,
        buildPositionFacts({
          approvedBudget: budget("1000.00"),
          actual: actual("400.00"),
          remaining: "600.00",
          percentUsed: "40.00",
        }),
        undefined,
      ),
    ];

    const summary = summariseCentreMonth(
      positions,
      {
        totalApprovedBudget: "1500.00",
        totalRecordedActual: "500.00",
        // No shared currency, so nothing may be added together.
        currency: undefined,
      },
      undefined,
    );

    expect(summary.coverage).toBe("partial");
    expect(summary).not.toHaveProperty("currency");
    expect(summary).not.toHaveProperty("totalApprovedBudget");
    expect(summary).not.toHaveProperty("totalRecordedActual");
  });

  test("counts gaps as known negative evidence even under partial coverage", () => {
    const positions = [
      toCategoryPosition(CATEGORY, buildPositionFacts({}), undefined),
      toCategoryPosition(
        secondCategory,
        buildPositionFacts({ actual: actual("75.00") }),
        undefined,
      ),
    ];

    const summary = summariseCentreMonth(positions, { currency: "AUD" }, undefined);

    expect(summary.coverage).toBe("partial");
    expect(summary.categoryCount).toBe(2);
    expect(summary.nothingRecordedCount).toBe(1);
    expect(summary.actualWithoutBudgetCount).toBe(1);
    expect(summary.budgetedCategoryCount).toBe(0);
    expect(summary).not.toHaveProperty("totalApprovedBudget");
  });

  test("an empty category set is never complete", () => {
    const summary = summariseCentreMonth([], { currency: "AUD" }, undefined);

    // No governed category means nothing was measured, which is not an
    // all-clear and must not produce a complete, zero-valued month.
    expect(summary.coverage).toBe("partial");
    expect(summary.categoryCount).toBe(0);
    expect(summary).not.toHaveProperty("totalApprovedBudget");
    expect(summary).not.toHaveProperty("totalRecordedActual");
  });
});
