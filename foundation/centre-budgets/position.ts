import type {
  ApprovedBudgetAmount,
  BudgetThresholdOutcome,
  CentreBudgetCategoryPosition,
  CentreBudgetMonthSummary,
  CurrencyCode,
  MoneyAmount,
  PercentValue,
  RecordedActualAmount,
} from "./contracts";

/**
 * The internal shape a position takes before it becomes a wire contract.
 *
 * This is a genuine discriminated union, which the wire contract cannot be:
 * Encore's schema generation across this repository only carries string-literal
 * unions, so `CentreBudgetCategoryPosition` uses a `state` discriminator with
 * optional fields instead. Building that contract exclusively from this union
 * is what makes the invariant hold. `remaining` exists on exactly one variant,
 * so there is no way to express a remaining balance for a centre-month whose
 * actual was never entered — the compiler rejects it rather than a reviewer
 * having to notice it.
 */
export type CentreBudgetPositionFacts =
  | { kind: "nothing_recorded" }
  | { kind: "budget_only"; approvedBudget: ApprovedBudgetAmount }
  | { kind: "actual_only"; actual: RecordedActualAmount }
  | {
      kind: "budget_and_actual";
      approvedBudget: ApprovedBudgetAmount;
      actual: RecordedActualAmount;
      /** Computed in PostgreSQL NUMERIC. Required here, so it cannot be forgotten. */
      remaining: MoneyAmount;
      /** Absent when the approved budget is exactly zero. */
      percentUsed?: PercentValue;
      band?: ThresholdBandMatch;
    };

export interface ThresholdBandMatch {
  bandCode: string;
  bandLabel: string;
}

/** The governing threshold policy for a month, when one exists. */
export interface ThresholdPolicyContext {
  policyKey: string;
  version: number;
  effectiveFromMonth: string;
}

export interface BudgetCategoryDescriptor {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  categoryStatus: "active" | "inactive";
  sortOrder: number;
}

export class CentreBudgetPositionError extends Error {
  constructor(readonly code: "source_inconsistent") {
    super(`Centre budget position rejected: ${code}`);
    this.name = "CentreBudgetPositionError";
  }
}

/**
 * Assembles the facts for one category.
 *
 * `remaining` and `percentUsed` are supplied by the caller because they are
 * computed in PostgreSQL `NUMERIC`, never in JavaScript. Doing the subtraction
 * or the division here would mean parsing a decimal string into an IEEE-754
 * double, which is exactly the floating-point money handling the schema
 * forbids.
 */
export function buildPositionFacts(input: {
  approvedBudget?: ApprovedBudgetAmount;
  actual?: RecordedActualAmount;
  remaining?: MoneyAmount;
  percentUsed?: PercentValue;
  band?: ThresholdBandMatch;
}): CentreBudgetPositionFacts {
  const { approvedBudget, actual } = input;

  if (approvedBudget === undefined && actual === undefined) {
    return { kind: "nothing_recorded" };
  }
  if (approvedBudget !== undefined && actual === undefined) {
    return { kind: "budget_only", approvedBudget };
  }
  if (approvedBudget === undefined && actual !== undefined) {
    return { kind: "actual_only", actual };
  }
  if (approvedBudget === undefined || actual === undefined) {
    throw new CentreBudgetPositionError("source_inconsistent");
  }

  // Both values exist, so PostgreSQL must have produced a remaining balance.
  // The only way it would not is a currency disagreement inside one
  // centre-month-category, which two database triggers already make
  // impossible. If it somehow happened, comparing the two figures anyway would
  // publish a meaningless number, so the request fails closed instead.
  if (input.remaining === undefined) {
    throw new CentreBudgetPositionError("source_inconsistent");
  }

  return {
    kind: "budget_and_actual",
    approvedBudget,
    actual,
    remaining: input.remaining,
    ...(input.percentUsed !== undefined ? { percentUsed: input.percentUsed } : {}),
    ...(input.band !== undefined ? { band: input.band } : {}),
  };
}

function thresholdOutcome(
  facts: CentreBudgetPositionFacts,
  policy: ThresholdPolicyContext | undefined,
): BudgetThresholdOutcome {
  // No approved policy governs this month. This is not "within budget"; it
  // means nobody has decided what the bands are. BUDGET_ACCOUNTABILITY.md
  // lists overspend severities as candidates, not approved thresholds, so no
  // percentage is hard-coded anywhere in this module.
  if (policy === undefined) return { state: "NOT_CONFIGURED" };

  if (facts.kind !== "budget_and_actual") {
    return {
      state: "NOT_APPLICABLE",
      reason: "Percent used is unknown until both an approved budget and an actual exist.",
    };
  }
  if (facts.percentUsed === undefined) {
    return {
      state: "NOT_APPLICABLE",
      reason: "The approved budget is zero, so percent used is undefined.",
    };
  }
  if (facts.band === undefined) {
    return {
      state: "NOT_APPLICABLE",
      reason: "The governing threshold policy defines no band covering this percentage.",
    };
  }
  return {
    state: "BANDED",
    bandCode: facts.band.bandCode,
    bandLabel: facts.band.bandLabel,
    policyKey: policy.policyKey,
    policyVersion: policy.version,
    policyEffectiveFromMonth: policy.effectiveFromMonth,
  };
}

