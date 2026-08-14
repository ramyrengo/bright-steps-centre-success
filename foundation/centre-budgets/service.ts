import { randomUUID } from "node:crypto";
import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { loadOrganisationCentreAuthorisationFacts } from "../authorization/batch-centres";
import {
  FOUNDATION_CAPABILITIES,
  type FoundationCapability,
} from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import type { AuthorisationQueryExecutor } from "../authorization/database";
import { authorise, type PrincipalAuthorisationContext } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { inSerializableTransaction } from "../transactions";
import type {
  ApprovedBudgetAmount,
  CentreBudgetCategoryPosition,
  CentreBudgetMonthResponse,
  CentreBudgetMonthSummary,
  PortfolioBudgetMonthResponse,
  PortfolioCentreBudgetCard,
  RecordCentreBudgetActualRequest,
  RecordCentreBudgetActualResponse,
  RecordedActualAmount,
} from "./contracts";
import {
  buildPositionFacts,
  CentreBudgetPositionError,
  summariseCentreMonth,
  toCategoryPosition,
  type BudgetCategoryDescriptor,
  type CentreBudgetTotals,
  type ThresholdPolicyContext,
} from "./position";
import {
  CentreBudgetError,
  parseMonthKey,
  requireCurrencyCode,
  requireDecimalAmount,
  requireOptionalNote,
  requireUuid,
} from "./validation";

/** Re-exported so callers keep one import site for the module's error type. */
export { CentreBudgetError, parseMonthKey, requireDecimalAmount } from "./validation";

/**
 * Centre Budgets serves a per-centre, per-month budget position and accepts a
 * monthly actual for a permitted centre.
 *
 * Two capabilities gate it, evaluated per centre through the existing
 * PostgreSQL authorisation: `budget.position.read` and `budget.actual.enter`.
 * Neither is held by the canonical System Administrator bundle, so technical
 * administration confers no authority over financial content.
 *
 * Every monetary value is read out of PostgreSQL as text and returned as text.
 * No amount is ever parsed into a JavaScript number anywhere in this module;
 * subtraction, division and summation all happen in `NUMERIC`.
 */

const BUDGET_CENTRE_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.budgetPositionRead,
  FOUNDATION_CAPABILITIES.budgetActualEnter,
] as const;

export interface CentreBudgetDiagnostics {
  queryCount: number;
}

export interface BuildCentreBudgetResult<T> {
  response: T;
  diagnostics: CentreBudgetDiagnostics;
}

export interface CentreBudgetDependencies {
  now: () => Date;
}

const runtimeDependencies: CentreBudgetDependencies = { now: () => new Date() };

interface BudgetQueryExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<unknown>;
}

function countedExecutor(
  transaction: Transaction,
  onQuery: () => void,
): BudgetQueryExecutor {
  return {
    queryAll: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryAll(strings, ...values);
    }) as BudgetQueryExecutor["queryAll"],
    queryRow: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryRow(strings, ...values);
    }) as BudgetQueryExecutor["queryRow"],
    exec: async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      await transaction.exec(strings, ...values);
    },
  };
}

interface OrganisationRow {
  id: string;
  name: string;
}

interface CentreBudgetAuthorisation {
  principalId: string;
  organisationId: string;
  decisionAt: Date;
  centreNames: ReadonlyMap<string, string>;
  centreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  invalidCentreIds: ReadonlySet<string>;
}

function ids(
  authorisation: CentreBudgetAuthorisation,
  capability: FoundationCapability,
): ReadonlySet<string> {
  return authorisation.centreIdsByCapability.get(capability) ?? new Set<string>();
}

/**
 * Resolves the one active organisation a principal may act in.
 *
 * The principal's own existence and active status are enforced by joining
 * `principals` here rather than by reading that row separately: the
 * authorisation context loader reads the identical row moments later inside the
 * same `REPEATABLE READ` snapshot, where it is guaranteed to be unchanged, so a
 * standalone lookup would only be a second trip for an answer already coming.
 * A missing principal, an inactive one, and a principal with no single active
 * organisation all fail closed the same way, exactly as before.
 */
