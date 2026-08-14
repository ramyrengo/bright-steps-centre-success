import type { Header } from "encore.dev/api";

/**
 * Centre Budgets exposes a per-centre, per-month budget position by governed
 * reporting category: approved budget, recorded actual, remaining, and percent
 * used.
 * Two rules shape every type in this file.
 * 1. Unknown is not zero. A centre-month-category with no entry is a different
 *    state from one with an entry of 0.00, and the two must stay
 *    distinguishable all the way to the browser. Nothing here is defaulted,
 *    back-filled, or summed across a gap. Where a value is not known, its
 *    field is absent and `state` says why.
 * 2. Centre Success is not the accounting ledger. Every recorded value carries
 *    its provenance so a later reconciliation against a finance system of
 *    record is possible.
 */

/**
 * An exact decimal amount rendered as a string, for example `"12345.67"` or
 * `"0.00"`.
 * It is deliberately not a `number`. PostgreSQL stores these as
 * `NUMERIC(14,2)`, and DATABASE_SCHEMA.md requires that "Monetary values use
 * fixed precision, explicit currency, financial period, and source date—not
 * floating point." A JSON number would be parsed into an IEEE-754 double by
 * every JavaScript client, which cannot represent every two-decimal value
 * exactly and would reintroduce the rounding error the database type exists to
 * prevent. Consumers must format or compare these with a decimal-aware
 * routine, never with `parseFloat`.
 */
export type MoneyAmount = string;

/**
 * An exact percentage rendered as a string with two decimal places, for
 * example `"84.30"`. Same reasoning as `MoneyAmount`: it is computed in
 * PostgreSQL `NUMERIC` and never passes through a float.
 */
export type PercentValue = string;

/** ISO-4217-shaped currency code, for example `"AUD"`. */
export type CurrencyCode = string;

/**
 * Where a recorded financial value came from. `manual_entry` is what this
 * slice writes. `finance_system_import` exists so that a value posted by a
 * nominated finance system is distinguishable from a value someone typed,
 * without a schema or contract change when that integration is approved.
 */
export type BudgetValueSourceKind = "manual_entry" | "finance_system_import";

/**
 * Why a category is in the state it is in.
 * `NOTHING_RECORDED`       no approved budget and no actual. Nothing is known.
 * `AWAITING_ACTUAL`        an approved budget exists; no actual has been
 *                          entered. This is the state that must never render
 *                          as spend of zero.
 * `ACTUAL_WITHOUT_BUDGET`  an actual exists with no approved budget, so
 *                          remaining and percent used are undefined.
 * `BUDGET_AND_ACTUAL`      both are known and comparable.
 */
export type BudgetPositionState =
  | "NOTHING_RECORDED"
  | "AWAITING_ACTUAL"
  | "ACTUAL_WITHOUT_BUDGET"
  | "BUDGET_AND_ACTUAL";

/** An approved budget figure exactly as it was recorded. */
export interface ApprovedBudgetAmount {
  budgetLineId: string;
  amount: MoneyAmount;
  currency: CurrencyCode;
  sourceKind: BudgetValueSourceKind;
  recordedAt: string;
  /** Present only for `finance_system_import`. */
  sourceSystemKey?: string;
  /** Present only for `finance_system_import`. */
  sourceReference?: string;
}

/**
 * A recorded actual exactly as it was entered. An `amount` of `"0.00"` here is
 * a real, deliberate zero: somebody stated that nothing was spent. The absence
 * of this whole object is what "not entered" looks like.
 */
