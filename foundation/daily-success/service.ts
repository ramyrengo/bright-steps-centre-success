import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { FOUNDATION_CAPABILITIES, type FoundationCapability } from "../authorization/capabilities";
import { loadOrganisationCentreAuthorisationFacts } from "../authorization/batch-centres";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import { authorise, type PrincipalAuthorisationContext } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { deriveWorkspaceLinks } from "../navigation/workspace-links";
import type {
  DailySourceHealth,
  DailySuccessPerspective,
  DailySuccessPerspectiveKind,
  DailySuccessRequest,
  DailySuccessResponse,
  DailyWorkspaceLink,
} from "./contracts";
import { CorrectiveActionDailySource } from "./corrective-action-source";
import { PeopleAccessDailySource } from "./people-access-source";
import { OperationalCheckDailySource } from "./operational-check-source";
import { buildCentreAttention, buildSections, sortDailyItems } from "./priority";
import { QuarterlyReviewDailySource } from "./quarterly-review-source";
import { businessDateContext, requireIanaTimezone } from "./time";
import type {
  DailyAuthorisationView,
  DailySourceInput,
  DailySourceResult,
  DailySuccessDiagnostics,
  DailySuccessQueryExecutor,
} from "./types";
import { isKnownSourceAvailabilityFailure } from "./types";

const DAILY_CENTRE_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.correctiveActionRead,
  FOUNDATION_CAPABILITIES.correctiveActionRemediate,
  FOUNDATION_CAPABILITIES.correctiveActionVerify,
  FOUNDATION_CAPABILITIES.quarterlyAuditRead,
  FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
  FOUNDATION_CAPABILITIES.quarterlyAuditFinalise,
  FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge,
  FOUNDATION_CAPABILITIES.operationalCheckRead,
  FOUNDATION_CAPABILITIES.operationalCheckComplete,
] as const;

const DAILY_ORGANISATION_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.complianceOversightRead,
  FOUNDATION_CAPABILITIES.invitationRead,
  FOUNDATION_CAPABILITIES.invitationManage,
  FOUNDATION_CAPABILITIES.privilegedAccessApprove,
  FOUNDATION_CAPABILITIES.principalRead,
] as const;

interface PrincipalRow {
  id: string;
  status: "pending" | "active" | "suspended" | "revoked";
}

interface OrganisationRow {
  id: string;
  name: string;
  default_timezone: string;
}

export class DailySuccessError extends Error {
  constructor(
    readonly code: "access_denied" | "context_unavailable" | "centre_context_unavailable",
    options?: ErrorOptions,
  ) {
    super(`Daily Success unavailable: ${code}`, options);
    this.name = "DailySuccessError";
  }
}

export interface DailySuccessDependencies {
  now: () => Date;
  correctiveActionSource: typeof CorrectiveActionDailySource;
  quarterlyReviewSource: typeof QuarterlyReviewDailySource;
  peopleAccessSource: typeof PeopleAccessDailySource;
  operationalCheckSource?: typeof OperationalCheckDailySource;
}

const runtimeDependencies: DailySuccessDependencies = {
  now: () => new Date(),
  correctiveActionSource: CorrectiveActionDailySource,
  quarterlyReviewSource: QuarterlyReviewDailySource,
  peopleAccessSource: PeopleAccessDailySource,
  operationalCheckSource: OperationalCheckDailySource,
};

function countedExecutor(transaction: Transaction, onQuery: () => void): DailySuccessQueryExecutor {
  return {
    queryAll: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryAll(strings, ...values);
    }) as DailySuccessQueryExecutor["queryAll"],
    queryRow: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryRow(strings, ...values);
    }) as DailySuccessQueryExecutor["queryRow"],
    exec: async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      await transaction.exec(strings, ...values);
    },
  };
}

function capabilitySet(
  context: PrincipalAuthorisationContext,
  organisationId: string,
  at: Date,
): Set<FoundationCapability> {
  return new Set(
    DAILY_ORGANISATION_CAPABILITIES.filter((capability) =>
      authorise({
        context,
        capability,
        resource: { kind: "organisation", organisationId },
        at,
      }).allowed,
    ),
  );
}

