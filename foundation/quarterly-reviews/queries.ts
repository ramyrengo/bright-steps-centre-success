import { centreSuccessDB } from "../db";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import {
  withAuthorisationSnapshot,
  type AuthorisationQueryExecutor,
} from "../authorization/database";
import { loadCentreAuthorisationResourceFromSnapshot } from "../authorization/hierarchy";
import { authorise } from "../authorization/policy";
import type {
  AuditCentreSummary,
  AuditOwnerCandidate,
  CorrectiveActionDetail,
  CorrectiveActionSummary,
  QuarterlyAuditView,
} from "./contracts";
import { calculateAuditScore, type PerformanceBand, type ScoringOutcomeRule, type ScoreableAuditItem } from "./scoring";
import type {
  AuditOutcome,
  AuditStatus,
  CorrectiveActionStatus,
  FindingSeverity,
  FindingStatus,
} from "./types";
import { QuarterlyReviewError } from "./types";

function numberValue(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function quarterLabel(reviewPeriodStart: Date | string): string {
  const value = reviewPeriodStart instanceof Date
    ? reviewPeriodStart.toISOString().slice(0, 10)
    : String(reviewPeriodStart).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `Q${Math.floor((Number(match[2]) - 1) / 3) + 1} ${match[1]}`;
}

interface AuditIdentityRow {
  id: string;
  organisation_id: string;
  centre_id: string;
  template_version_id: string;
  audit_template_id: string;
  scoring_policy_id: string;
  centre_name: string;
  title: string;
  template_version: number;
  synthetic: boolean;
  source_classification: string;
  status: AuditStatus;
  review_period_start: Date | string;
  overall_score: number | string | null;
  coverage_percent: number | string | null;
  risk_status: QuarterlyAuditView["riskStatus"] | null;
  performance_band_code: string | null;
  performance_band_label: string | null;
  lock_version: number;
  rounding_scale: number;
}

interface AuditItemRow {
  section_id: string;
  section_title: string;
  section_instructions: string | null;
  section_sort_order: number;
  item_id: string;
  lineage_key: string;
  wording: string;
  instructions: string | null;
  item_sort_order: number;
  scoring_weight: number | string;
  scored: boolean;
  critical: boolean;
  evidence_requirement: "none" | "optional" | "required";
  response_id: string | null;
  outcome: AuditOutcome | null;
  comment: string | null;
  location_context: string | null;
  selected_owner_principal_id: string | null;
  response_lock_version: number | null;
  finding_id: string | null;
  finding_severity: FindingSeverity | null;
  finding_status: FindingStatus | null;
  action_id: string | null;
  repeat_count: number | string;
  allowed_outcomes: AuditOutcome[];
  section_score: number | string | null;
}

export async function loadAuditIdentity(
  organisationId: string,
  auditId: string,
): Promise<AuditIdentityRow> {
  const row = await centreSuccessDB.queryRow<AuditIdentityRow>`
    SELECT
      run.id,
      run.organisation_id,
      run.centre_id,
      run.template_version_id,
      version.audit_template_id,
      version.scoring_policy_id,
      centre.name AS centre_name,
      version.title,
      version.version AS template_version,
      version.synthetic,
      version.source_classification,
      run.status,
      run.review_period_start,
      run.overall_score,
      run.coverage_percent,
      run.risk_status,
      run.performance_band_code,
      run.performance_band_label,
      run.lock_version,
      policy.rounding_scale
    FROM audit_runs AS run
    JOIN centres AS centre
      ON centre.organisation_id = run.organisation_id AND centre.id = run.centre_id
    JOIN audit_template_versions AS version
      ON version.organisation_id = run.organisation_id AND version.id = run.template_version_id
    JOIN audit_scoring_policies AS policy
      ON policy.organisation_id = version.organisation_id AND policy.id = version.scoring_policy_id
    WHERE run.organisation_id = ${organisationId}
      AND run.id = ${auditId}
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "audit is not available");
  return row;
}

export async function loadActionCentre(
  organisationId: string,
  actionId: string,
): Promise<{ centreId: string; ownerPrincipalId: string | null }> {
  const row = await centreSuccessDB.queryRow<{
    centre_id: string;
    owner_principal_id: string | null;
  }>`
    SELECT centre_id, owner_principal_id
    FROM corrective_actions
    WHERE organisation_id = ${organisationId} AND id = ${actionId}
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "action is not available");
  return { centreId: row.centre_id, ownerPrincipalId: row.owner_principal_id };
}