async function loadPrincipalOrganisation(
  executor: AuthorisationQueryExecutor,
  principalId: string,
  decisionAt: Date,
): Promise<OrganisationRow> {
  const organisations = await executor.queryAll<OrganisationRow>`
    SELECT DISTINCT organisation.id, organisation.name
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
    JOIN organisations AS organisation ON organisation.id = membership.organisation_id
    WHERE principal.id = ${principalId}
      AND principal.status = 'active'
      AND membership.status = 'active'
      AND membership.effective_from <= ${decisionAt}
      AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
      AND organisation.status = 'active'
    ORDER BY organisation.id
  `;
  // Exactly one active organisation, or the request fails closed. This matches
  // the Milestone 2A rule that multiple active memberships are ambiguous.
  if (organisations.length !== 1) throw new CentreBudgetError("access_denied");
  return organisations[0];
}

/**
 * Builds the authorised centre sets once per request.
 *
 * Centre facts and the principal context are each loaded with one set-wise
 * query, then capability evaluation is pure and in memory. A portfolio of
 * twenty centres therefore costs exactly what a portfolio of one costs.
 */
async function loadAuthorisation(
  executor: BudgetQueryExecutor,
  principalId: string,
  decisionAt: Date,
): Promise<CentreBudgetAuthorisation> {
  requireUuid(principalId);
  const organisation = await loadPrincipalOrganisation(executor, principalId, decisionAt);

  const context: PrincipalAuthorisationContext =
    await loadPrincipalAuthorisationContextFromSnapshot(executor, {
      principalId,
      activeOrganisationId: organisation.id,
      at: decisionAt,
    });
  const centreFacts = await loadOrganisationCentreAuthorisationFacts(
    executor,
    organisation.id,
    decisionAt,
  );

  const centreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
  for (const capability of BUDGET_CENTRE_CAPABILITIES) {
    centreIdsByCapability.set(
      capability,
      new Set(
        centreFacts.centres
          .filter(
            (centre) =>
              authorise({ context, capability, resource: centre.resource, at: decisionAt })
                .allowed,
          )
          .map((centre) => centre.id),
      ),
    );
  }

  return {
    principalId,
    organisationId: organisation.id,
    decisionAt,
    centreNames: new Map(centreFacts.centres.map((centre) => [centre.id, centre.name])),
    centreIdsByCapability,
    // A centre whose hierarchy cannot be resolved safely is authorised for
    // nothing at all, and its absence is what makes portfolio coverage partial.
    invalidCentreIds: new Set(centreFacts.invalidCentres.map((centre) => centre.id)),
  };
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  sort_order: number | string;
}

async function loadCategories(
  executor: BudgetQueryExecutor,
  organisationId: string,
): Promise<BudgetCategoryDescriptor[]> {
  const rows = await executor.queryAll<CategoryRow>`
    SELECT id, code, name, status, sort_order
    FROM budget_categories
    WHERE organisation_id = ${organisationId}
    ORDER BY sort_order, code
  `;
  return rows.map((row) => ({
    categoryId: row.id,
    categoryCode: row.code,
    categoryName: row.name,
    categoryStatus: row.status,
    sortOrder: Number(row.sort_order),
  }));
}

interface ThresholdPolicyRow {
  id: string;
  policy_key: string;
  version: number | string;
  effective_from_month: Date | string;
}

/**
 * Resolves the threshold policy that governed the requested month, not the one
 * in force today, so a historical month stays interpretable under the bands
 * that applied when it was recorded.
 *
 * No policy is seeded by any migration. BUDGET_ACCOUNTABILITY.md describes
 * overspend severities as "Candidate categories—not approved thresholds", so
 * the bands are an owner decision and this returns `undefined` until one is
 * governed into existence.
 */
async function loadGoverningThresholdPolicy(
  executor: BudgetQueryExecutor,
  organisationId: string,
  monthKey: string,
): Promise<{ id: string; context: ThresholdPolicyContext } | undefined> {
  const row = await executor.queryRow<ThresholdPolicyRow>`
    SELECT id, policy_key, version, effective_from_month
    FROM budget_threshold_policies
    WHERE organisation_id = ${organisationId}
      AND status = 'active'
      AND effective_from_month <= ${monthKey}::date
      AND (effective_to_month IS NULL OR effective_to_month > ${monthKey}::date)
    ORDER BY effective_from_month DESC, version DESC
    LIMIT 1
  `;
  if (!row) return undefined;
  const effectiveFrom =
    row.effective_from_month instanceof Date
      ? row.effective_from_month.toISOString().slice(0, 7)
      : String(row.effective_from_month).slice(0, 7);
  return {
    id: row.id,
    context: {
      policyKey: row.policy_key,
      version: Number(row.version),
      effectiveFromMonth: effectiveFrom,
    },
  };
}

/**
 * One row per centre-month-category that holds an approved budget, an actual,
 * or both. Every monetary column is cast to text so no exact decimal is ever
 * handed to JavaScript as a float.
 */
