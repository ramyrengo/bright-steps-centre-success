import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { loadOrganisationCentreAuthorisationFacts } from "../authorization/batch-centres";
import { FOUNDATION_CAPABILITIES, type FoundationCapability } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import { authorise, type PrincipalAuthorisationContext } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { localDateKey, requireIanaTimezone } from "../daily-success/time";
import {
  aggregateByCentre,
  emptyRollup,
  responsibilityContext,
  QualityActionSource,
  type CentreActionAggregate,
} from "./action-source";
import type {
  CentreQualityDetailResponse,
  CentreQualityView,
  CentreQualityViewKind,
  CentreQualityWorkspaceRequest,
  CentreQualityWorkspaceResponse,
  QualityCentreCard,
  QualityPortfolioSummary,
  QualityReviewSummary,
  QualitySourceHealth,
} from "./contracts";
import { buildComparison, buildFocusGroups, deriveFocus, sortCentreCards } from "./focus";
import { QualityReviewSource } from "./review-source";
import {
  isKnownQualitySourceFailure,
  type CentreQualityAuthorisationView,
  type CentreQualityDiagnostics,
  type CentreQualityQueryExecutor,
} from "./types";

/** Capabilities evaluated per centre. Every one already exists in the foundation. */
const QUALITY_CENTRE_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.quarterlyAuditRead,
  FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge,
  FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
  FOUNDATION_CAPABILITIES.findingRead,
  FOUNDATION_CAPABILITIES.correctiveActionRead,
  FOUNDATION_CAPABILITIES.correctiveActionRemediate,
  FOUNDATION_CAPABILITIES.correctiveActionVerify,
] as const;

const QUALITY_ORGANISATION_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.complianceOversightRead,
] as const;

const REVIEW_HISTORY_LIMIT = 4;
const DETAIL_LIST_LIMIT = 25;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CentreQualityError extends Error {
  constructor(
    readonly code: "access_denied" | "context_unavailable" | "centre_context_unavailable",
    options?: ErrorOptions,
  ) {
    super(`Centre Quality unavailable: ${code}`, options);
    this.name = "CentreQualityError";
  }
}

interface PrincipalRow {
  id: string;
  status: "pending" | "active" | "suspended" | "revoked";
}

interface OrganisationRow {
  id: string;
  name: string;
  default_timezone: string;
}

export interface CentreQualityDependencies {
  now: () => Date;
}

const runtimeDependencies: CentreQualityDependencies = { now: () => new Date() };

function countedExecutor(
  transaction: Transaction,
  onQuery: () => void,
): CentreQualityQueryExecutor {
  return {
    queryAll: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryAll(strings, ...values);
    }) as CentreQualityQueryExecutor["queryAll"],
    queryRow: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryRow(strings, ...values);
    }) as CentreQualityQueryExecutor["queryRow"],
    exec: async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      await transaction.exec(strings, ...values);
    },
  };
}

function ids(
  authorisation: CentreQualityAuthorisationView,
  capability: FoundationCapability,
): ReadonlySet<string> {
  return authorisation.centreIdsByCapability.get(capability) ?? new Set<string>();
}

/**
 * Builds the authorised view once per request. Centre facts and the principal
 * context are loaded set-wise; capability evaluation is pure and in memory, so
 * no per-centre database authorizer call is made.
 */