export async function loadEvidenceTarget(
  organisationId: string,
  evidenceId: string,
): Promise<{
  centreId: string;
  objectKey: string;
  scanStatus: "not_scanned" | "clean" | "rejected";
  availabilityStatus: string;
  targetType: "AUDIT_RESPONSE" | "CORRECTIVE_ACTION";
  targetId: string;
  uploaderPrincipalId: string;
}> {
  const row = await centreSuccessDB.queryRow<{
    centre_id: string;
    object_key: string;
    scan_status: "not_scanned" | "clean" | "rejected";
    availability_status: string;
    purpose: "AUDIT_RESPONSE" | "CORRECTIVE_ACTION_REMEDIATION";
    audit_response_id: string | null;
    corrective_action_id: string | null;
    uploaded_by_principal_id: string;
  }>`
    SELECT
      evidence.centre_id,
      evidence.object_key,
      evidence.scan_status,
      evidence.availability_status,
      evidence.purpose,
      response_link.audit_response_id,
      action_link.corrective_action_id,
      evidence.uploaded_by_principal_id
    FROM evidence_items AS evidence
    LEFT JOIN audit_response_evidence AS response_link
      ON response_link.organisation_id = evidence.organisation_id
     AND response_link.evidence_item_id = evidence.id
    LEFT JOIN corrective_action_evidence AS action_link
      ON action_link.organisation_id = evidence.organisation_id
     AND action_link.evidence_item_id = evidence.id
    WHERE evidence.organisation_id = ${organisationId}
      AND evidence.id = ${evidenceId}
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "evidence is not available");
  if (row.purpose === "AUDIT_RESPONSE" && row.audit_response_id) {
    return {
      centreId: row.centre_id,
      objectKey: row.object_key,
      scanStatus: row.scan_status,
      availabilityStatus: row.availability_status,
      targetType: "AUDIT_RESPONSE",
      targetId: row.audit_response_id,
      uploaderPrincipalId: row.uploaded_by_principal_id,
    };
  }
  if (row.purpose === "CORRECTIVE_ACTION_REMEDIATION" && row.corrective_action_id) {
    return {
      centreId: row.centre_id,
      objectKey: row.object_key,
      scanStatus: row.scan_status,
      availabilityStatus: row.availability_status,
      targetType: "CORRECTIVE_ACTION",
      targetId: row.corrective_action_id,
      uploaderPrincipalId: row.uploaded_by_principal_id,
    };
  }
  throw new QuarterlyReviewError("not_found", "evidence is not available");
}

export async function listRemediationOwnerCandidatesFromSnapshot(
  executor: AuthorisationQueryExecutor,
  organisationId: string,
  centreId: string,
  at: Date = new Date(),
  lockFacts = false,
): Promise<AuditOwnerCandidate[]> {
  const rows = await executor.queryAll<{ id: string; display_name: string }>`
    SELECT DISTINCT principal.id, principal.display_name
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
     AND membership.organisation_id = ${organisationId}
    JOIN role_assignments AS assignment
      ON assignment.organisation_id = membership.organisation_id
     AND assignment.organisation_membership_id = membership.id
    JOIN role_definitions AS role_definition
      ON role_definition.organisation_id = assignment.organisation_id
     AND role_definition.id = assignment.role_definition_id
     AND role_definition.status = 'active'
    JOIN role_capabilities AS role_capability
      ON role_capability.role_definition_id = role_definition.id
     AND role_capability.capability_code = 'corrective_action.remediate'
    WHERE principal.status = 'active'
      AND membership.status = 'active'
      AND membership.effective_from <= ${at}
      AND (membership.effective_to IS NULL OR membership.effective_to > ${at})
      AND assignment.status = 'active'
      AND assignment.effective_from <= ${at}
      AND (assignment.effective_to IS NULL OR assignment.effective_to > ${at})
    ORDER BY principal.display_name, principal.id
  `;

  const resource = await loadCentreAuthorisationResourceFromSnapshot(executor, {
    organisationId,
    centreId,
    at,
  });
  const permitted: Array<{
    row: { id: string; display_name: string };
    allowed: boolean;
  }> = [];
  for (const row of rows) {
    try {
      const context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
        principalId: row.id,
        activeOrganisationId: organisationId,
        at,
      });
      permitted.push({
        row,
        allowed: authorise({
          context,
          capability: FOUNDATION_CAPABILITIES.correctiveActionRemediate,
          resource,
          at,
        }).allowed,
      });
    } catch {
      permitted.push({ row, allowed: false });
    }
  }
  const allowed = permitted
    .filter((candidate) => candidate.allowed)
    .map(({ row }) => ({ principalId: row.id, displayName: row.display_name }));

  if (lockFacts) {
    for (const candidate of allowed) {
      await executor.queryAll<{ id: string }>`
        SELECT assignment.id
        FROM principals AS principal
        JOIN organisation_memberships AS membership
          ON membership.principal_id = principal.id
         AND membership.organisation_id = ${organisationId}
        JOIN role_assignments AS assignment
          ON assignment.organisation_id = membership.organisation_id
         AND assignment.organisation_membership_id = membership.id
        JOIN role_definitions AS role_definition
          ON role_definition.organisation_id = assignment.organisation_id
         AND role_definition.id = assignment.role_definition_id
        JOIN role_capabilities AS role_capability
          ON role_capability.role_definition_id = role_definition.id
        JOIN assignment_scopes AS scope
          ON scope.organisation_id = assignment.organisation_id
         AND scope.role_assignment_id = assignment.id
        WHERE principal.id = ${candidate.principalId}
          AND principal.status = 'active'
          AND membership.status = 'active'
          AND membership.effective_from <= ${at}
          AND (membership.effective_to IS NULL OR membership.effective_to > ${at})
          AND assignment.status = 'active'
          AND assignment.effective_from <= ${at}
          AND (assignment.effective_to IS NULL OR assignment.effective_to > ${at})
          AND role_definition.status = 'active'
          AND scope.effective_from <= ${at}
          AND (scope.effective_to IS NULL OR scope.effective_to > ${at})
        FOR SHARE OF principal, membership, assignment, role_definition,
          role_capability, scope
      `;
    }
  }
  return allowed;
}

export async function listRemediationOwnerCandidates(
  organisationId: string,
  centreId: string,
  at: Date = new Date(),
): Promise<AuditOwnerCandidate[]> {
  return withAuthorisationSnapshot((executor) =>
    listRemediationOwnerCandidatesFromSnapshot(executor, organisationId, centreId, at),
  );
}

export async function listAuditCentresForPrincipal(input: {
  organisationId: string;
  centreIds: readonly string[];
}): Promise<AuditCentreSummary[]> {
  if (input.centreIds.length === 0) return [];
  const rows = await centreSuccessDB.queryAll<{
    id: string;
    name: string;
    previous_audit_date: Date | null;
    previous_score: number | string | null;
    open_actions: number | string;
  }>`
    SELECT
      centre.id,
      centre.name,
      previous.finalised_at AS previous_audit_date,
      previous.overall_score AS previous_score,
      (
        SELECT count(*)
        FROM corrective_actions AS action
        WHERE action.organisation_id = centre.organisation_id
          AND action.centre_id = centre.id
          AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
      ) AS open_actions
    FROM centres AS centre
    LEFT JOIN LATERAL (
      SELECT run.finalised_at, run.overall_score
      FROM audit_runs AS run
      WHERE run.organisation_id = centre.organisation_id
        AND run.centre_id = centre.id
        AND run.status = 'FINALISED'
      ORDER BY run.finalised_at DESC
      LIMIT 1
    ) AS previous ON TRUE
    WHERE centre.organisation_id = ${input.organisationId}
      AND centre.status = 'active'
      AND centre.id = ANY(${input.centreIds}::uuid[])
    ORDER BY centre.name, centre.id
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ...(row.previous_audit_date ? { previousAuditDate: row.previous_audit_date.toISOString() } : {}),
    ...(row.previous_score !== null ? { previousScore: numberValue(row.previous_score) } : {}),
    openCorrectiveActions: numberValue(row.open_actions),
  }));
}