interface PositionRow {
  centre_id: string;
  category_id: string;
  budget_line_id: string | null;
  budget_amount: string | null;
  budget_currency: string | null;
  budget_source_kind: "manual_entry" | "finance_system_import" | null;
  budget_source_system_key: string | null;
  budget_source_reference: string | null;
  budget_recorded_at: Date | null;
  actual_id: string | null;
  actual_amount: string | null;
  actual_currency: string | null;
  actual_source_kind: "manual_entry" | "finance_system_import" | null;
  actual_source_system_key: string | null;
  actual_source_reference: string | null;
  actual_source_cutoff_at: Date | null;
  actual_note: string | null;
  actual_entered_by: string | null;
  actual_entered_at: Date | null;
  actual_confirmed_at: Date | null;
  actual_confirmed_by: string | null;
  remaining: string | null;
  percent_used: string | null;
  band_code: string | null;
  band_label: string | null;
}

async function loadPositionRows(
  executor: BudgetQueryExecutor,
  organisationId: string,
  centreIds: readonly string[],
  monthKey: string,
  thresholdPolicyId: string | null,
): Promise<PositionRow[]> {
  return executor.queryAll<PositionRow>`
    WITH current_lines AS (
      SELECT centre_id, category_id, id, amount, currency_code, source_kind,
             source_system_key, source_reference, recorded_at
      FROM centre_budget_lines
      WHERE organisation_id = ${organisationId}
        AND period_month = ${monthKey}::date
        AND centre_id = ANY(${centreIds as string[]}::uuid[])
        AND superseded_at IS NULL
    ),
    current_actuals AS (
      SELECT centre_id, category_id, id, amount, currency_code, source_kind,
             source_system_key, source_reference, source_cutoff_at, note,
             entered_by_principal_id, entered_at, confirmed_at,
             confirmed_by_principal_id
      FROM centre_budget_actuals
      WHERE organisation_id = ${organisationId}
        AND period_month = ${monthKey}::date
        AND centre_id = ANY(${centreIds as string[]}::uuid[])
        AND superseded_at IS NULL
    ),
    combined AS (
      SELECT
        COALESCE(line.centre_id, actual.centre_id) AS centre_id,
        COALESCE(line.category_id, actual.category_id) AS category_id,
        line.id AS budget_line_id,
        line.amount AS budget_amount_numeric,
        line.currency_code AS budget_currency,
        line.source_kind AS budget_source_kind,
        line.source_system_key AS budget_source_system_key,
        line.source_reference AS budget_source_reference,
        line.recorded_at AS budget_recorded_at,
        actual.id AS actual_id,
        actual.amount AS actual_amount_numeric,
        actual.currency_code AS actual_currency,
        actual.source_kind AS actual_source_kind,
        actual.source_system_key AS actual_source_system_key,
        actual.source_reference AS actual_source_reference,
        actual.source_cutoff_at AS actual_source_cutoff_at,
        actual.note AS actual_note,
        actual.entered_by_principal_id AS actual_entered_by,
        actual.entered_at AS actual_entered_at,
        actual.confirmed_at AS actual_confirmed_at,
        actual.confirmed_by_principal_id AS actual_confirmed_by,
        CASE
          WHEN line.id IS NOT NULL
           AND actual.id IS NOT NULL
           AND line.currency_code = actual.currency_code
          THEN line.amount - actual.amount
        END AS remaining_numeric,
        CASE
          WHEN line.id IS NOT NULL
           AND actual.id IS NOT NULL
           AND line.currency_code = actual.currency_code
           AND line.amount <> 0
          THEN round(actual.amount * 100 / line.amount, 2)
        END AS percent_used_numeric
      FROM current_lines AS line
      FULL OUTER JOIN current_actuals AS actual
        ON actual.centre_id = line.centre_id
       AND actual.category_id = line.category_id
    )
    SELECT
      combined.centre_id,
      combined.category_id,
      combined.budget_line_id,
      combined.budget_amount_numeric::text AS budget_amount,
      combined.budget_currency,
      combined.budget_source_kind,
      combined.budget_source_system_key,
      combined.budget_source_reference,
      combined.budget_recorded_at,
      combined.actual_id,
      combined.actual_amount_numeric::text AS actual_amount,
      combined.actual_currency,
      combined.actual_source_kind,
      combined.actual_source_system_key,
      combined.actual_source_reference,
      combined.actual_source_cutoff_at,
      combined.actual_note,
      combined.actual_entered_by,
      combined.actual_entered_at,
      combined.actual_confirmed_at,
      combined.actual_confirmed_by,
      combined.remaining_numeric::text AS remaining,
      combined.percent_used_numeric::text AS percent_used,
      band.band_code,
      band.label AS band_label
    FROM combined
    LEFT JOIN LATERAL (
      SELECT threshold_band.band_code, threshold_band.label
      FROM budget_threshold_bands AS threshold_band
      WHERE threshold_band.threshold_policy_id = ${thresholdPolicyId}::uuid
        AND combined.percent_used_numeric IS NOT NULL
        AND combined.percent_used_numeric >= threshold_band.minimum_percent_used
        AND (
          threshold_band.maximum_percent_used IS NULL
          OR combined.percent_used_numeric < threshold_band.maximum_percent_used
        )
      ORDER BY threshold_band.priority
      LIMIT 1
    ) AS band ON TRUE
  `;
}