async function loadAuthorisation(
  executor: CentreQualityQueryExecutor,
  principalId: string,
  decisionAt: Date,
): Promise<CentreQualityAuthorisationView> {
  const principal = await executor.queryRow<PrincipalRow>`
    SELECT id, status FROM principals WHERE id = ${principalId}
  `;
  if (!principal || principal.status !== "active") {
    throw new CentreQualityError("access_denied");
  }
  const organisations = await executor.queryAll<OrganisationRow>`
    SELECT DISTINCT organisation.id, organisation.name, organisation.default_timezone
    FROM organisation_memberships AS membership
    JOIN organisations AS organisation ON organisation.id = membership.organisation_id
    WHERE membership.principal_id = ${principal.id}
      AND membership.status = 'active'
      AND membership.effective_from <= ${decisionAt}
      AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
      AND organisation.status = 'active'
    ORDER BY organisation.id
  `;
  if (organisations.length !== 1) throw new CentreQualityError("access_denied");
  const organisation = organisations[0];
  requireIanaTimezone(organisation.default_timezone);

  const context: PrincipalAuthorisationContext =
    await loadPrincipalAuthorisationContextFromSnapshot(executor, {
      principalId: principal.id,
      activeOrganisationId: organisation.id,
      at: decisionAt,
    });
  const centreFacts = await loadOrganisationCentreAuthorisationFacts(
    executor,
    organisation.id,
    decisionAt,
  );

  const centreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
  const invalidCentreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
  for (const required of QUALITY_CENTRE_CAPABILITIES) {
    centreIdsByCapability.set(
      required,
      new Set(
        centreFacts.centres
          .filter((centre) =>
            authorise({ context, capability: required, resource: centre.resource, at: decisionAt })
              .allowed,
          )
          .map((centre) => centre.id),
      ),
    );
    invalidCentreIdsByCapability.set(
      required,
      new Set(
        centreFacts.invalidCentres
          .filter((centre) =>
            authorise({
              context,
              capability: required,
              resource: {
                kind: "centre",
                organisationId: organisation.id,
                centreId: centre.id,
                organisationalUnitIds: centre.organisationalUnitIds,
              },
              at: decisionAt,
            }).allowed,
          )
          .map((centre) => centre.id),
      ),
    );
  }

  return {
    principalId: principal.id,
    organisationId: organisation.id,
    organisationName: organisation.name,
    organisationTimezone: organisation.default_timezone,
    decisionAt,
    centres: centreFacts.centres,
    centreIdsByCapability,
    invalidCentreIdsByCapability,
    organisationCapabilities: new Set(
      QUALITY_ORGANISATION_CAPABILITIES.filter(
        (capability) =>
          authorise({
            context,
            capability,
            resource: { kind: "organisation", organisationId: organisation.id },
            at: decisionAt,
          }).allowed,
      ),
    ),
  };
}

/**
 * A Centre Director view exists only where the principal can both read the
 * quality facts and act on them for that centre. Technical administration
 * alone produces no view at all.
 */
function buildViews(authorisation: CentreQualityAuthorisationView): CentreQualityView[] {
  const views: CentreQualityView[] = [];
  const read = ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRead);
  const auditRead = ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditRead);
  const remediate = ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRemediate);
  const acknowledge = ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge);
  const conduct = ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditConduct);
  const verify = ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionVerify);

  for (const centre of authorisation.centres) {
    const responsible = remediate.has(centre.id) || acknowledge.has(centre.id);
    const readable = read.has(centre.id) || auditRead.has(centre.id);
    if (responsible && readable) {
      views.push({
        kind: "centre",
        label: centre.name,
        centreId: centre.id,
        centreName: centre.name,
      });
    }
  }
  if (conduct.size > 0 || verify.size > 0) {
    views.push({ kind: "portfolio", label: "Area Manager portfolio" });
  }
  if (
    authorisation.organisationCapabilities.has(
      FOUNDATION_CAPABILITIES.complianceOversightRead,
    )
  ) {
    views.push({ kind: "organisation", label: "Organisation quality oversight" });
  }
  return views;
}

function selectView(
  request: CentreQualityWorkspaceRequest,
  available: readonly CentreQualityView[],
): CentreQualityView | undefined {
  if (!request.view) return available.length === 1 ? available[0] : undefined;
  const kind = request.view as CentreQualityViewKind;
  const match = available.find(
    (candidate) =>
      candidate.kind === kind &&
      (kind !== "centre" || candidate.centreId === request.centreId),
  );
  if (!match) throw new CentreQualityError("access_denied");
  return match;
}

/** The centres a view covers, before per-source capability narrowing. */
function scopeCentreIds(
  authorisation: CentreQualityAuthorisationView,
  view: CentreQualityView,
): Set<string> {
  if (view.kind === "centre") return new Set(view.centreId ? [view.centreId] : []);
  if (view.kind === "portfolio") {
    return new Set([
      ...ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditConduct),
      ...ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionVerify),
    ]);
  }
  return new Set([
    ...ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRead),
    ...ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditRead),
  ]);
}

function intersect(scope: ReadonlySet<string>, allowed: ReadonlySet<string>): string[] {
  return [...scope].filter((id) => allowed.has(id)).sort();
}