/**
 * Narrows the internal union onto the wire contract. Every optional contract
 * field is written in exactly one branch, so a field can only appear when its
 * variant supplies it.
 */
export function toCategoryPosition(
  category: BudgetCategoryDescriptor,
  facts: CentreBudgetPositionFacts,
  policy: ThresholdPolicyContext | undefined,
): CentreBudgetCategoryPosition {
  const base = { ...category, threshold: thresholdOutcome(facts, policy) };

  switch (facts.kind) {
    case "nothing_recorded":
      return { ...base, state: "NOTHING_RECORDED" };
    case "budget_only":
      return {
        ...base,
        state: "AWAITING_ACTUAL",
        approvedBudget: facts.approvedBudget,
      };
    case "actual_only":
      return {
        ...base,
        state: "ACTUAL_WITHOUT_BUDGET",
        actual: facts.actual,
      };
    case "budget_and_actual":
      return {
        ...base,
        state: "BUDGET_AND_ACTUAL",
        approvedBudget: facts.approvedBudget,
        actual: facts.actual,
        remaining: facts.remaining,
        ...(facts.percentUsed !== undefined ? { percentUsed: facts.percentUsed } : {}),
      };
    default: {
      const unreachable: never = facts;
      return unreachable;
    }
  }
}

/** PostgreSQL-computed totals for one centre-month, before coverage gating. */
export interface CentreBudgetTotals {
  totalApprovedBudget?: MoneyAmount;
  totalRecordedActual?: MoneyAmount;
  totalRemaining?: MoneyAmount;
  totalPercentUsed?: PercentValue;
  currency?: CurrencyCode;
  band?: ThresholdBandMatch;
}

/**
 * Counts every state, then decides which totals may be stated.
 *
 * Counts of what is missing are known negative evidence and are always safe.
 * Sums are withheld unless every governed category reported, because a total
 * computed over a partly entered month understates spend while looking
 * complete. This is the same rule Centre Quality applies to its reassuring
 * counts, applied here to money.
 */
export function summariseCentreMonth(
  positions: readonly CentreBudgetCategoryPosition[],
  totals: CentreBudgetTotals,
  policy: ThresholdPolicyContext | undefined,
): CentreBudgetMonthSummary {
  const count = (state: CentreBudgetCategoryPosition["state"]): number =>
    positions.filter((position) => position.state === state).length;

  const awaitingActualCount = count("AWAITING_ACTUAL");
  const actualWithoutBudgetCount = count("ACTUAL_WITHOUT_BUDGET");
  const nothingRecordedCount = count("NOTHING_RECORDED");
  const bothCount = count("BUDGET_AND_ACTUAL");

  const everyCategoryBudgeted =
    positions.length > 0 && awaitingActualCount + bothCount === positions.length;
  const everyCategoryComplete = positions.length > 0 && bothCount === positions.length;
  // A mixed-currency month cannot be summed at all, whatever its coverage.
  const singleCurrency = totals.currency !== undefined;

  const summary: CentreBudgetMonthSummary = {
    coverage: everyCategoryComplete && singleCurrency ? "complete" : "partial",
    categoryCount: positions.length,
    budgetedCategoryCount: awaitingActualCount + bothCount,
    recordedActualCount: actualWithoutBudgetCount + bothCount,
    awaitingActualCount,
    actualWithoutBudgetCount,
    nothingRecordedCount,
    ...(singleCurrency ? { currency: totals.currency } : {}),
  };

  if (
    everyCategoryBudgeted &&
    singleCurrency &&
    totals.totalApprovedBudget !== undefined
  ) {
    summary.totalApprovedBudget = totals.totalApprovedBudget;
  }

  if (summary.coverage !== "complete") return summary;

  if (totals.totalRecordedActual !== undefined) {
    summary.totalRecordedActual = totals.totalRecordedActual;
  }
  if (totals.totalRemaining !== undefined) {
    summary.totalRemaining = totals.totalRemaining;
  }
  if (totals.totalPercentUsed !== undefined) {
    summary.totalPercentUsed = totals.totalPercentUsed;
    summary.threshold =
      policy === undefined
        ? { state: "NOT_CONFIGURED" }
        : totals.band === undefined
          ? {
              state: "NOT_APPLICABLE",
              reason: "The governing threshold policy defines no band covering this percentage.",
            }
          : {
              state: "BANDED",
              bandCode: totals.band.bandCode,
              bandLabel: totals.band.bandLabel,
              policyKey: policy.policyKey,
              policyVersion: policy.version,
              policyEffectiveFromMonth: policy.effectiveFromMonth,
            };
  }

  return summary;
}