interface TotalsRow {
  centre_id: string;
  total_budget: string | null;
  total_actual: string | null;
  total_remaining: string | null;
  total_percent_used: string | null;
  currency_count: number | string;
  currency: string | null;
  band_code: string | null;
  band_label: string | null;
}

/**
 * Per-centre sums, computed in `NUMERIC`. Whether any of them may be published
 * is decided afterwards from coverage: these are raw sums over whatever rows
 * exist, and a sum over a partly entered month must never be shown.
 */
async function loadTotals(
  executor: BudgetQueryExecutor,
  organisationId: string,
  centreIds: readonly string[],
  monthKey: string,
  thresholdPolicyId: string | null,
): Promise<TotalsRow[]> {
  return executor.queryAll<TotalsRow>`
    WITH current_lines AS (
      SELECT centre_id, category_id, amount, currency_code
      FROM centre_budget_lines
      WHERE organisation_id = ${organisationId}
        AND period_month = ${monthKey}::date
        AND centre_id = ANY(${centreIds as string[]}::uuid[])
        AND superseded_at IS NULL
    ),
    current_actuals AS (
      SELECT centre_id, category_id, amount, currency_code
      FROM centre_budget_actuals
      WHERE organisation_id = ${organisationId}
        AND period_month = ${monthKey}::date
        AND centre_id = ANY(${centreIds as string[]}::uuid[])
        AND superseded_at IS NULL
    ),
    combined AS (
      SELECT
        COALESCE(line.centre_id, actual.centre_id) AS centre_id,
        line.amount AS budget_amount,
        actual.amount AS actual_amount,
        COALESCE(line.currency_code, actual.currency_code) AS currency_code,
        CASE
          WHEN line.amount IS NOT NULL
           AND actual.amount IS NOT NULL
           AND line.currency_code = actual.currency_code
          THEN line.amount - actual.amount
        END AS remaining
      FROM current_lines AS line
      FULL OUTER JOIN current_actuals AS actual
        ON actual.centre_id = line.centre_id
       AND actual.category_id = line.category_id
    ),
    aggregated AS (
      SELECT
        centre_id,
        sum(budget_amount) AS total_budget_numeric,
        sum(actual_amount) AS total_actual_numeric,
        sum(remaining) AS total_remaining_numeric,
        CASE
          WHEN sum(budget_amount) IS NOT NULL AND sum(budget_amount) <> 0
          THEN round(sum(actual_amount) * 100 / sum(budget_amount), 2)
        END AS total_percent_used_numeric,
        count(DISTINCT currency_code) AS currency_count,
        min(currency_code) AS currency
      FROM combined
      GROUP BY centre_id
    )
    SELECT
      aggregated.centre_id,
      aggregated.total_budget_numeric::text AS total_budget,
      aggregated.total_actual_numeric::text AS total_actual,
      aggregated.total_remaining_numeric::text AS total_remaining,
      aggregated.total_percent_used_numeric::text AS total_percent_used,
      aggregated.currency_count,
      aggregated.currency,
      band.band_code,
      band.label AS band_label
    FROM aggregated
    LEFT JOIN LATERAL (
      SELECT threshold_band.band_code, threshold_band.label
      FROM budget_threshold_bands AS threshold_band
      WHERE threshold_band.threshold_policy_id = ${thresholdPolicyId}::uuid
        AND aggregated.total_percent_used_numeric IS NOT NULL
        AND aggregated.total_percent_used_numeric >= threshold_band.minimum_percent_used
        AND (
          threshold_band.maximum_percent_used IS NULL
          OR aggregated.total_percent_used_numeric < threshold_band.maximum_percent_used
        )
      ORDER BY threshold_band.priority
      LIMIT 1
    ) AS band ON TRUE
  `;
}