async function withSavepoint<T>(
  executor: CentreQualityQueryExecutor,
  source: QualitySourceHealth["source"],
  collect: () => Promise<T>,
): Promise<{ value?: T; durationMs: number }> {
  const started = performance.now();
  if (source === "quarterly_reviews") await executor.exec`SAVEPOINT quality_reviews`;
  else await executor.exec`SAVEPOINT quality_actions`;
  try {
    const value = await collect();
    if (source === "quarterly_reviews") await executor.exec`RELEASE SAVEPOINT quality_reviews`;
    else await executor.exec`RELEASE SAVEPOINT quality_actions`;
    return { value, durationMs: performance.now() - started };
  } catch (error) {
    if (source === "quarterly_reviews") {
      await executor.exec`ROLLBACK TO SAVEPOINT quality_reviews`;
      await executor.exec`RELEASE SAVEPOINT quality_reviews`;
    } else {
      await executor.exec`ROLLBACK TO SAVEPOINT quality_actions`;
      await executor.exec`RELEASE SAVEPOINT quality_actions`;
    }
    if (!isKnownQualitySourceFailure(error)) throw error;
    console.warn("Centre Quality source temporarily unavailable", { source });
    return { durationMs: performance.now() - started };
  }
}

interface CardInput {
  authorisation: CentreQualityAuthorisationView;
  reviewsByCentre: Map<string, QualityReviewSummary[]>;
  aggregates: Map<string, CentreActionAggregate>;
  centreIds: readonly string[];
}

function buildCards(input: CardInput): QualityCentreCard[] {
  const cards: QualityCentreCard[] = [];
  for (const centre of input.authorisation.centres) {
    if (!input.centreIds.includes(centre.id)) continue;
    const reviews = input.reviewsByCentre.get(centre.id) ?? [];
    const latestReview = reviews[0];
    const aggregate = input.aggregates.get(centre.id);
    const actions = aggregate?.rollup ?? emptyRollup();
    const uncoveredCriticalFindings = aggregate?.uncoveredCriticalFindings ?? 0;
    const { focus, reason } = deriveFocus({ actions, uncoveredCriticalFindings, latestReview });
    cards.push({
      centreId: centre.id,
      centreName: centre.name,
      timezone: centre.timezone,
      localDate: localDateKey(input.authorisation.decisionAt, centre.timezone),
      focus,
      focusReason: reason,
      ...(latestReview ? { latestReview } : {}),
      comparison: buildComparison(latestReview, reviews[1]),
      actions,
      uncoveredCriticalFindings,
      strengthsCount: latestReview?.positivePracticeCount ?? 0,
      completedLast30Days: aggregate?.completedLast30Days ?? 0,
      cta: {
        label: "Open centre quality",
        route: `/quality/centres/${centre.id}`,
      },
    });
  }
  return sortCentreCards(cards);
}

function summarise(
  cards: readonly QualityCentreCard[],
  partial: boolean,
): QualityPortfolioSummary {
  if (partial) return { coverage: "partial" };
  return {
    coverage: "complete",
    centreCount: cards.length,
    needsSupportCount: cards.filter((card) => card.focus === "NEEDS_SUPPORT").length,
    monitorCount: cards.filter((card) => card.focus === "MONITOR").length,
    steadyCount: cards.filter((card) => card.focus === "STEADY").length,
    awaitingFirstReviewCount: cards.filter(
      (card) => card.focus === "AWAITING_FIRST_REVIEW",
    ).length,
    openCriticalCount: cards.reduce(
      (total, card) => total + card.actions.critical + card.uncoveredCriticalFindings,
      0,
    ),
    overdueCount: cards.reduce((total, card) => total + card.actions.overdue, 0),
    awaitingVerificationCount: cards.reduce(
      (total, card) => total + card.actions.awaitingVerification,
      0,
    ),
  };
}

export interface BuildCentreQualityResult<T> {
  response: T;
  diagnostics: CentreQualityDiagnostics;
}