export interface RecordedActualAmount {
  actualId: string;
  amount: MoneyAmount;
  currency: CurrencyCode;
  sourceKind: BudgetValueSourceKind;
  enteredAt: string;
  /** Present only for `manual_entry`; the accountable person. */
  enteredByPrincipalId?: string;
  /** Present only for `finance_system_import`. */
  sourceSystemKey?: string;
  /** Present only for `finance_system_import`. */
  sourceReference?: string;
  /**
   * The stated cutoff of the source data. Present only for
   * `finance_system_import`; a manual entry has no source cutoff and must not
   * be given a fabricated one.
   */
  sourceCutoffAt?: string;
  note?: string;
  /**
   * Whether the Centre Director who entered or reviewed this figure stands
   * behind it. This is a state on the record, not an approval workflow: there
   * is no approver capability, no pending state, and no second person
   * required. `false` is a known fact — the value is recorded but unconfirmed
   * — so it is a boolean rather than an omitted field.
   */
  confirmed: boolean;
  /** Present only when `confirmed` is true. */
  confirmedAt?: string;
  /** Present only when `confirmed` is true. */
  confirmedByPrincipalId?: string;
}

/**
 * The threshold band this position falls in.
 * `NOT_CONFIGURED` means the organisation has no approved threshold policy in
 * force for this month. BUDGET_ACCOUNTABILITY.md lists overspend severities as
 * "Candidate categories—not approved thresholds", so no band is seeded
 * anywhere in this system. `NOT_CONFIGURED` must never be presented as a
 * reassuring green: it means nobody has decided what good looks like yet.
 * `NOT_APPLICABLE` means a policy exists but this position cannot be judged
 * against it, because percent used is undefined.
 */
export interface BudgetThresholdOutcome {
  state: "NOT_CONFIGURED" | "NOT_APPLICABLE" | "BANDED";
  /** Explains `NOT_APPLICABLE` rather than leaving the consumer to guess. */
  reason?: string;
  /** The following are present only when `state` is `BANDED`. */
  bandCode?: string;
  bandLabel?: string;
  policyKey?: string;
  policyVersion?: number;
  /** The month from which the governing policy version took effect. */
  policyEffectiveFromMonth?: string;
}

/**
 * One governed category's position for one centre-month.
 * Which fields are present is determined entirely by `state`:
 * | state                   | approvedBudget | actual | remaining | percentUsed |
 * | ----------------------- | -------------- | ------ | --------- | ----------- |
 * | `NOTHING_RECORDED`      | absent         | absent | absent    | absent      |
 * | `AWAITING_ACTUAL`       | present        | absent | absent    | absent      |
 * | `ACTUAL_WITHOUT_BUDGET` | absent         | present| absent    | absent      |
 * | `BUDGET_AND_ACTUAL`     | present        | present| present   | see below   |
 * The service builds these from an internal discriminated union
 * (`CentreBudgetPositionFacts` in `position.ts`), so a position carrying
 * `remaining` without an `actual` is not constructible.
 */
export interface CentreBudgetCategoryPosition {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  /**
   * A retired category still appears for a month that holds data against it,
   * so a historical month stays readable after the taxonomy moves on.
   */
  categoryStatus: "active" | "inactive";
  sortOrder: number;
  state: BudgetPositionState;
  approvedBudget?: ApprovedBudgetAmount;
  actual?: RecordedActualAmount;
  /** Approved budget less recorded actual. Only ever present under `BUDGET_AND_ACTUAL`. */
  remaining?: MoneyAmount;
  /**
   * Actual as a percentage of approved budget. Present under
   * `BUDGET_AND_ACTUAL` except when the approved budget is exactly zero:
   * dividing by nothing is undefined, not 0% and not 100%.
   */
  percentUsed?: PercentValue;
  threshold: BudgetThresholdOutcome;
}

/**
 * Roll-up across the categories of one centre-month.
 * Coverage governs which fields exist, on the same principle Centre Quality
 * uses. Counts of what is missing are known negative evidence and are always
 * safe to state. Sums are not: a total computed over a partly entered month
 * understates spend while looking authoritative, so every total is withheld
 * unless every contributing category is known and shares one currency.
 */