function toIsoString(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function approvedBudgetFrom(row: PositionRow): ApprovedBudgetAmount | undefined {
  if (
    row.budget_line_id === null ||
    row.budget_amount === null ||
    row.budget_currency === null ||
    row.budget_source_kind === null ||
    row.budget_recorded_at === null
  ) {
    return undefined;
  }
  return {
    budgetLineId: row.budget_line_id,
    amount: row.budget_amount,
    currency: row.budget_currency,
    sourceKind: row.budget_source_kind,
    recordedAt: row.budget_recorded_at.toISOString(),
    ...(row.budget_source_system_key !== null
      ? { sourceSystemKey: row.budget_source_system_key }
      : {}),
    ...(row.budget_source_reference !== null
      ? { sourceReference: row.budget_source_reference }
      : {}),
  };
}

function recordedActualFrom(row: PositionRow): RecordedActualAmount | undefined {
  if (
    row.actual_id === null ||
    row.actual_amount === null ||
    row.actual_currency === null ||
    row.actual_source_kind === null ||
    row.actual_entered_at === null
  ) {
    return undefined;
  }
  return {
    actualId: row.actual_id,
    amount: row.actual_amount,
    currency: row.actual_currency,
    sourceKind: row.actual_source_kind,
    enteredAt: row.actual_entered_at.toISOString(),
    ...(row.actual_entered_by !== null
      ? { enteredByPrincipalId: row.actual_entered_by }
      : {}),
    ...(row.actual_source_system_key !== null
      ? { sourceSystemKey: row.actual_source_system_key }
      : {}),
    ...(row.actual_source_reference !== null
      ? { sourceReference: row.actual_source_reference }
      : {}),
    ...(toIsoString(row.actual_source_cutoff_at) !== undefined
      ? { sourceCutoffAt: row.actual_source_cutoff_at!.toISOString() }
      : {}),
    ...(row.actual_note !== null ? { note: row.actual_note } : {}),
    confirmed: row.actual_confirmed_at !== null,
    ...(row.actual_confirmed_at !== null
      ? { confirmedAt: row.actual_confirmed_at.toISOString() }
      : {}),
    ...(row.actual_confirmed_by !== null
      ? { confirmedByPrincipalId: row.actual_confirmed_by }
      : {}),
  };
}

function positionFor(
  category: BudgetCategoryDescriptor,
  row: PositionRow | undefined,
  policy: ThresholdPolicyContext | undefined,
): CentreBudgetCategoryPosition {
  if (row === undefined) {
    // No approved budget and no actual. This is the state that must never be
    // rendered as spend of zero, so it carries no amount at all.
    return toCategoryPosition(category, { kind: "nothing_recorded" }, policy);
  }
  const facts = buildPositionFacts({
    approvedBudget: approvedBudgetFrom(row),
    actual: recordedActualFrom(row),
    ...(row.remaining !== null ? { remaining: row.remaining } : {}),
    ...(row.percent_used !== null ? { percentUsed: row.percent_used } : {}),
    ...(row.band_code !== null && row.band_label !== null
      ? { band: { bandCode: row.band_code, bandLabel: row.band_label } }
      : {}),
  });
  return toCategoryPosition(category, facts, policy);
}

function totalsFor(row: TotalsRow | undefined): CentreBudgetTotals {
  if (row === undefined) return {};
  const singleCurrency = Number(row.currency_count) === 1 && row.currency !== null;
  return {
    ...(row.total_budget !== null ? { totalApprovedBudget: row.total_budget } : {}),
    ...(row.total_actual !== null ? { totalRecordedActual: row.total_actual } : {}),
    ...(row.total_remaining !== null ? { totalRemaining: row.total_remaining } : {}),
    ...(row.total_percent_used !== null
      ? { totalPercentUsed: row.total_percent_used }
      : {}),
    ...(singleCurrency ? { currency: row.currency as string } : {}),
    ...(row.band_code !== null && row.band_label !== null
      ? { band: { bandCode: row.band_code, bandLabel: row.band_label } }
      : {}),
  };
}

/**
 * Selects the categories a centre-month should report.
 *
 * Every currently active category appears, so a category with nothing recorded
 * is visibly empty instead of silently missing. A retired category appears
 * only when this centre-month actually holds data against it, which keeps a
 * historical month readable after the taxonomy moves on without cluttering
 * current months with dead categories.
 */
function categoriesForCentre(
  categories: readonly BudgetCategoryDescriptor[],
  centreCategoryIds: ReadonlySet<string>,
): BudgetCategoryDescriptor[] {
  return categories.filter(
    (category) =>
      category.categoryStatus === "active" || centreCategoryIds.has(category.categoryId),
  );
}

function buildCentreMonth(
  categories: readonly BudgetCategoryDescriptor[],
  rowsByCategory: ReadonlyMap<string, PositionRow>,
  totals: CentreBudgetTotals,
  policy: ThresholdPolicyContext | undefined,
): { positions: CentreBudgetCategoryPosition[]; summary: CentreBudgetMonthSummary } {
  const scoped = categoriesForCentre(categories, new Set(rowsByCategory.keys()));
  const positions = scoped.map((category) =>
    positionFor(category, rowsByCategory.get(category.categoryId), policy),
  );
  return { positions, summary: summariseCentreMonth(positions, totals, policy) };
}

function groupRowsByCentre(
  rows: readonly PositionRow[],
): Map<string, Map<string, PositionRow>> {
  const grouped = new Map<string, Map<string, PositionRow>>();
  for (const row of rows) {
    const centre = grouped.get(row.centre_id) ?? new Map<string, PositionRow>();
    centre.set(row.category_id, row);
    grouped.set(row.centre_id, centre);
  }
  return grouped;
}

async function readSnapshot<T>(
  build: (executor: BudgetQueryExecutor, count: () => number) => Promise<T>,
): Promise<BuildCentreBudgetResult<T>> {
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => {
    queryCount += 1;
  });
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const response = await build(executor, () => queryCount);
    await transaction.commit();
    return { response, diagnostics: { queryCount } };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CentreBudgetError) throw error;
    if (error instanceof CentreBudgetPositionError) {
      throw new CentreBudgetError("context_unavailable", { cause: error });
    }
    // Nothing about the failure is echoed back: a budget route must not become
    // a probe for which centres or categories exist.
    console.error("Centre Budgets request failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new CentreBudgetError("context_unavailable", { cause: error });
  }
}

