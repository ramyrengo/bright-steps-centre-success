import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { classifyDueAt } from "../daily-success/time";
import type {
  QualityActionListItem,
  QualityActionRollup,
  QualityCompletedActionItem,
} from "./contracts";
import { actionStatusLabel } from "./focus";
import type { CentreQualityAuthorisationView, CentreQualityQueryExecutor } from "./types";

export interface QualityActionRow {
  record_kind: "open" | "closed" | "uncovered_finding";
  id: string;
  centre_id: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  due_at: Date | null;
  owner_principal_id: string | null;
  remediation_submitted_by_principal_id: string | null;
  independent_verification_required: boolean;
  closed_at: Date | null;
}

export function emptyRollup(): QualityActionRollup {
  return {
    total: 0,
    critical: 0,
    overdue: 0,
    dueSoon: 0,
    awaitingVerification: 0,
    returned: 0,
    yourAction: 0,
    centreAction: 0,
    waiting: 0,
  };
}

const CLOSED_LOOKBACK_DAYS = 30;

export const QualityActionSource = {
  /**
   * Loads every currently open corrective action, every recent closure, and
   * every uncovered critical finding for the authorised centre set with one
   * set-wise query. The query cost does not grow with the number of centres.
   */
  async load(
    executor: CentreQualityQueryExecutor,
    authorisation: CentreQualityAuthorisationView,
    /** Centres the principal may currently read corrective actions for. */
    actionCentreIds: readonly string[],
    /** Centres the principal may currently read findings for. */
    findingCentreIds: readonly string[],
  ): Promise<QualityActionRow[]> {
    if (actionCentreIds.length === 0 && findingCentreIds.length === 0) return [];
    const since = new Date(
      authorisation.decisionAt.getTime() - CLOSED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    return executor.queryAll<QualityActionRow>`
      WITH open_actions AS (
        SELECT
          'open'::text AS record_kind,
          action.id,
          action.centre_id,
          action.title,
          action.severity,
          action.status,
          action.due_at,
          action.owner_principal_id,
          action.remediation_submitted_by_principal_id,
          action.independent_verification_required,
          NULL::timestamptz AS closed_at
        FROM corrective_actions AS action
        JOIN findings AS finding
          ON finding.organisation_id = action.organisation_id
         AND finding.id = action.finding_id
         AND finding.source_family = 'QUARTERLY_AUDIT'
        WHERE action.organisation_id = ${authorisation.organisationId}
          AND action.centre_id = ANY(${actionCentreIds as string[]}::uuid[])
          AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
      ),
      closed_actions AS (
        SELECT
          'closed'::text AS record_kind,
          action.id,
          action.centre_id,
          action.title,
          action.severity,
          action.status,
          action.due_at,
          action.owner_principal_id,
          action.remediation_submitted_by_principal_id,
          action.independent_verification_required,
          action.closed_at
        FROM corrective_actions AS action
        JOIN findings AS finding
          ON finding.organisation_id = action.organisation_id
         AND finding.id = action.finding_id
         AND finding.source_family = 'QUARTERLY_AUDIT'
        WHERE action.organisation_id = ${authorisation.organisationId}
          AND action.centre_id = ANY(${actionCentreIds as string[]}::uuid[])
          AND action.status = 'CLOSED'
          AND action.closed_at >= ${since}
      ),
      uncovered_findings AS (
        SELECT
          'uncovered_finding'::text AS record_kind,
          finding.id,
          finding.centre_id,
          item.wording AS title,
          finding.severity,
          'OPEN'::text AS status,
          NULL::timestamptz AS due_at,
          NULL::uuid AS owner_principal_id,
          NULL::uuid AS remediation_submitted_by_principal_id,
          FALSE AS independent_verification_required,
          NULL::timestamptz AS closed_at
        FROM findings AS finding
        JOIN audit_responses AS response
          ON response.organisation_id = finding.organisation_id
         AND response.id = finding.audit_response_id
        JOIN audit_template_items AS item
          ON item.organisation_id = response.organisation_id
         AND item.id = response.audit_item_id
        WHERE finding.organisation_id = ${authorisation.organisationId}
          AND finding.source_family = 'QUARTERLY_AUDIT'
          AND finding.centre_id = ANY(${findingCentreIds as string[]}::uuid[])
          AND finding.status = 'OPEN'
          AND finding.severity = 'CRITICAL'
          AND NOT EXISTS (
            SELECT 1
            FROM corrective_actions AS action
            WHERE action.organisation_id = finding.organisation_id
              AND action.finding_id = finding.id
              AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
          )
      )
      SELECT * FROM open_actions
      UNION ALL
      SELECT * FROM closed_actions
      UNION ALL
      SELECT * FROM uncovered_findings
      ORDER BY record_kind, centre_id, due_at NULLS LAST, id
    `;
  },
};

export interface ResponsibilityContext {
  principalId: string;
  remediateCentreIds: ReadonlySet<string>;
  verifyCentreIds: ReadonlySet<string>;
}

/**
 * Applies the same responsibility rules Daily Success already uses so a
 * corrective action never appears as the current user's work in one surface
 * and someone else's work in the other.
 */
export function responsibilityFor(
  row: QualityActionRow,
  context: ResponsibilityContext,
): QualityActionListItem["responsibility"] {
  const awaitingVerification = row.status === "VERIFICATION_REQUIRED";
  const canIndependentlyVerify =
    context.verifyCentreIds.has(row.centre_id) &&
    !(
      row.independent_verification_required &&
      row.remediation_submitted_by_principal_id === context.principalId
    );
  if (awaitingVerification) {
    return canIndependentlyVerify ? "YOU_NEED_TO_ACT" : "WAITING_ON_SOMEONE_ELSE";
  }
  const canRemediate =
    row.owner_principal_id === context.principalId &&
    context.remediateCentreIds.has(row.centre_id);
  if (canRemediate) return "YOU_NEED_TO_ACT";
  return context.remediateCentreIds.has(row.centre_id) ||
    context.verifyCentreIds.has(row.centre_id)
    ? "CENTRE_NEEDS_TO_ACT"
    : "FOR_YOUR_AWARENESS";
}

export function responsibilityContext(
  authorisation: CentreQualityAuthorisationView,
): ResponsibilityContext {
  return {
    principalId: authorisation.principalId,
    remediateCentreIds:
      authorisation.centreIdsByCapability.get(capability.correctiveActionRemediate) ??
      new Set<string>(),
    verifyCentreIds:
      authorisation.centreIdsByCapability.get(capability.correctiveActionVerify) ??
      new Set<string>(),
  };
}

export interface CentreActionAggregate {
  rollup: QualityActionRollup;
  uncoveredCriticalFindings: number;
  completedLast30Days: number;
  openItems: QualityActionListItem[];
  completedItems: QualityCompletedActionItem[];
}

/**
 * Rolls the loaded rows up per centre. Due buckets use the centre-local
 * calendar and the single request timestamp, matching the accepted Daily
 * Success due policy.
 */
export function aggregateByCentre(
  rows: readonly QualityActionRow[],
  options: {
    decisionAt: Date;
    timezoneByCentreId: ReadonlyMap<string, string>;
    responsibility: ResponsibilityContext;
  },
): Map<string, CentreActionAggregate> {
  const aggregates = new Map<string, CentreActionAggregate>();
  const ensure = (centreId: string): CentreActionAggregate => {
    const existing = aggregates.get(centreId);
    if (existing) return existing;
    const created: CentreActionAggregate = {
      rollup: emptyRollup(),
      uncoveredCriticalFindings: 0,
      completedLast30Days: 0,
      openItems: [],
      completedItems: [],
    };
    aggregates.set(centreId, created);
    return created;
  };

  for (const row of rows) {
    const timezone = options.timezoneByCentreId.get(row.centre_id);
    if (!timezone) continue;
    const aggregate = ensure(row.centre_id);

    if (row.record_kind === "uncovered_finding") {
      aggregate.uncoveredCriticalFindings += 1;
      continue;
    }

    if (row.record_kind === "closed") {
      if (!row.closed_at) continue;
      aggregate.completedLast30Days += 1;
      aggregate.completedItems.push({
        correctiveActionId: row.id,
        title: row.title,
        severity: row.severity,
        closedAt: row.closed_at.toISOString(),
        closedLocalDate: classifyDueAt(row.closed_at, options.decisionAt, timezone).localDate,
        cta: { label: "Review action", route: `/centre/actions/${row.id}` },
      });
      continue;
    }

    if (!row.due_at) continue;
    const due = classifyDueAt(row.due_at, options.decisionAt, timezone);
    const responsibility = responsibilityFor(row, options.responsibility);
    const awaitingVerification = row.status === "VERIFICATION_REQUIRED";
    const returned =
      row.status === "MORE_INFORMATION_REQUIRED" || row.status === "REJECTED";

    aggregate.rollup.total += 1;
    if (row.severity === "CRITICAL") aggregate.rollup.critical += 1;
    if (due.bucket === "OVERDUE") aggregate.rollup.overdue += 1;
    if (["TODAY", "TOMORROW", "DUE_SOON"].includes(due.bucket)) {
      aggregate.rollup.dueSoon += 1;
    }
    if (awaitingVerification) aggregate.rollup.awaitingVerification += 1;
    if (returned) aggregate.rollup.returned += 1;
    if (responsibility === "YOU_NEED_TO_ACT") aggregate.rollup.yourAction += 1;
    else if (responsibility === "CENTRE_NEEDS_TO_ACT") aggregate.rollup.centreAction += 1;
    else if (responsibility === "WAITING_ON_SOMEONE_ELSE") aggregate.rollup.waiting += 1;

    aggregate.openItems.push({
      correctiveActionId: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      statusLabel: actionStatusLabel(row.status),
      responsibility,
      dueAt: due.at,
      dueLocalDate: due.localDate,
      dueBucket: due.bucket,
      daysFromToday: due.daysFromToday,
      independentVerificationRequired: row.independent_verification_required,
      cta:
        awaitingVerification && responsibility === "YOU_NEED_TO_ACT"
          ? { label: "Verify action", route: `/area-manager/verification/${row.id}` }
          : {
              label: responsibility === "YOU_NEED_TO_ACT" ? "Continue action" : "Review action",
              route: `/centre/actions/${row.id}`,
            },
    });
  }

  const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  for (const aggregate of aggregates.values()) {
    aggregate.openItems.sort(
      (left, right) =>
        severityRank[left.severity] - severityRank[right.severity] ||
        left.daysFromToday - right.daysFromToday ||
        left.correctiveActionId.localeCompare(right.correctiveActionId),
    );
    aggregate.completedItems.sort(
      (left, right) =>
        right.closedAt.localeCompare(left.closedAt) ||
        left.correctiveActionId.localeCompare(right.correctiveActionId),
    );
  }
  return aggregates;
}