export interface CentreBudgetMonthSummary {
  coverage: "complete" | "partial";
  /** Governed categories considered for this centre-month. */
  categoryCount: number;
  /** Categories with an approved budget. */
  budgetedCategoryCount: number;
  /** Categories with a recorded actual, including deliberate zeros. */
  recordedActualCount: number;
  /** Categories with an approved budget and no actual yet. Known gap. */
  awaitingActualCount: number;
  /** Categories with an actual but no approved budget. Known gap. */
  actualWithoutBudgetCount: number;
  /** Categories with neither. Known gap. */
  nothingRecordedCount: number;
  /** The shared currency, present only when every recorded value agrees. */
  currency?: CurrencyCode;
  /** Present only when every category has an approved budget in one currency. */
  totalApprovedBudget?: MoneyAmount;
  /** The next three are present only under `complete` coverage. */
  totalRecordedActual?: MoneyAmount;
  totalRemaining?: MoneyAmount;
  totalPercentUsed?: PercentValue;
  /** Present only when `totalPercentUsed` is present and a policy governs the month. */
  threshold?: BudgetThresholdOutcome;
}

export interface CentreBudgetMonthRequest {
  centreId: string;
  /** Calendar month key, `YYYY-MM`. */
  month: string;
}

export interface CentreBudgetMonthResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  month: string;
  centreId: string;
  centreName: string;
  status: "ready" | "partial";
  /** One entry per governed category considered, including empty ones. */
  categories: CentreBudgetCategoryPosition[];
  summary: CentreBudgetMonthSummary;
  /** Whether the viewer may record an actual for this centre. */
  canEnterActual: boolean;
  /**
   * True when no approved threshold policy governs this month, so no position
   * carries a band. Surfaces must say so rather than implying an all-clear.
   */
  thresholdPolicyConfigured: boolean;
  warning?: string;
}

export interface PortfolioBudgetMonthRequest {
  /** Calendar month key, `YYYY-MM`. */
  month: string;
}

export interface PortfolioCentreBudgetCard {
  centreId: string;
  centreName: string;
  summary: CentreBudgetMonthSummary;
}

/**
 * `status` discriminates the response exactly as Centre Quality does.
 * `unsupported` means the viewer holds no budget read authority for any
 * centre. It queries no budget source, so it carries no `centres`, no
 * `coverage` and no counts. Returning an empty list with zero counts would
 * assert that the portfolio was checked and found empty, when nothing was
 * checked at all.
 */
export interface PortfolioBudgetMonthResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  month: string;
  status: "ready" | "partial" | "unsupported";
  /** The following are present only for an active projection. */
  centres?: PortfolioCentreBudgetCard[];
  /**
   * `partial` when a centre could not be authorised safely and was left out
   * entirely, or when any included centre's month is partly entered.
   */
  coverage?: "complete" | "partial";
  /** Centres actually included above. Never an organisation total. */
  visibleCentreCount?: number;
  /** Included centres whose month is fully entered. */
  completeCentreCount?: number;
  /** Included centres still missing at least one actual. Known gap. */
  incompleteCentreCount?: number;
  thresholdPolicyConfigured?: boolean;
  warning?: string;
}

/**
 * Records or confirms one monthly actual. The amount is a decimal string for
 * the same reason it is returned as one; sending `0` and sending nothing must
 * not become the same request.
 */
export interface RecordCentreBudgetActualRequest {
  centreId: string;
  /** Calendar month key, `YYYY-MM`. */
  month: string;
  categoryId: string;
  /** Exact decimal, up to two places, for example `"1250.00"`. `"0.00"` is a valid deliberate zero. */
  amount: MoneyAmount;
  currency: CurrencyCode;
  note?: string;
  /**
   * Marks the entry as confirmed by the submitting Centre Director. Defaults
   * to false. Confirming an earlier figure resubmits it with `confirmed: true`,
   * which supersedes the previous record and preserves both states.
   */
  confirmed?: boolean;
}

export interface RecordCentreBudgetActualResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  month: string;
  centreId: string;
  /** The resulting position for the category that was entered. */
  position: CentreBudgetCategoryPosition;
  /** The actual this entry superseded, when it corrected an earlier figure. */
  supersededActualId?: string;
}