function buildPerspectives(
  authorisation: DailyAuthorisationView,
): DailySuccessPerspective[] {
  const remediate = authorisation.centreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.correctiveActionRemediate,
  ) ?? new Set<string>();
  const acknowledge = authorisation.centreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge,
  ) ?? new Set<string>();
  // Centre Standards authority enriches an already-authorised Daily Success
  // perspective; it does not create broad Educator access to Daily Success.
  // Educators enter through /standards.
  const centreIds = new Set([...remediate, ...acknowledge]);
  const perspectives: DailySuccessPerspective[] = authorisation.centres
    .filter((centre) => centreIds.has(centre.id))
    .map((centre) => ({
      kind: "centre",
      label: centre.name,
      centreId: centre.id,
      centreName: centre.name,
    }));
  const conduct = authorisation.centreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
  ) ?? new Set<string>();
  const verify = authorisation.centreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.correctiveActionVerify,
  ) ?? new Set<string>();
  const invalidConduct = authorisation.invalidCentreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
  ) ?? new Set<string>();
  const invalidVerify = authorisation.invalidCentreIdsByCapability.get(
    FOUNDATION_CAPABILITIES.correctiveActionVerify,
  ) ?? new Set<string>();
  if (conduct.size > 0 || verify.size > 0 || invalidConduct.size > 0 || invalidVerify.size > 0) {
    perspectives.push({ kind: "portfolio", label: "Area Manager portfolio" });
  }
  if (
    authorisation.organisationCapabilities.has(
      FOUNDATION_CAPABILITIES.complianceOversightRead,
    )
  ) {
    perspectives.push({ kind: "compliance", label: "Compliance exceptions" });
  }
  if (
    authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.invitationRead) &&
    (
      authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.invitationManage) ||
      authorisation.organisationCapabilities.has(
        FOUNDATION_CAPABILITIES.privilegedAccessApprove,
      )
    )
  ) {
    perspectives.push({ kind: "administration", label: "People & Access administration" });
  }
  return perspectives;
}

function selectPerspective(
  request: DailySuccessRequest,
  available: readonly DailySuccessPerspective[],
): DailySuccessPerspective | undefined {
  if (!request.perspective) return available.length === 1 ? available[0] : undefined;
  const kind = request.perspective as DailySuccessPerspectiveKind;
  const match = available.find((candidate) =>
    candidate.kind === kind &&
    (kind !== "centre" || candidate.centreId === request.centreId),
  );
  if (!match) throw new DailySuccessError("access_denied");
  return match;
}

/**
 * Delegates to the one shared derivation so Daily Success and the `/navigation`
 * projection can never offer different destinations for the same principal.
 */
function workspaceLinks(authorisation: DailyAuthorisationView): DailyWorkspaceLink[] {
  return deriveWorkspaceLinks(authorisation);
}

async function collectWithSavepoint(
  executor: DailySuccessQueryExecutor,
  savepoint: "daily_corrective" | "daily_quarterly" | "daily_people" | "daily_operational",
  collect: () => Promise<DailySourceResult>,
): Promise<{ result?: DailySourceResult; durationMs: number }> {
  const started = performance.now();
  if (savepoint === "daily_corrective") await executor.exec`SAVEPOINT daily_corrective`;
  if (savepoint === "daily_quarterly") await executor.exec`SAVEPOINT daily_quarterly`;
  if (savepoint === "daily_people") await executor.exec`SAVEPOINT daily_people`;
  if (savepoint === "daily_operational") await executor.exec`SAVEPOINT daily_operational`;
  try {
    const result = await collect();
    if (savepoint === "daily_corrective") await executor.exec`RELEASE SAVEPOINT daily_corrective`;
    if (savepoint === "daily_quarterly") await executor.exec`RELEASE SAVEPOINT daily_quarterly`;
    if (savepoint === "daily_people") await executor.exec`RELEASE SAVEPOINT daily_people`;
    if (savepoint === "daily_operational") await executor.exec`RELEASE SAVEPOINT daily_operational`;
    return { result, durationMs: performance.now() - started };
  } catch (error) {
    if (savepoint === "daily_corrective") {
      await executor.exec`ROLLBACK TO SAVEPOINT daily_corrective`;
      await executor.exec`RELEASE SAVEPOINT daily_corrective`;
    }
    if (savepoint === "daily_quarterly") {
      await executor.exec`ROLLBACK TO SAVEPOINT daily_quarterly`;
      await executor.exec`RELEASE SAVEPOINT daily_quarterly`;
    }
    if (savepoint === "daily_people") {
      await executor.exec`ROLLBACK TO SAVEPOINT daily_people`;
      await executor.exec`RELEASE SAVEPOINT daily_people`;
    }
    if (savepoint === "daily_operational") {
      await executor.exec`ROLLBACK TO SAVEPOINT daily_operational`;
      await executor.exec`RELEASE SAVEPOINT daily_operational`;
    }
    if (!isKnownSourceAvailabilityFailure(error)) throw error;
    console.warn("Daily Success source temporarily unavailable", { source: savepoint });
    return { durationMs: performance.now() - started };
  }
}