export async function loadScoringInputs(identity: AuditIdentityRow): Promise<{
  items: ScoreableAuditItem[];
  outcomeRules: ScoringOutcomeRule[];
  bands: PerformanceBand[];
}> {
  const items = await centreSuccessDB.queryAll<{
    item_id: string;
    section_id: string;
    scoring_weight: number | string;
    scored: boolean;
    critical: boolean;
    outcome: AuditOutcome | null;
    comment: string | null;
    severity: FindingSeverity | null;
    finding_id: string | null;
    action_id: string | null;
  }>`
    SELECT
      item.id AS item_id,
      item.section_id,
      item.scoring_weight,
      item.scored,
      item.critical,
      response.outcome,
      response.comment,
      finding.severity,
      finding.id AS finding_id,
      action.id AS action_id
    FROM audit_template_items AS item
    LEFT JOIN audit_responses AS response
      ON response.organisation_id = item.organisation_id
     AND response.audit_item_id = item.id
     AND response.audit_run_id = ${identity.id}
    LEFT JOIN findings AS finding
      ON finding.organisation_id = response.organisation_id
     AND finding.audit_response_id = response.id
     AND finding.status = 'OPEN'
    LEFT JOIN corrective_actions AS action
      ON action.organisation_id = finding.organisation_id
     AND action.finding_id = finding.id
    WHERE item.organisation_id = ${identity.organisation_id}
      AND item.template_version_id = ${identity.template_version_id}
    ORDER BY item.section_id, item.sort_order
  `;
  const outcomeRules = await centreSuccessDB.queryAll<{
    outcome: AuditOutcome;
    score_factor: number | string | null;
    denominator_treatment: "included" | "excluded";
    requires_reason: boolean;
  }>`
    SELECT outcome, score_factor, denominator_treatment, requires_reason
    FROM audit_scoring_outcome_rules
    WHERE organisation_id = ${identity.organisation_id}
      AND scoring_policy_id = ${identity.scoring_policy_id}
  `;
  const bands = await centreSuccessDB.queryAll<{
    band_code: string;
    label: string;
    minimum_score: number | string;
    maximum_score: number | string;
    priority: number;
  }>`
    SELECT band_code, label, minimum_score, maximum_score, priority
    FROM audit_performance_bands
    WHERE organisation_id = ${identity.organisation_id}
      AND scoring_policy_id = ${identity.scoring_policy_id}
    ORDER BY priority
  `;

  return {
    items: items.map((item) => ({
      itemId: item.item_id,
      sectionId: item.section_id,
      weight: numberValue(item.scoring_weight),
      scored: item.scored,
      critical: item.critical,
      ...(item.outcome ? { outcome: item.outcome } : {}),
      ...(item.comment ? { comment: item.comment } : {}),
      ...(item.severity ? { findingSeverity: item.severity } : {}),
      findingCreated: item.finding_id !== null,
      actionCreated: item.action_id !== null,
    })),
    outcomeRules: outcomeRules.map((rule) => ({
      outcome: rule.outcome,
      scoreFactor: rule.score_factor === null ? null : numberValue(rule.score_factor),
      denominatorTreatment: rule.denominator_treatment,
      requiresReason: rule.requires_reason,
    })),
    bands: bands.map((band) => ({
      code: band.band_code,
      label: band.label,
      minimumScore: numberValue(band.minimum_score),
      maximumScore: numberValue(band.maximum_score),
      priority: band.priority,
    })),
  };
}