export async function buildCentreQualityWorkspace(
  input: { principalId: string; request: CentreQualityWorkspaceRequest },
  dependencies: CentreQualityDependencies = runtimeDependencies,
): Promise<BuildCentreQualityResult<CentreQualityWorkspaceResponse>> {
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => { queryCount += 1; });
  const decisionAt = dependencies.now();
  const sourceDurationsMs: Record<string, number> = {};
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const authorisation = await loadAuthorisation(executor, input.principalId, decisionAt);
    const availableViews = buildViews(authorisation);

    if (input.request.centreId && !CANONICAL_UUID.test(input.request.centreId)) {
      throw new CentreQualityError("access_denied");
    }
    const activeView = selectView(input.request, availableViews);
    const base = {
      cacheControl: "private, no-store" as const,
      asOf: decisionAt.toISOString(),
      availableViews,
      organisationTimezone: authorisation.organisationTimezone,
      centres: [] as QualityCentreCard[],
      focusGroups: [],
      summary: { coverage: "complete" as const, centreCount: 0 },
      sourceHealth: [
        { source: "quarterly_reviews", status: "available" },
        { source: "corrective_actions", status: "available" },
      ] as QualitySourceHealth[],
      authorisationHealth: { status: "available" as const },
    };
    if (!activeView) {
      await transaction.commit();
      return {
        response: {
          ...base,
          status: availableViews.length === 0 ? "unsupported" : "selection_required",
        },
        diagnostics: { queryCount, sourceDurationsMs },
      };
    }

    const scope = scopeCentreIds(authorisation, activeView);
    for (const centre of authorisation.centres) {
      if (scope.has(centre.id)) requireIanaTimezone(centre.timezone);
    }
    const reviewCentreIds = intersect(
      scope,
      ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditRead),
    );
    const actionCentreIds = intersect(
      scope,
      ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRead),
    );
    const findingCentreIds = intersect(
      scope,
      ids(authorisation, FOUNDATION_CAPABILITIES.findingRead),
    );

    const reviewResult = await withSavepoint(executor, "quarterly_reviews", () =>
      QualityReviewSource.finalisedReviews(executor, authorisation, reviewCentreIds, 2),
    );
    sourceDurationsMs.quarterly_reviews = reviewResult.durationMs;
    const actionResult = await withSavepoint(executor, "corrective_actions", () =>
      QualityActionSource.load(executor, authorisation, actionCentreIds, findingCentreIds),
    );
    sourceDurationsMs.corrective_actions = actionResult.durationMs;

    const timezoneByCentreId = new Map(
      authorisation.centres.map((centre) => [centre.id, centre.timezone] as const),
    );
    const aggregates = actionResult.value
      ? aggregateByCentre(actionResult.value, {
          decisionAt,
          timezoneByCentreId,
          responsibility: responsibilityContext(authorisation),
        })
      : new Map<string, CentreActionAggregate>();

    const cards = buildCards({
      authorisation,
      reviewsByCentre: reviewResult.value ?? new Map(),
      aggregates,
      centreIds: [...scope],
    });

    const sourceHealth: QualitySourceHealth[] = [
      { source: "quarterly_reviews", status: reviewResult.value ? "available" : "unavailable" },
      { source: "corrective_actions", status: actionResult.value ? "available" : "unavailable" },
    ];
    const authorisationPartial = [...QUALITY_CENTRE_CAPABILITIES].some(
      (capability) =>
        (authorisation.invalidCentreIdsByCapability.get(capability)?.size ?? 0) > 0,
    );
    const partial =
      sourceHealth.some((source) => source.status === "unavailable") || authorisationPartial;

    await transaction.commit();
    return {
      response: {
        ...base,
        status: partial ? "partial" : "ready",
        activeView,
        centres: cards,
        focusGroups: buildFocusGroups(cards),
        summary: summarise(cards, partial),
        sourceHealth,
        authorisationHealth: authorisationPartial
          ? {
              status: "partial",
              warning: "Some centres could not be authorised safely and are not shown.",
            }
          : { status: "available" },
        ...(partial ? { warning: "Some quality facts could not be checked." } : {}),
      },
      diagnostics: { queryCount, sourceDurationsMs },
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CentreQualityError) throw error;
    console.error("Centre Quality request failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new CentreQualityError("context_unavailable", { cause: error });
  }
}