export interface BuildDailySuccessInput {
  principalId: string;
  request: DailySuccessRequest;
}

export interface BuildDailySuccessResult {
  response: DailySuccessResponse;
  diagnostics: DailySuccessDiagnostics;
}

export async function buildDailySuccess(
  input: BuildDailySuccessInput,
  dependencies: DailySuccessDependencies = runtimeDependencies,
): Promise<BuildDailySuccessResult> {
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => { queryCount += 1; });
  const decisionAt = dependencies.now();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await executor.queryRow<PrincipalRow>`
      SELECT id, status FROM principals WHERE id = ${input.principalId}
    `;
    if (!principal || principal.status !== "active") throw new DailySuccessError("access_denied");
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
    if (organisations.length !== 1) throw new DailySuccessError("access_denied");
    const organisation = organisations[0];
    requireIanaTimezone(organisation.default_timezone);
    const context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
      principalId: principal.id,
      activeOrganisationId: organisation.id,
      at: decisionAt,
    });
    const centreFacts = await loadOrganisationCentreAuthorisationFacts(
      executor,
      organisation.id,
      decisionAt,
    );
    const centres = centreFacts.centres;
    const centreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
    const invalidCentreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
    for (const requiredCapability of DAILY_CENTRE_CAPABILITIES) {
      centreIdsByCapability.set(
        requiredCapability,
        new Set(
          centres
            .filter((centre) =>
              authorise({
                context,
                capability: requiredCapability,
                resource: centre.resource,
                at: decisionAt,
              }).allowed,
            )
            .map((centre) => centre.id),
        ),
      );
      invalidCentreIdsByCapability.set(
        requiredCapability,
        new Set(
          centreFacts.invalidCentres
            .filter((centre) =>
              authorise({
                context,
                capability: requiredCapability,
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
    const authorisation: DailyAuthorisationView = {
      principalId: principal.id,
      organisationId: organisation.id,
      decisionAt,
      centres,
      centreIdsByCapability,
      invalidCentreIdsByCapability,
      organisationCapabilities: capabilitySet(context, organisation.id, decisionAt),
    };
    const requestedInvalidCentre = input.request.centreId && [
      FOUNDATION_CAPABILITIES.correctiveActionRemediate,
      FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge,
    ].some((requiredCapability) =>
      invalidCentreIdsByCapability.get(requiredCapability)?.has(input.request.centreId!),
    );
    if (requestedInvalidCentre) throw new DailySuccessError("centre_context_unavailable");
    const availablePerspectives = buildPerspectives(authorisation);
    const onlyInvalidCentrePerspective = availablePerspectives.length === 0 && [
      FOUNDATION_CAPABILITIES.correctiveActionRemediate,
      FOUNDATION_CAPABILITIES.quarterlyAuditAcknowledge,
    ].some((requiredCapability) =>
      (invalidCentreIdsByCapability.get(requiredCapability)?.size ?? 0) > 0,
    );
    if (!input.request.perspective && onlyInvalidCentrePerspective) {
      throw new DailySuccessError("centre_context_unavailable");
    }
    const activePerspective = selectPerspective(input.request, availablePerspectives);
    const base = {
      cacheControl: "private, no-store" as const,
      asOf: decisionAt.toISOString(),
      availablePerspectives,
      businessDates: [
        businessDateContext("organisation", organisation.id, organisation.default_timezone, decisionAt),
      ],
      sections: [],
      attentionCentres: [],
      verificationItems: [],
      aggregateCounts: { coverage: "complete" as const, active: 0, urgent: 0, dueToday: 0, waiting: 0, distinctCentres: 0 },
      sourceHealth: [
        { source: "corrective_actions", status: "not_applicable" },
        { source: "quarterly_reviews", status: "not_applicable" },
        { source: "people_access", status: "not_applicable" },
        { source: "operational_checks", status: "not_applicable" },
      ] as DailySourceHealth[],
      authorisationHealth: { status: "available" as const },
      workspaceLinks: workspaceLinks(authorisation),
    };
    if (!activePerspective) {
      await transaction.commit();
      return {
        response: {
          ...base,
          status: availablePerspectives.length === 0 ? "unsupported" : "selection_required",
        },
        diagnostics: { queryCount, sourceDurationsMs: {} },
      };
    }

    const timezoneCentreIds = activePerspective.kind === "centre" && activePerspective.centreId
      ? new Set([activePerspective.centreId])
      : activePerspective.kind === "portfolio"
        ? new Set([
            ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.quarterlyAuditConduct) ?? []),
            ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.correctiveActionVerify) ?? []),
          ])
        : activePerspective.kind === "compliance"
          ? new Set(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.correctiveActionRead) ?? [])
          : new Set<string>();
    for (const centre of centres) {
      if (timezoneCentreIds.has(centre.id)) requireIanaTimezone(centre.timezone);
    }

    const sourceInput: DailySourceInput = { executor, authorisation, perspective: activePerspective };
    const operationalCentreIds = new Set([
      ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.operationalCheckRead) ?? []),
      ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.operationalCheckComplete) ?? []),
    ]);
    const hasRelevantOperationalAuthority = activePerspective.kind === "centre"
      ? Boolean(activePerspective.centreId && operationalCentreIds.has(activePerspective.centreId))
      : operationalCentreIds.size > 0;
    const relevant = {
      corrective: activePerspective.kind !== "administration",
      quarterly: activePerspective.kind === "centre" || activePerspective.kind === "portfolio",
      people: activePerspective.kind === "administration",
      operational: activePerspective.kind !== "administration" && hasRelevantOperationalAuthority,
    };
    const sourceDurationsMs: Record<string, number> = {};
    const results: DailySourceResult[] = [];
    const health: DailySourceHealth[] = [];
    if (relevant.corrective) {
      const collected = await collectWithSavepoint(executor, "daily_corrective", () =>
        dependencies.correctiveActionSource.collect(sourceInput));
      sourceDurationsMs.corrective_actions = collected.durationMs;
      health.push({ source: "corrective_actions", status: collected.result ? "available" : "unavailable" });
      if (collected.result) results.push(collected.result);
    } else health.push({ source: "corrective_actions", status: "not_applicable" });
    if (relevant.quarterly) {
      const collected = await collectWithSavepoint(executor, "daily_quarterly", () =>
        dependencies.quarterlyReviewSource.collect(sourceInput));
      sourceDurationsMs.quarterly_reviews = collected.durationMs;
      health.push({ source: "quarterly_reviews", status: collected.result ? "available" : "unavailable" });
      if (collected.result) results.push(collected.result);
    } else health.push({ source: "quarterly_reviews", status: "not_applicable" });
    if (relevant.people) {
      const collected = await collectWithSavepoint(executor, "daily_people", () =>
        dependencies.peopleAccessSource.collect(sourceInput));
      sourceDurationsMs.people_access = collected.durationMs;
      health.push({ source: "people_access", status: collected.result ? "available" : "unavailable" });
      if (collected.result) results.push(collected.result);
    } else health.push({ source: "people_access", status: "not_applicable" });
    if (relevant.operational) {
      const collected = await collectWithSavepoint(executor, "daily_operational", () =>
        (dependencies.operationalCheckSource ?? OperationalCheckDailySource).collect(sourceInput));
      sourceDurationsMs.operational_checks = collected.durationMs;
      health.push({ source: "operational_checks", status: collected.result ? "available" : "unavailable" });
      if (collected.result) results.push(collected.result);
    } else health.push({ source: "operational_checks", status: "not_applicable" });

    const unavailable = health.some((source) => source.status === "unavailable");
    const authorisationPartial = activePerspective.kind === "portfolio"
      ? [
          FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
          FOUNDATION_CAPABILITIES.correctiveActionVerify,
        ].some((requiredCapability) =>
          (invalidCentreIdsByCapability.get(requiredCapability)?.size ?? 0) > 0,
        )
      : activePerspective.kind === "compliance"
        ? (invalidCentreIdsByCapability.get(FOUNDATION_CAPABILITIES.correctiveActionRead)?.size ?? 0) > 0
        : false;
    const partial = unavailable || authorisationPartial;
    const allItems = sortDailyItems(results.flatMap((result) => result.items));
    let items = allItems;
    if (activePerspective.kind === "compliance" || activePerspective.kind === "administration") {
      items = items.slice(0, 5);
    }
    const centreIds = new Set(allItems.flatMap((item) => item.centreId ? [item.centreId] : []));
    const completedTodayTitles = results.flatMap((result) => result.completedTodayTitles).slice(0, 3);
    const businessDates = [...base.businessDates];
    if (activePerspective.kind === "centre" && activePerspective.centreId) {
      const centre = centres.find((candidate) => candidate.id === activePerspective.centreId)!;
      businessDates.push(businessDateContext("centre", centre.id, centre.timezone, decisionAt));
    }
    const portfolioCentreIds = new Set([
      ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.quarterlyAuditConduct) ?? []),
      ...(centreIdsByCapability.get(FOUNDATION_CAPABILITIES.correctiveActionVerify) ?? []),
    ]);
    const positiveContext = {
      completedTodayCount: results.reduce((total, result) => total + result.completedTodayCount, 0),
      recentTitles: completedTodayTitles,
      ...(!partial && activePerspective.kind === "portfolio"
        ? { onTrackCentreCount: Math.max(0, portfolioCentreIds.size - centreIds.size) }
        : {}),
    };
    const response: DailySuccessResponse = {
      cacheControl: "private, no-store",
      asOf: decisionAt.toISOString(),
      status: partial ? "partial" : "ready",
      activePerspective,
      availablePerspectives,
      businessDates,
      sections: buildSections(items),
      attentionCentres: activePerspective.kind === "portfolio"
        ? buildCentreAttention(items, {
            candidateCentres: centres.filter((centre) => portfolioCentreIds.has(centre.id)),
            coverage: partial ? "partial" : "complete",
          })
        : [],
      verificationItems: activePerspective.kind === "portfolio" || activePerspective.kind === "compliance"
        ? sortDailyItems(allItems.filter((item) => item.verification?.eligible === true)).slice(0, 5)
        : [],
      aggregateCounts: partial
        ? { coverage: "partial" }
        : {
            coverage: "complete",
            active: allItems.length,
            urgent: allItems.filter((item) => item.attentionBand === "URGENT").length,
            dueToday: allItems.filter((item) => item.due?.bucket === "TODAY").length,
            waiting: allItems.filter((item) => item.attentionBand === "WAITING").length,
            distinctCentres: centreIds.size,
          },
      ...(!partial ? { positiveContext } : {}),
      sourceHealth: health,
      authorisationHealth: authorisationPartial
        ? { status: "partial", warning: "Some centre priorities could not be authorised safely." }
        : { status: "available" },
      ...(partial ? { warning: "Some priorities could not be checked." } : {}),
      workspaceLinks: workspaceLinks(authorisation),
    };
    await transaction.commit();
    return { response, diagnostics: { queryCount, sourceDurationsMs } };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof DailySuccessError) throw error;
    console.error("Daily Success request failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new DailySuccessError("context_unavailable", { cause: error });
  }
}