export async function buildCentreBudgetMonth(
  input: { principalId: string; centreId: string; month: string },
  dependencies: CentreBudgetDependencies = runtimeDependencies,
): Promise<BuildCentreBudgetResult<CentreBudgetMonthResponse>> {
  const centreId = requireUuid(input.centreId);
  const monthKey = parseMonthKey(input.month);
  const decisionAt = dependencies.now();

  return readSnapshot(async (executor) => {
    const authorisation = await loadAuthorisation(executor, input.principalId, decisionAt);

    if (authorisation.invalidCentreIds.has(centreId)) {
      throw new CentreBudgetError("centre_context_unavailable");
    }
    const readable = ids(authorisation, FOUNDATION_CAPABILITIES.budgetPositionRead);
    // The requested centre is a resource, never a claim of access. A centre
    // outside the authorised set is denied identically to one that does not
    // exist, so the route cannot be used to discover centres.
    if (!readable.has(centreId)) throw new CentreBudgetError("access_denied");

    const categories = await loadCategories(executor, authorisation.organisationId);
    const policy = await loadGoverningThresholdPolicy(
      executor,
      authorisation.organisationId,
      monthKey,
    );
    const rows = await loadPositionRows(
      executor,
      authorisation.organisationId,
      [centreId],
      monthKey,
      policy?.id ?? null,
    );
    const totalRows = await loadTotals(
      executor,
      authorisation.organisationId,
      [centreId],
      monthKey,
      policy?.id ?? null,
    );

    const rowsByCategory = groupRowsByCentre(rows).get(centreId) ?? new Map();
    const { positions, summary } = buildCentreMonth(
      categories,
      rowsByCategory,
      totalsFor(totalRows.find((row) => row.centre_id === centreId)),
      policy?.context,
    );

    const response: CentreBudgetMonthResponse = {
      cacheControl: "private, no-store",
      asOf: decisionAt.toISOString(),
      month: input.month,
      centreId,
      centreName: authorisation.centreNames.get(centreId) ?? "",
      status: summary.coverage === "complete" ? "ready" : "partial",
      categories: positions,
      summary,
      canEnterActual: ids(
        authorisation,
        FOUNDATION_CAPABILITIES.budgetActualEnter,
      ).has(centreId),
      thresholdPolicyConfigured: policy !== undefined,
      ...(summary.coverage === "complete"
        ? {}
        : {
            warning:
              "Some categories have no actual recorded yet, so this month is not a complete picture.",
          }),
    };
    return response;
  });
}

