import type {
  ApprovedBudgetAmount,
  BudgetThresholdMeasure,
  BudgetThresholdOutcome,
  BudgetThresholdRuleOutcome,
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
      /** At most one band per governed rule, resolved in PostgreSQL. */
      bands?: readonly ThresholdBandMatch[];
    };

/**
 * The band one rule resolved to. `ruleCode` is part of the match because the
 * rules of one policy are resolved independently and grade in the same three
 * colours, so a band code alone does not say which rule reached it.
 */
export interface ThresholdBandMatch {
  ruleCode: string;
  bandCode: string;
  bandLabel: string;
}

/** One governed rule of the policy in force, and the quantity it judges. */
export interface ThresholdRuleDescriptor {
  ruleCode: string;
  ruleLabel: string;
  measure: BudgetThresholdMeasure;
}

/** The governing threshold policy for a month, when one exists. */
export interface ThresholdPolicyContext {
  policyKey: string;
  version: number;
  effectiveFromMonth: string;
  /**
   * Every rule the policy defines, in its approved display order. This comes
   * from the policy rather than from the position, so a rule still reports what
   * it could not judge for a centre-month that holds no row at all.
   */
  rules: readonly ThresholdRuleDescriptor[];
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
  bands?: readonly ThresholdBandMatch[];
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
    ...(input.bands !== undefined ? { bands: input.bands } : {}),
  };
}

/**
 * One rule's view of one measured quantity.
 *
 * `value` absent is the whole point of this type: it is the state in which no
 * band may be reached, and `unavailableReason` is what gets said instead of a
 * colour. A rule is never given a substitute value to judge.
 */
interface ThresholdMeasurement {
  value?: string;
  unavailableReason: string;
}

function ruleOutcome(
  rule: ThresholdRuleDescriptor,
  measurement: ThresholdMeasurement,
  bands: readonly ThresholdBandMatch[] | undefined,
): BudgetThresholdRuleOutcome {
  const base = {
    ruleCode: rule.ruleCode,
    ruleLabel: rule.ruleLabel,
    measure: rule.measure,
  };

  // Nothing to judge. This is the branch an unrecorded month lands in, and it
  // is reached before any band is consulted.
  if (measurement.value === undefined) {
    return { ...base, state: "NOT_APPLICABLE", reason: measurement.unavailableReason };
  }

  const band = bands?.find((candidate) => candidate.ruleCode === rule.ruleCode);
  if (band === undefined) {
    return {
      ...base,
      state: "NOT_APPLICABLE",
      reason: "This rule defines no band covering the value measured here.",
    };
  }
  return { ...base, state: "BANDED", bandCode: band.bandCode, bandLabel: band.bandLabel };
}

/**
 * Resolves every rule of the governing policy against the same position.
 *
 * Each rule is answered from its own measure and its own bands. No rule's
 * answer is derived from another's, and no answer is dropped because it
 * disagrees with another: two rules of one approved policy are entitled to
 * reach different conclusions, and hiding one of them would present a decision
 * nobody approved.
 */
function governedOutcome(
  policy: ThresholdPolicyContext,
  measurements: Readonly<Record<BudgetThresholdMeasure, ThresholdMeasurement>>,
  bands: readonly ThresholdBandMatch[] | undefined,
): BudgetThresholdOutcome {
  return {
    state: "GOVERNED",
    rules: policy.rules.map((rule) => ruleOutcome(rule, measurements[rule.measure], bands)),
    policyKey: policy.policyKey,
    policyVersion: policy.version,
    policyEffectiveFromMonth: policy.effectiveFromMonth,
  };
}

function thresholdOutcome(
  facts: CentreBudgetPositionFacts,
  policy: ThresholdPolicyContext | undefined,
): BudgetThresholdOutcome {
  // No approved policy governs this month. This is not "within budget"; it
  // means nobody had decided what the bands were. No percentage and no band is
  // hard-coded anywhere in this module: every one of them is governed data.
  if (policy === undefined) return { state: "NOT_CONFIGURED", rules: [] };

  const bothValuesNeeded =
    "Both an approved budget and a recorded actual are needed before this can be judged.";

  if (facts.kind !== "budget_and_actual") {
    return governedOutcome(
      policy,
      {
        percent_used: { unavailableReason: bothValuesNeeded },
        remaining_amount: { unavailableReason: bothValuesNeeded },
      },
      undefined,
    );
  }

  return governedOutcome(
    policy,
    {
      // The one case where the two rules part company on the same position:
      // percent used has no answer against an approved budget of zero, while
      // what remains is still a real amount.
      percent_used: {
        ...(facts.percentUsed !== undefined ? { value: facts.percentUsed } : {}),
        unavailableReason: "The approved budget is zero, so percent used is undefined.",
      },
      remaining_amount: {
        value: facts.remaining,
        unavailableReason: bothValuesNeeded,
      },
    },
    facts.bands,
  );
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

const MONTH_TOTALS_UNAVAILABLE =
  "Every category needs both an approved budget and a recorded actual before the month can be judged.";

/** PostgreSQL-computed totals for one centre-month, before coverage gating. */
export interface CentreBudgetTotals {
  totalApprovedBudget?: MoneyAmount;
  totalRecordedActual?: MoneyAmount;
  totalRemaining?: MoneyAmount;
  totalPercentUsed?: PercentValue;
  currency?: CurrencyCode;
  bands?: readonly ThresholdBandMatch[];
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
  }

  // The month-level roll-up is judged by the same rules, over the same measures,
  // as a single category is. It is stated here and not under partial coverage,
  // because a total summed across a gap understates spend, and grading an
  // understated total would turn a missing figure into a reassuring colour.
  summary.threshold =
    policy === undefined
      ? { state: "NOT_CONFIGURED", rules: [] }
      : governedOutcome(
          policy,
          {
            percent_used: {
              ...(totals.totalPercentUsed !== undefined
                ? { value: totals.totalPercentUsed }
                : {}),
              unavailableReason:
                "The approved budget for this month totals zero, so percent used is undefined.",
            },
            remaining_amount: {
              ...(totals.totalRemaining !== undefined
                ? { value: totals.totalRemaining }
                : {}),
              unavailableReason: MONTH_TOTALS_UNAVAILABLE,
            },
          },
          totals.bands,
        );

  return summary;
}