export async function loadQuarterlyAuditView(input: {
  organisationId: string;
  principalId: string;
  auditId: string;
}): Promise<QuarterlyAuditView> {
  const identity = await loadAuditIdentity(input.organisationId, input.auditId);
  const [itemRows, ownerCandidates, positiveRows, acknowledgement, previous, scoringInputs] =
    await Promise.all([
      centreSuccessDB.queryAll<AuditItemRow>`
        SELECT
          section.id AS section_id,
          section.title AS section_title,
          section.instructions AS section_instructions,
          section.sort_order AS section_sort_order,
          item.id AS item_id,
          item.lineage_key,
          item.wording,
          item.instructions,
          item.sort_order AS item_sort_order,
          item.scoring_weight,
          item.scored,
          item.critical,
          item.evidence_requirement,
          response.id AS response_id,
          response.outcome,
          response.comment,
          response.location_context,
          response.selected_owner_principal_id,
          response.lock_version AS response_lock_version,
          finding.id AS finding_id,
          finding.severity AS finding_severity,
          finding.status AS finding_status,
          action.id AS action_id,
          (
            SELECT count(*)
            FROM findings AS repeated
            JOIN audit_runs AS repeated_run
              ON repeated_run.organisation_id = repeated.organisation_id
             AND repeated_run.id = repeated.audit_run_id
            WHERE repeated.organisation_id = item.organisation_id
              AND repeated.centre_id = ${identity.centre_id}
              AND repeated.source_family = 'QUARTERLY_AUDIT'
              AND repeated.item_lineage_key = item.lineage_key
              AND repeated.status <> 'WITHDRAWN'
              AND repeated_run.status = 'FINALISED'
          ) AS repeat_count,
          ARRAY(
            SELECT configuration.outcome
            FROM audit_item_outcome_configurations AS configuration
            WHERE configuration.organisation_id = item.organisation_id
              AND configuration.audit_item_id = item.id
              AND configuration.permitted
            ORDER BY configuration.outcome
          ) AS allowed_outcomes,
          section_result.score AS section_score
        FROM audit_template_sections AS section
        JOIN audit_template_items AS item
          ON item.organisation_id = section.organisation_id
         AND item.template_version_id = section.template_version_id
         AND item.section_id = section.id
        LEFT JOIN audit_responses AS response
          ON response.organisation_id = item.organisation_id
         AND response.audit_run_id = ${identity.id}
         AND response.audit_item_id = item.id
        LEFT JOIN findings AS finding
          ON finding.organisation_id = response.organisation_id
         AND finding.audit_response_id = response.id
        LEFT JOIN corrective_actions AS action
          ON action.organisation_id = finding.organisation_id
         AND action.finding_id = finding.id
        LEFT JOIN audit_section_results AS section_result
          ON section_result.organisation_id = section.organisation_id
         AND section_result.audit_run_id = ${identity.id}
         AND section_result.section_id = section.id
        WHERE section.organisation_id = ${input.organisationId}
          AND section.template_version_id = ${identity.template_version_id}
        ORDER BY section.sort_order, item.sort_order
      `,
      listRemediationOwnerCandidates(input.organisationId, identity.centre_id),
      centreSuccessDB.queryAll<{ id: string; description: string }>`
        SELECT id, description FROM positive_observations
        WHERE organisation_id = ${input.organisationId} AND audit_run_id = ${identity.id}
        ORDER BY created_at, id
      `,
      centreSuccessDB.queryRow<{ id: string }>`
        SELECT id FROM audit_acknowledgements
        WHERE organisation_id = ${input.organisationId}
          AND audit_run_id = ${identity.id}
          AND principal_id = ${input.principalId}
      `,
      centreSuccessDB.queryRow<{ id: string; overall_score: number | string | null }>`
        SELECT previous.id, previous.overall_score
        FROM audit_runs AS previous
        JOIN audit_template_versions AS previous_version
          ON previous_version.organisation_id = previous.organisation_id
         AND previous_version.id = previous.template_version_id
        WHERE previous.organisation_id = ${input.organisationId}
          AND previous.centre_id = ${identity.centre_id}
          AND previous.status = 'FINALISED'
          AND previous.review_period_start < ${identity.review_period_start}
          AND previous_version.audit_template_id = ${identity.audit_template_id}
          AND previous_version.scoring_policy_id = ${identity.scoring_policy_id}
        ORDER BY previous.review_period_start DESC
        LIMIT 1
      `,
      loadScoringInputs(identity),
    ]);

  const preview = calculateAuditScore({
    ...scoringInputs,
    roundingScale: identity.rounding_scale,
  });
  const sections = new Map<string, QuarterlyAuditView["sections"][number]>();
  for (const row of itemRows) {
    const section = sections.get(row.section_id) ?? {
      id: row.section_id,
      title: row.section_title,
      ...(row.section_instructions ? { instructions: row.section_instructions } : {}),
      items: [],
      ...(row.section_score !== null ? { score: numberValue(row.section_score) } : {}),
    };
    section.items.push({
      id: row.item_id,
      lineageKey: row.lineage_key,
      wording: row.wording,
      ...(row.instructions ? { instructions: row.instructions } : {}),
      weight: numberValue(row.scoring_weight),
      scored: row.scored,
      critical: row.critical,
      evidenceRequirement: row.evidence_requirement,
      allowedOutcomes: row.allowed_outcomes,
      ...(row.response_id && row.outcome
        ? {
            response: {
              id: row.response_id,
              outcome: row.outcome,
              ...(row.comment ? { comment: row.comment } : {}),
              ...(row.location_context ? { locationContext: row.location_context } : {}),
              ...(row.selected_owner_principal_id
                ? { selectedOwnerPrincipalId: row.selected_owner_principal_id }
                : {}),
              lockVersion: row.response_lock_version ?? 1,
            },
          }
        : {}),
      ...(row.finding_id && row.finding_severity && row.finding_status
        ? {
            finding: {
              id: row.finding_id,
              severity: row.finding_severity,
              status: row.finding_status,
              repeatCount: numberValue(row.repeat_count),
              ...(row.action_id ? { actionId: row.action_id } : {}),
            },
          }
        : {}),
    });
    sections.set(row.section_id, section);
  }

  const answered = itemRows.filter((row) => row.response_id !== null).length;
  const effectiveScore = identity.status === "FINALISED"
    ? identity.overall_score === null ? undefined : numberValue(identity.overall_score)
    : preview.overallScore ?? undefined;
  return {
    id: identity.id,
    centre: { id: identity.centre_id, name: identity.centre_name },
    template: {
      id: identity.template_version_id,
      title: identity.title,
      version: identity.template_version,
      synthetic: identity.synthetic,
      sourceClassification: identity.source_classification,
    },
    status: identity.status,
    reviewPeriodStart:
      identity.review_period_start instanceof Date
        ? identity.review_period_start.toISOString().slice(0, 10)
        : String(identity.review_period_start),
    lockVersion: identity.lock_version,
    progress: { answered, total: itemRows.length },
    ...(effectiveScore !== undefined ? { score: effectiveScore } : {}),
    coveragePercent:
      identity.status === "FINALISED" && identity.coverage_percent !== null
        ? numberValue(identity.coverage_percent)
        : preview.coveragePercent,
    riskStatus:
      identity.status === "FINALISED"
        ? identity.risk_status ?? undefined
        : preview.riskStatus,
    ...(identity.performance_band_code && identity.performance_band_label
      ? {
          performanceBand: {
            code: identity.performance_band_code,
            label: identity.performance_band_label,
          },
        }
      : preview.band
        ? { performanceBand: { code: preview.band.code, label: preview.band.label } }
        : {}),
    ...(previous
      ? {
          previousComparison: {
            auditId: previous.id,
            ...(previous.overall_score !== null
              ? {
                  score: numberValue(previous.overall_score),
                  ...(effectiveScore !== undefined
                    ? { difference: Math.round((effectiveScore - numberValue(previous.overall_score)) * 10) / 10 }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ownerCandidates,
    sections: [...sections.values()],
    positivePractices: positiveRows,
    acknowledged: acknowledgement !== null,
  };
}

export async function listCorrectiveActionsForPrincipal(input: {
  organisationId: string;
  principalId?: string;
  verificationOnly?: boolean;
}): Promise<CorrectiveActionSummary[]> {
  const rows = await centreSuccessDB.queryAll<{
    id: string;
    centre_id: string;
    centre_name: string;
    title: string;
    severity: FindingSeverity;
    due_at: Date;
    status: CorrectiveActionStatus;
    owner_principal_id: string | null;
    independent_verification_required: boolean;
    remediation_submitted_at: Date | null;
  }>`
    SELECT
      action.id,
      action.centre_id,
      centre.name AS centre_name,
      action.title,
      action.severity,
      action.due_at,
      action.status,
      action.owner_principal_id,
      action.independent_verification_required,
      action.remediation_submitted_at
    FROM corrective_actions AS action
    JOIN centres AS centre
      ON centre.organisation_id = action.organisation_id AND centre.id = action.centre_id
    WHERE action.organisation_id = ${input.organisationId}
      AND (${input.principalId ?? null}::uuid IS NULL OR action.owner_principal_id = ${input.principalId ?? null})
      AND (${input.verificationOnly ?? false} = FALSE OR action.status = 'VERIFICATION_REQUIRED')
      AND action.status <> 'WITHDRAWN'
    ORDER BY action.due_at, action.id
  `;
  return rows.map((row) => ({
    id: row.id,
    centreId: row.centre_id,
    centreName: row.centre_name,
    title: row.title,
    severity: row.severity,
    dueAt: row.due_at.toISOString(),
    status: row.status,
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    verificationRequired: row.independent_verification_required,
    ...(row.remediation_submitted_at ? { submittedAt: row.remediation_submitted_at.toISOString() } : {}),
  }));
}

export async function loadCorrectiveActionDetail(
  organisationId: string,
  actionId: string,
  principalId?: string,
): Promise<CorrectiveActionDetail> {
  const row = await centreSuccessDB.queryRow<{
    id: string; centre_id: string; centre_name: string; title: string;
    severity: FindingSeverity; due_at: Date; status: CorrectiveActionStatus;
    owner_principal_id: string | null; independent_verification_required: boolean;
    remediation_submitted_at: Date | null; required_remediation: string;
    evidence_requirement: "none" | "optional" | "required"; lock_version: number;
    finding_id: string; finding_description: string; source_family: "QUARTERLY_AUDIT" | "OPERATIONAL_CHECK";
    audit_run_id: string | null; audit_status: AuditStatus | null; audit_acknowledged: boolean;
    audit_review_period_start: Date | string | null;
    occurrence_id: string | null; occurrence_business_date: string | null;
    occurrence_synthetic: boolean | null; operational_standard_name: string | null;
    item_lineage_key: string; repeat_count: number | string;
  }>`
    SELECT
      action.id, action.centre_id, centre.name AS centre_name, action.title,
      action.severity, action.due_at, action.status, action.owner_principal_id,
      action.independent_verification_required, action.remediation_submitted_at,
      action.required_remediation, action.evidence_requirement, action.lock_version,
      finding.id AS finding_id, finding.description AS finding_description,
      finding.source_family,
      finding.audit_run_id, audit.status AS audit_status,
      audit.review_period_start AS audit_review_period_start,
      (${principalId ?? null}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM audit_acknowledgements AS acknowledgement
        WHERE acknowledgement.organisation_id = action.organisation_id
          AND acknowledgement.audit_run_id = finding.audit_run_id
          AND acknowledgement.principal_id = ${principalId ?? null}
      )) AS audit_acknowledged,
      occurrence.id AS occurrence_id,
      occurrence.business_date::text AS occurrence_business_date,
      version.synthetic AS occurrence_synthetic,
      version.title AS operational_standard_name,
      finding.item_lineage_key,
      CASE
        WHEN finding.source_family = 'QUARTERLY_AUDIT' THEN (
          SELECT count(*) FROM findings AS repeated
          WHERE repeated.organisation_id = finding.organisation_id
            AND repeated.centre_id = finding.centre_id
            AND repeated.source_family = 'QUARTERLY_AUDIT'
            AND repeated.item_lineage_key = finding.item_lineage_key
            AND repeated.status <> 'WITHDRAWN'
        )
        ELSE 1
      END AS repeat_count
    FROM corrective_actions AS action
    JOIN centres AS centre
      ON centre.organisation_id = action.organisation_id AND centre.id = action.centre_id
    JOIN findings AS finding
      ON finding.organisation_id = action.organisation_id AND finding.id = action.finding_id
    LEFT JOIN audit_runs AS audit
      ON audit.organisation_id = finding.organisation_id AND audit.id = finding.audit_run_id
    LEFT JOIN operational_check_responses AS operational_response
      ON operational_response.organisation_id = finding.organisation_id
     AND operational_response.id = finding.check_response_id
    LEFT JOIN operational_check_occurrences AS occurrence
      ON occurrence.organisation_id = operational_response.organisation_id
     AND occurrence.id = operational_response.occurrence_id
    LEFT JOIN audit_template_versions AS version
      ON version.organisation_id = occurrence.organisation_id
     AND version.id = occurrence.template_version_id
    WHERE action.organisation_id = ${organisationId} AND action.id = ${actionId}
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "action is not available");
  const [evidence, history] = await Promise.all([
    centreSuccessDB.queryAll<{
      id: string; original_filename: string; media_type: string; byte_size: number | string | null;
      scan_status: "not_scanned" | "clean" | "rejected"; availability_status: string;
    }>`
      SELECT evidence.id, evidence.original_filename, evidence.media_type,
             evidence.byte_size, evidence.scan_status, evidence.availability_status
      FROM corrective_action_evidence AS link
      JOIN evidence_items AS evidence
        ON evidence.organisation_id = link.organisation_id AND evidence.id = link.evidence_item_id
      WHERE link.organisation_id = ${organisationId} AND link.corrective_action_id = ${actionId}
      ORDER BY link.linked_at, evidence.id
    `,
    centreSuccessDB.queryAll<{
      event_type: string; from_status: string | null; to_status: string;
      reason: string | null; occurred_at: Date;
    }>`
      SELECT event_type, from_status, to_status, reason, occurred_at
      FROM corrective_action_events
      WHERE organisation_id = ${organisationId} AND corrective_action_id = ${actionId}
      ORDER BY event_sequence
    `,
  ]);
  return {
    id: row.id, centreId: row.centre_id, centreName: row.centre_name,
    title: row.title, severity: row.severity, dueAt: row.due_at.toISOString(),
    status: row.status, ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    verificationRequired: row.independent_verification_required,
    ...(row.remediation_submitted_at ? { submittedAt: row.remediation_submitted_at.toISOString() } : {}),
    finding: {
      id: row.finding_id, description: row.finding_description,
      itemLineageKey: row.item_lineage_key,
      repeatCount: numberValue(row.repeat_count),
      origin: row.source_family === "QUARTERLY_AUDIT"
        ? {
            source: "QUARTERLY_AUDIT",
            label: "Quarterly review",
            quarterLabel: quarterLabel(row.audit_review_period_start!),
            auditId: row.audit_run_id!,
            auditStatus: row.audit_status!,
            acknowledged: row.audit_acknowledged,
          }
        : {
            source: "OPERATIONAL_CHECK",
            label: "Centre Standard",
            occurrenceId: row.occurrence_id!,
            standardName: row.operational_standard_name!,
            businessDate: row.occurrence_business_date!,
            synthetic: row.occurrence_synthetic === true,
          },
    },
    requiredRemediation: row.required_remediation,
    evidenceRequirement: row.evidence_requirement,
    lockVersion: row.lock_version,
    evidence: evidence.map((item) => ({
      id: item.id, filename: item.original_filename, mediaType: item.media_type,
      ...(item.byte_size !== null ? { byteSize: numberValue(item.byte_size) } : {}),
      scanStatus: item.scan_status, availabilityStatus: item.availability_status,
    })),
    history: history.map((event) => ({
      eventType: event.event_type,
      ...(event.from_status ? { fromStatus: event.from_status } : {}),
      toStatus: event.to_status,
      ...(event.reason ? { reason: event.reason } : {}),
      occurredAt: event.occurred_at.toISOString(),
    })),
  };
}