export async function buildPortfolioBudgetMonth(
  input: { principalId: string; month: string },
  dependencies: CentreBudgetDependencies = runtimeDependencies,
): Promise<BuildCentreBudgetResult<PortfolioBudgetMonthResponse>> {
  const monthKey = parseMonthKey(input.month);
  const decisionAt = dependencies.now();

  return readSnapshot(async (executor) => {
    const authorisation = await loadAuthorisation(executor, input.principalId, decisionAt);
    const readable = [
      ...ids(authorisation, FOUNDATION_CAPABILITIES.budgetPositionRead),
    ].sort();

    const base = {
      cacheControl: "private, no-store" as const,
      asOf: decisionAt.toISOString(),
      month: input.month,
    };

    // No authorised centre means no budget source is queried at all. Returning
    // an empty centre list with zero counts would assert that a portfolio was
    // checked and found empty, when nothing was checked.
    if (readable.length === 0) {
      return { ...base, status: "unsupported" as const };
    }

    const categories = await loadCategories(executor, authorisation.organisationId);
    const policy = await loadGoverningThresholdPolicy(
      executor,
      authorisation.organisationId,
      monthKey,
    );
    const rows = await loadPositionRows(
      executor,
      authorisation.organisationId,
      readable,
      monthKey,
      policy?.id ?? null,
    );
    const totalRows = await loadTotals(
      executor,
      authorisation.organisationId,
      readable,
      monthKey,
      policy?.id ?? null,
    );

    const rowsByCentre = groupRowsByCentre(rows);
    const totalsByCentre = new Map(totalRows.map((row) => [row.centre_id, row]));

    const centres: PortfolioCentreBudgetCard[] = readable.map((centreId) => {
      const { summary } = buildCentreMonth(
        categories,
        rowsByCentre.get(centreId) ?? new Map(),
        totalsFor(totalsByCentre.get(centreId)),
        policy?.context,
      );
      return {
        centreId,
        centreName: authorisation.centreNames.get(centreId) ?? "",
        summary,
      };
    });

    const completeCentreCount = centres.filter(
      (centre) => centre.summary.coverage === "complete",
    ).length;
    // A centre that could not be authorised safely is missing from this list
    // entirely, so the viewer is looking at an unknowingly smaller portfolio.
    // Coverage has to record that before any count is read as a portfolio fact.
    const authorisationPartial = authorisation.invalidCentreIds.size > 0;
    const coverage =
      authorisationPartial || completeCentreCount !== centres.length
        ? ("partial" as const)
        : ("complete" as const);

    const response: PortfolioBudgetMonthResponse = {
      ...base,
      status: coverage === "complete" ? "ready" : "partial",
      centres,
      coverage,
      visibleCentreCount: centres.length,
      completeCentreCount,
      incompleteCentreCount: centres.length - completeCentreCount,
      thresholdPolicyConfigured: policy !== undefined,
      ...(coverage === "complete"
        ? {}
        : {
            warning: authorisationPartial
              ? "Some centres could not be checked, so this is not a complete portfolio view."
              : "Some centres are still missing actuals for this month.",
          }),
    };
    return response;
  });
}

/**
 * Records or confirms one monthly actual.
 *
 * The entry is append-only: an existing figure is superseded rather than
 * edited, so the earlier value, its author and its time survive. Both the
 * database triggers and this path enforce that, because provenance is the
 * whole point of the finance seam.
 */