export async function buildCentreQualityDetail(
  input: { principalId: string; centreId: string },
  dependencies: CentreQualityDependencies = runtimeDependencies,
): Promise<BuildCentreQualityResult<CentreQualityDetailResponse>> {
  if (!CANONICAL_UUID.test(input.centreId)) throw new CentreQualityError("access_denied");
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => { queryCount += 1; });
  const decisionAt = dependencies.now();
  const sourceDurationsMs: Record<string, number> = {};
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const authorisation = await loadAuthorisation(executor, input.principalId, decisionAt);

    const invalid = [...QUALITY_CENTRE_CAPABILITIES].some((capability) =>
      authorisation.invalidCentreIdsByCapability.get(capability)?.has(input.centreId),
    );
    if (invalid) throw new CentreQualityError("centre_context_unavailable");

    const auditRead = ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditRead);
    const actionRead = ids(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRead);
    if (!auditRead.has(input.centreId) && !actionRead.has(input.centreId)) {
      throw new CentreQualityError("access_denied");
    }
    const centre = authorisation.centres.find((candidate) => candidate.id === input.centreId);
    if (!centre) throw new CentreQualityError("access_denied");
    requireIanaTimezone(centre.timezone);

    const reviewCentreIds = auditRead.has(centre.id) ? [centre.id] : [];
    const actionCentreIds = actionRead.has(centre.id) ? [centre.id] : [];
    const findingCentreIds = ids(authorisation, FOUNDATION_CAPABILITIES.findingRead).has(centre.id)
      ? [centre.id]
      : [];

    const reviewResult = await withSavepoint(executor, "quarterly_reviews", async () => ({
      history: await QualityReviewSource.finalisedReviews(
        executor,
        authorisation,
        reviewCentreIds,
        REVIEW_HISTORY_LIMIT,
      ),
      strengths: await QualityReviewSource.strengths(
        executor,
        authorisation,
        centre.id,
        DETAIL_LIST_LIMIT,
      ),
      uncovered: await QualityReviewSource.uncoveredCriticalFindings(
        executor,
        authorisation,
        centre.id,
        DETAIL_LIST_LIMIT,
      ),
    }));
    sourceDurationsMs.quarterly_reviews = reviewResult.durationMs;
    const actionResult = await withSavepoint(executor, "corrective_actions", () =>
      QualityActionSource.load(executor, authorisation, actionCentreIds, findingCentreIds),
    );
    sourceDurationsMs.corrective_actions = actionResult.durationMs;

    const aggregates = actionResult.value
      ? aggregateByCentre(actionResult.value, {
          decisionAt,
          timezoneByCentreId: new Map([[centre.id, centre.timezone]]),
          responsibility: responsibilityContext(authorisation),
        })
      : new Map<string, CentreActionAggregate>();
    const aggregate = aggregates.get(centre.id);
    const history = reviewResult.value?.history.get(centre.id) ?? [];
    const cards = buildCards({
      authorisation,
      reviewsByCentre: new Map(history.length ? [[centre.id, history]] : []),
      aggregates,
      centreIds: [centre.id],
    });

    const sourceHealth: QualitySourceHealth[] = [
      { source: "quarterly_reviews", status: reviewResult.value ? "available" : "unavailable" },
      { source: "corrective_actions", status: actionResult.value ? "available" : "unavailable" },
    ];
    const partial = sourceHealth.some((source) => source.status === "unavailable");

    await transaction.commit();
    return {
      response: {
        cacheControl: "private, no-store",
        asOf: decisionAt.toISOString(),
        status: partial ? "partial" : "ready",
        centre: cards[0],
        openActions: (aggregate?.openItems ?? []).slice(0, DETAIL_LIST_LIMIT),
        completedActions: (aggregate?.completedItems ?? []).slice(0, DETAIL_LIST_LIMIT),
        strengths: reviewResult.value?.strengths ?? [],
        uncoveredFindings: reviewResult.value?.uncovered ?? [],
        reviewHistory: history,
        canAcknowledgeReview:
          ids(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge).has(centre.id) &&
          history.length > 0 &&
          !history[0].acknowledged,
        sourceHealth,
        ...(partial ? { warning: "Some quality facts could not be checked." } : {}),
      },
      diagnostics: { queryCount, sourceDurationsMs },
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CentreQualityError) throw error;
    console.error("Centre Quality request failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new CentreQualityError("context_unavailable", { cause: error });
  }
}