export async function recordCentreBudgetActual(
  input: { principalId: string; request: RecordCentreBudgetActualRequest },
  dependencies: CentreBudgetDependencies = runtimeDependencies,
): Promise<BuildCentreBudgetResult<RecordCentreBudgetActualResponse>> {
  const principalId = requireUuid(input.principalId);
  const centreId = requireUuid(input.request.centreId);
  const categoryId = requireUuid(input.request.categoryId);
  const monthKey = parseMonthKey(input.request.month);
  const amount = requireDecimalAmount(input.request.amount);
  const currency = requireCurrencyCode(input.request.currency);
  const note = requireOptionalNote(input.request.note);
  if (input.request.confirmed !== undefined && typeof input.request.confirmed !== "boolean") {
    throw new CentreBudgetError("invalid_input");
  }
  const confirmed = input.request.confirmed === true;
  const decisionAt = dependencies.now();

  let queryCount = 0;
  try {
    const response = await inSerializableTransaction(async (transaction) => {
      const executor = countedExecutor(transaction, () => {
        queryCount += 1;
      });
      const authorisation = await loadAuthorisation(executor, principalId, decisionAt);

      if (authorisation.invalidCentreIds.has(centreId)) {
        throw new CentreBudgetError("centre_context_unavailable");
      }
      // Entry authority is checked for this exact centre. The browser never
      // supplies it and a System Administrator never holds it.
      if (!ids(authorisation, FOUNDATION_CAPABILITIES.budgetActualEnter).has(centreId)) {
        throw new CentreBudgetError("access_denied");
      }
      // The response carries the approved budget alongside the entry, which is
      // budget content, so read authority is required to receive it as well.
      if (!ids(authorisation, FOUNDATION_CAPABILITIES.budgetPositionRead).has(centreId)) {
        throw new CentreBudgetError("access_denied");
      }

      const category = await executor.queryRow<{ id: string }>`
        SELECT id FROM budget_categories
        WHERE organisation_id = ${authorisation.organisationId}
          AND id = ${categoryId}
          AND status = 'active'
      `;
      if (!category) throw new CentreBudgetError("invalid_input");

      const existing = await executor.queryRow<{ id: string }>`
        SELECT id FROM centre_budget_actuals
        WHERE organisation_id = ${authorisation.organisationId}
          AND centre_id = ${centreId}
          AND category_id = ${categoryId}
          AND period_month = ${monthKey}::date
          AND superseded_at IS NULL
        FOR UPDATE
      `;

      const actualId = randomUUID();
      // Supersede before inserting, so the "one current row" partial unique
      // index is never momentarily violated. The self-referencing foreign key
      // is deferred, which is what lets the pointer name a row inserted next.
      if (existing) {
        await executor.exec`
          UPDATE centre_budget_actuals
          SET superseded_at = ${decisionAt}, superseded_by_id = ${actualId}
          WHERE organisation_id = ${authorisation.organisationId} AND id = ${existing.id}
        `;
      }

      await executor.exec`
        INSERT INTO centre_budget_actuals (
          id, organisation_id, centre_id, category_id, period_month,
          amount, currency_code, source_kind, note,
          entered_by_principal_id, entered_at,
          confirmed_at, confirmed_by_principal_id
        ) VALUES (
          ${actualId}, ${authorisation.organisationId}, ${centreId}, ${categoryId},
          ${monthKey}::date, ${amount}::numeric, ${currency}, 'manual_entry',
          ${note ?? null}, ${principalId}, ${decisionAt},
          ${confirmed ? decisionAt : null}, ${confirmed ? principalId : null}
        )
      `;

      await recordAuditEventWithExecutor(transaction, {
        organisationId: authorisation.organisationId,
        actorPrincipalId: principalId,
        action: existing ? "budget_actual.superseded" : "budget_actual.recorded",
        resourceType: "centre_budget_actual",
        resourceId: actualId,
        scopeType: "centre",
        scopeId: centreId,
        // The amount itself stays out of the audit context: SECURITY.md
        // requires finance detail to be minimised in logs and audit payloads.
        // The immutable domain row holds the value and its attribution.
        context: {
          periodMonth: monthKey,
          categoryId,
          sourceKind: "manual_entry",
          supersededActualId: existing?.id ?? null,
          noteRecorded: note !== undefined,
          confirmed,
        },
        occurredAt: decisionAt,
      });

      const categories = await loadCategories(executor, authorisation.organisationId);
      const policy = await loadGoverningThresholdPolicy(
        executor,
        authorisation.organisationId,
        monthKey,
      );
      const rows = await loadPositionRows(
        executor,
        authorisation.organisationId,
        [centreId],
        monthKey,
        policy?.id ?? null,
      );
      const descriptor = categories.find(
        (candidate) => candidate.categoryId === categoryId,
      );
      if (!descriptor) throw new CentreBudgetError("context_unavailable");

      const row = rows.find((candidate) => candidate.category_id === categoryId);
      const result: RecordCentreBudgetActualResponse = {
        cacheControl: "private, no-store",
        asOf: decisionAt.toISOString(),
        month: input.request.month,
        centreId,
        position: positionFor(descriptor, row, policy?.context),
        ...(existing ? { supersededActualId: existing.id } : {}),
      };
      return result;
    });
    return { response, diagnostics: { queryCount } };
  } catch (error) {
    if (error instanceof CentreBudgetError) throw error;
    if (error instanceof CentreBudgetPositionError) {
      throw new CentreBudgetError("context_unavailable", { cause: error });
    }
    console.error("Centre Budgets entry failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new CentreBudgetError("context_unavailable", { cause: error });
  }
}
