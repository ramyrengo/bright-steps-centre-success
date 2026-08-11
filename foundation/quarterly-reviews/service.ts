import { randomUUID } from "node:crypto";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { centreSuccessDB } from "../db";
import type {
  AcknowledgeAuditResponse,
  ActionTransitionResponse,
  AuditStatusTransitionResponse,
  AuditPreparationResponse,
  FinaliseQuarterlyAuditResponse,
  ComplianceOversightResponse,
  SaveAuditResponseRequest,
  SaveAuditResponseResponse,
  StartQuarterlyAuditResponse,
} from "./contracts";
import { calculateAuditScore, type PerformanceBand, type ScoringOutcomeRule, type ScoreableAuditItem } from "./scoring";
import { listRemediationOwnerCandidatesFromSnapshot } from "./queries";
import {
  AUDIT_OUTCOMES,
  QuarterlyReviewError,
  optionalTrimmedText,
  requireUuid,
  type AuditOutcome,
  type AuditStatus,
  type CorrectiveActionStatus,
  type FindingSeverity,
} from "./types";

async function inSerializableTransaction<T>(
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function quarterStart(at: Date): string {
  const month = Math.floor(at.getUTCMonth() / 3) * 3;
  return `${at.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
}

function severityRank(severity: FindingSeverity): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[severity];
}

interface ResponseConfigurationRow {
  audit_run_id: string;
  audit_status: AuditStatus;
  audit_lock_version: number;
  organisation_id: string;
  centre_id: string;
  template_version_id: string;
  scoring_policy_id: string;
  auditor_principal_id: string;
  item_id: string;
  lineage_key: string;
  wording: string;
  source_classification: string;
  critical: boolean;
  evidence_requirement: "none" | "optional" | "required";
  permitted: boolean;
  creates_finding: boolean;
  creates_action: boolean;
  immediate: boolean;
  severity: FindingSeverity | null;
  due_days: number | null;
  independent_verification_required: boolean;
  required_remediation: string | null;
  requires_reason: boolean;
  existing_response_id: string | null;
  existing_outcome: AuditOutcome | null;
  existing_lock_version: number | null;
  existing_finding_id: string | null;
  existing_finding_status: "OPEN" | "RESOLVED" | "WITHDRAWN" | null;
  existing_action_id: string | null;
  existing_action_status: CorrectiveActionStatus | null;
}

async function loadResponseConfiguration(
  transaction: Transaction,
  input: { organisationId: string; auditId: string; itemId: string; outcome: AuditOutcome },
): Promise<ResponseConfigurationRow> {
  const row = await transaction.queryRow<ResponseConfigurationRow>`
    SELECT
      run.id AS audit_run_id,
      run.status AS audit_status,
      run.lock_version AS audit_lock_version,
      run.organisation_id,
      run.centre_id,
      run.template_version_id,
      version.scoring_policy_id,
      run.auditor_principal_id,
      item.id AS item_id,
      item.lineage_key,
      item.wording,
      item.source_classification,
      item.critical,
      item.evidence_requirement,
      configuration.permitted,
      configuration.creates_finding,
      configuration.creates_action,
      configuration.immediate,
      configuration.severity,
      configuration.due_days,
      configuration.independent_verification_required,
      configuration.required_remediation,
      scoring.requires_reason,
      response.id AS existing_response_id,
      response.outcome AS existing_outcome,
      response.lock_version AS existing_lock_version,
      finding.id AS existing_finding_id,
      finding.status AS existing_finding_status,
      action.id AS existing_action_id,
      action.status AS existing_action_status
    FROM audit_runs AS run
    JOIN audit_template_versions AS version
      ON version.organisation_id = run.organisation_id
     AND version.id = run.template_version_id
    JOIN audit_template_items AS item
      ON item.organisation_id = run.organisation_id
     AND item.template_version_id = run.template_version_id
     AND item.id = ${input.itemId}
    JOIN audit_item_outcome_configurations AS configuration
      ON configuration.organisation_id = item.organisation_id
     AND configuration.audit_item_id = item.id
     AND configuration.outcome = ${input.outcome}
    JOIN audit_scoring_outcome_rules AS scoring
      ON scoring.organisation_id = version.organisation_id
     AND scoring.scoring_policy_id = version.scoring_policy_id
     AND scoring.outcome = configuration.outcome
    LEFT JOIN audit_responses AS response
      ON response.organisation_id = run.organisation_id
     AND response.audit_run_id = run.id
     AND response.audit_item_id = item.id
    LEFT JOIN findings AS finding
      ON finding.organisation_id = response.organisation_id
     AND finding.audit_response_id = response.id
    LEFT JOIN corrective_actions AS action
      ON action.organisation_id = finding.organisation_id
     AND action.finding_id = finding.id
    WHERE run.organisation_id = ${input.organisationId}
      AND run.id = ${input.auditId}
    FOR UPDATE OF run
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "audit item is not available");
  return row;
}

async function recordActionEvent(
  transaction: Transaction,
  input: {
    organisationId: string;
    actionId: string;
    actorPrincipalId: string;
    eventType: string;
    fromStatus?: string;
    toStatus: string;
    reason?: string;
    occurredAt: Date;
  },
): Promise<void> {
  const sequence = await transaction.queryRow<{ event_sequence: number }>`
    SELECT COALESCE(max(event_sequence), 0)::integer + 1 AS event_sequence
    FROM corrective_action_events
    WHERE organisation_id = ${input.organisationId}
      AND corrective_action_id = ${input.actionId}
  `;
  await transaction.exec`
    INSERT INTO corrective_action_events (
      id, organisation_id, corrective_action_id, actor_principal_id,
      event_type, from_status, to_status, reason, occurred_at, event_sequence
    ) VALUES (
      ${randomUUID()}, ${input.organisationId}, ${input.actionId},
      ${input.actorPrincipalId}, ${input.eventType}, ${input.fromStatus ?? null},
      ${input.toStatus}, ${input.reason ?? null}, ${input.occurredAt},
      ${sequence?.event_sequence ?? 1}
    )
  `;
}

async function withdrawFindingAndAction(
  transaction: Transaction,
  input: {
    organisationId: string;
    centreId: string;
    findingId: string;
    actionId: string | null;
    actionStatus: CorrectiveActionStatus | null;
    actorPrincipalId: string;
    reason: string;
    occurredAt: Date;
  },
): Promise<void> {
  await transaction.exec`
    UPDATE findings
    SET status = 'WITHDRAWN', withdrawn_at = ${input.occurredAt},
        withdrawn_by_principal_id = ${input.actorPrincipalId},
        withdrawal_reason = ${input.reason}, updated_at = ${input.occurredAt},
        lock_version = lock_version + 1
    WHERE organisation_id = ${input.organisationId}
      AND id = ${input.findingId}
      AND status = 'OPEN'
  `;
  await recordAuditEventWithExecutor(transaction, {
    organisationId: input.organisationId,
    actorPrincipalId: input.actorPrincipalId,
    action: "finding.withdrawn_after_response_correction",
    resourceType: "finding",
    resourceId: input.findingId,
    scopeType: "centre",
    scopeId: input.centreId,
    context: { reasonRecorded: true },
    occurredAt: input.occurredAt,
  });

  if (input.actionId && input.actionStatus && input.actionStatus !== "WITHDRAWN") {
    await transaction.exec`
      UPDATE corrective_actions
      SET status = 'WITHDRAWN', withdrawn_at = ${input.occurredAt},
          withdrawn_by_principal_id = ${input.actorPrincipalId},
          withdrawal_reason = ${input.reason}, updated_at = ${input.occurredAt},
          lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId}
        AND id = ${input.actionId}
        AND status <> 'WITHDRAWN'
    `;
    await recordActionEvent(transaction, {
      organisationId: input.organisationId,
      actionId: input.actionId,
      actorPrincipalId: input.actorPrincipalId,
      eventType: "action.withdrawn_after_response_correction",
      fromStatus: input.actionStatus,
      toStatus: "WITHDRAWN",
      reason: input.reason,
      occurredAt: input.occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.withdrawn_after_response_correction",
      resourceType: "corrective_action",
      resourceId: input.actionId,
      scopeType: "centre",
      scopeId: input.centreId,
      context: { reasonRecorded: true },
      occurredAt: input.occurredAt,
    });
  }
}

async function ensureFindingAndAction(
  transaction: Transaction,
  input: {
    configuration: Pick<
      ResponseConfigurationRow,
      | "organisation_id" | "centre_id" | "audit_run_id" | "item_id"
      | "lineage_key" | "wording" | "source_classification" | "severity"
      | "due_days" | "independent_verification_required" | "required_remediation"
      | "evidence_requirement" | "creates_finding" | "creates_action"
    >;
    responseId: string;
    actorPrincipalId: string;
    ownerPrincipalId?: string;
    occurredAt: Date;
    immediate: boolean;
  },
): Promise<{
  findingCreated: boolean;
  actionCreated: boolean;
  ownerResolutionRequired: boolean;
  severity?: FindingSeverity;
}> {
  const configuration = input.configuration;
  if (!configuration.creates_finding || !configuration.severity) {
    return { findingCreated: false, actionCreated: false, ownerResolutionRequired: false };
  }

  let finding = await transaction.queryRow<{
    id: string;
    severity: FindingSeverity;
    status: "OPEN" | "RESOLVED" | "WITHDRAWN";
  }>`
    SELECT id, severity, status FROM findings
    WHERE organisation_id = ${configuration.organisation_id}
      AND audit_response_id = ${input.responseId}
    FOR UPDATE
  `;
  let findingCreated = false;
  if (!finding) {
    finding = { id: randomUUID(), severity: configuration.severity, status: "OPEN" };
    await transaction.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, audit_run_id, audit_response_id,
        item_lineage_key, severity, description, source_classification,
        status, created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${finding.id}, ${configuration.organisation_id}, ${configuration.centre_id},
        ${configuration.audit_run_id}, ${input.responseId}, ${configuration.lineage_key},
        ${configuration.severity}, ${configuration.wording},
        ${configuration.source_classification}, 'OPEN', ${input.actorPrincipalId},
        ${input.occurredAt}, ${input.occurredAt}
      )
    `;
    findingCreated = true;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: configuration.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "finding.created",
      resourceType: "finding",
      resourceId: finding.id,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: { source: "quarterly_audit", immediate: input.immediate },
      occurredAt: input.occurredAt,
    });
  } else if (finding.status === "WITHDRAWN") {
    await transaction.exec`
      UPDATE findings
      SET status = 'OPEN', withdrawn_at = NULL,
          withdrawn_by_principal_id = NULL, withdrawal_reason = NULL,
          severity = CASE
            WHEN ${severityRank(configuration.severity)} > ${severityRank(finding.severity)}
              THEN ${configuration.severity}
            ELSE severity
          END,
          updated_at = ${input.occurredAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${configuration.organisation_id} AND id = ${finding.id}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: configuration.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "finding.reactivated_after_response_correction",
      resourceType: "finding",
      resourceId: finding.id,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: { historicalRecordReused: true },
      occurredAt: input.occurredAt,
    });
    finding.status = "OPEN";
    if (severityRank(configuration.severity) > severityRank(finding.severity)) {
      finding.severity = configuration.severity;
    }
  } else if (severityRank(configuration.severity) > severityRank(finding.severity)) {
    await transaction.exec`
      UPDATE findings
      SET severity = ${configuration.severity}, updated_at = ${input.occurredAt},
          lock_version = lock_version + 1
      WHERE organisation_id = ${configuration.organisation_id} AND id = ${finding.id}
    `;
    finding.severity = configuration.severity;
  }

  if (!configuration.creates_action) {
    return { findingCreated, actionCreated: false, ownerResolutionRequired: false, severity: finding.severity };
  }
  if (
    configuration.due_days === null ||
    !configuration.required_remediation
  ) {
    throw new QuarterlyReviewError("invalid_state", "audit action configuration is incomplete");
  }

  const independentVerificationRequired =
    configuration.independent_verification_required ||
    configuration.severity === "CRITICAL" ||
    input.immediate;

  let action = await transaction.queryRow<{
    id: string;
    owner_principal_id: string | null;
    severity: FindingSeverity;
    status: CorrectiveActionStatus;
    independent_verification_required: boolean;
  }>`
    SELECT id, owner_principal_id, severity, status, independent_verification_required
    FROM corrective_actions
    WHERE organisation_id = ${configuration.organisation_id}
      AND finding_id = ${finding.id}
    FOR UPDATE
  `;
  let actionCreated = false;
  if (!action) {
    action = {
      id: randomUUID(),
      owner_principal_id: input.ownerPrincipalId ?? null,
      severity: configuration.severity,
      status: "OPEN",
      independent_verification_required: independentVerificationRequired,
    };
    const dueAt = new Date(
      input.occurredAt.getTime() + configuration.due_days * 24 * 60 * 60 * 1000,
    );
    await transaction.exec`
      INSERT INTO corrective_actions (
        id, organisation_id, centre_id, finding_id, owner_principal_id,
        title, required_remediation, evidence_requirement, severity, due_at,
        independent_verification_required, status, created_at, updated_at
      ) VALUES (
        ${action.id}, ${configuration.organisation_id}, ${configuration.centre_id},
        ${finding.id}, ${input.ownerPrincipalId ?? null}, ${configuration.wording},
        ${configuration.required_remediation}, ${configuration.evidence_requirement},
        ${configuration.severity}, ${dueAt},
        ${independentVerificationRequired}, 'OPEN',
        ${input.occurredAt}, ${input.occurredAt}
      )
    `;
    await recordActionEvent(transaction, {
      organisationId: configuration.organisation_id,
      actionId: action.id,
      actorPrincipalId: input.actorPrincipalId,
      eventType: "action.created",
      toStatus: "OPEN",
      reason: input.immediate
        ? "Immediate configured audit response"
        : "Configured audit finding",
      occurredAt: input.occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: configuration.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.created",
      resourceType: "corrective_action",
      resourceId: action.id,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: { source: "quarterly_audit", immediate: input.immediate },
      occurredAt: input.occurredAt,
    });
    actionCreated = true;
  } else if (action.status === "WITHDRAWN") {
    await transaction.exec`
      UPDATE corrective_actions
      SET status = 'OPEN', withdrawn_at = NULL,
          withdrawn_by_principal_id = NULL, withdrawal_reason = NULL,
          owner_principal_id = ${input.ownerPrincipalId ?? action.owner_principal_id},
          severity = CASE
            WHEN ${severityRank(configuration.severity)} > ${severityRank(action.severity)}
              THEN ${configuration.severity}
            ELSE severity
          END,
          independent_verification_required =
            independent_verification_required OR ${independentVerificationRequired},
          remediation_submitted_by_principal_id = NULL,
          remediation_submitted_at = NULL,
          verified_by_principal_id = NULL,
          verified_at = NULL,
          closed_at = NULL,
          updated_at = ${input.occurredAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${configuration.organisation_id} AND id = ${action.id}
    `;
    await recordActionEvent(transaction, {
      organisationId: configuration.organisation_id,
      actionId: action.id,
      actorPrincipalId: input.actorPrincipalId,
      eventType: "action.reactivated_after_response_correction",
      fromStatus: "WITHDRAWN",
      toStatus: "OPEN",
      reason: "The corrected audit response again requires an active action.",
      occurredAt: input.occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: configuration.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.reactivated_after_response_correction",
      resourceType: "corrective_action",
      resourceId: action.id,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: { historicalRecordReused: true },
      occurredAt: input.occurredAt,
    });
    action.status = "OPEN";
    action.owner_principal_id = input.ownerPrincipalId ?? action.owner_principal_id;
    action.independent_verification_required =
      action.independent_verification_required || independentVerificationRequired;
    if (severityRank(configuration.severity) > severityRank(action.severity)) {
      action.severity = configuration.severity;
    }
  } else if (
    severityRank(configuration.severity) > severityRank(action.severity) ||
    (independentVerificationRequired && !action.independent_verification_required)
  ) {
    await transaction.exec`
      UPDATE corrective_actions
      SET severity = CASE
            WHEN ${severityRank(configuration.severity)} > ${severityRank(action.severity)}
              THEN ${configuration.severity}
            ELSE severity
          END,
          independent_verification_required =
            independent_verification_required OR ${independentVerificationRequired},
          updated_at = ${input.occurredAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${configuration.organisation_id} AND id = ${action.id}
    `;
    if (severityRank(configuration.severity) > severityRank(action.severity)) {
      action.severity = configuration.severity;
    }
    action.independent_verification_required =
      action.independent_verification_required || independentVerificationRequired;
  }

  if (input.ownerPrincipalId && action.owner_principal_id !== input.ownerPrincipalId) {
    const previousOwner = action.owner_principal_id;
    await transaction.exec`
      UPDATE corrective_actions
      SET owner_principal_id = ${input.ownerPrincipalId},
          updated_at = ${input.occurredAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${configuration.organisation_id} AND id = ${action.id}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: configuration.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.owner_selected",
      resourceType: "corrective_action",
      resourceId: action.id,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: { ownerChanged: previousOwner !== null },
      occurredAt: input.occurredAt,
    });
    action.owner_principal_id = input.ownerPrincipalId;
  }

  return {
    findingCreated,
    actionCreated,
    ownerResolutionRequired: action.owner_principal_id === null,
    ...(finding.status === "OPEN" ? { severity: finding.severity } : {}),
  };
}

export async function getAuditPreparation(input: {
  organisationId: string;
  centreId: string;
}): Promise<AuditPreparationResponse> {
  const row = await centreSuccessDB.queryRow<{
    centre_id: string; centre_name: string; template_version_id: string;
    title: string; version: number; synthetic: boolean;
    previous_id: string | null; previous_finalised_at: Date | null;
    previous_score: number | string | null; open_actions: number | string;
  }>`
    SELECT
      centre.id AS centre_id, centre.name AS centre_name,
      version.id AS template_version_id, version.title, version.version, version.synthetic,
      previous.id AS previous_id, previous.finalised_at AS previous_finalised_at,
      previous.overall_score AS previous_score,
      (SELECT count(*) FROM corrective_actions AS action
       WHERE action.organisation_id = centre.organisation_id
         AND action.centre_id = centre.id
         AND action.status NOT IN ('CLOSED', 'WITHDRAWN')) AS open_actions
    FROM centres AS centre
    JOIN audit_template_versions AS version
      ON version.organisation_id = centre.organisation_id
     AND version.status = 'active'
     AND version.effective_from <= now()
    JOIN audit_templates AS template
      ON template.organisation_id = version.organisation_id
     AND template.id = version.audit_template_id
     AND template.audit_type = 'quarterly_review'
     AND template.status = 'active'
    LEFT JOIN LATERAL (
      SELECT run.id, run.finalised_at, run.overall_score
      FROM audit_runs AS run
      WHERE run.organisation_id = centre.organisation_id
        AND run.centre_id = centre.id AND run.status = 'FINALISED'
      ORDER BY run.finalised_at DESC LIMIT 1
    ) AS previous ON TRUE
    WHERE centre.organisation_id = ${input.organisationId}
      AND centre.id = ${input.centreId} AND centre.status = 'active'
    ORDER BY version.effective_from DESC
    LIMIT 1
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "centre review is not available");
  return {
    centre: { id: row.centre_id, name: row.centre_name },
    activeTemplate: {
      id: row.template_version_id,
      title: row.title,
      version: row.version,
      synthetic: row.synthetic,
    },
    ...(row.previous_id && row.previous_finalised_at
      ? {
          previousAudit: {
            id: row.previous_id,
            finalisedAt: row.previous_finalised_at.toISOString(),
            ...(row.previous_score !== null ? { score: Number(row.previous_score) } : {}),
          },
        }
      : {}),
    openCorrectiveActions: Number(row.open_actions),
  };
}

export async function startQuarterlyAudit(input: {
  organisationId: string;
  centreId: string;
  actorPrincipalId: string;
  at?: Date;
}): Promise<StartQuarterlyAuditResponse> {
  const at = input.at ?? new Date();
  return inSerializableTransaction(async (transaction) => {
    const version = await transaction.queryRow<{ id: string }>`
      SELECT version.id
      FROM audit_template_versions AS version
      JOIN audit_templates AS template
        ON template.organisation_id = version.organisation_id
       AND template.id = version.audit_template_id
      WHERE version.organisation_id = ${input.organisationId}
        AND version.status = 'active'
        AND version.effective_from <= ${at}
        AND template.audit_type = 'quarterly_review'
        AND template.status = 'active'
      ORDER BY version.effective_from DESC
      LIMIT 1
      FOR SHARE OF version
    `;
    if (!version) throw new QuarterlyReviewError("invalid_state", "no active quarterly review template");
    const period = quarterStart(at);
    const existing = await transaction.queryRow<{ id: string; status: AuditStatus }>`
      SELECT id, status FROM audit_runs
      WHERE organisation_id = ${input.organisationId}
        AND centre_id = ${input.centreId}
        AND template_version_id = ${version.id}
        AND review_period_start = ${period}::date
      FOR UPDATE
    `;
    if (existing) return { auditId: existing.id, status: existing.status, created: false };

    const auditId = randomUUID();
    await transaction.exec`
      INSERT INTO audit_runs (
        id, organisation_id, centre_id, template_version_id,
        auditor_principal_id, review_period_start, status, started_at,
        created_at, updated_at
      ) VALUES (
        ${auditId}, ${input.organisationId}, ${input.centreId}, ${version.id},
        ${input.actorPrincipalId}, ${period}::date, 'DRAFT', ${at}, ${at}, ${at}
      )
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "quarterly_audit.started",
      resourceType: "quarterly_audit",
      resourceId: auditId,
      scopeType: "centre",
      scopeId: input.centreId,
      context: { templatePinned: true },
      occurredAt: at,
    });
    return { auditId, status: "DRAFT", created: true };
  });
}

export async function saveAuditResponse(input: {
  organisationId: string;
  actorPrincipalId: string;
  request: SaveAuditResponseRequest;
  at?: Date;
}): Promise<SaveAuditResponseResponse> {
  const at = input.at ?? new Date();
  if (!AUDIT_OUTCOMES.includes(input.request.outcome)) {
    throw new QuarterlyReviewError("invalid_input", "outcome is invalid");
  }
  const comment = optionalTrimmedText(input.request.comment, "comment", 2000);
  const location = optionalTrimmedText(input.request.locationContext, "location context", 300);
  const responseCorrectionReason = optionalTrimmedText(
    input.request.responseCorrectionReason,
    "response correction reason",
    1000,
  );
  const ownerId = input.request.selectedOwnerPrincipalId
    ? requireUuid(input.request.selectedOwnerPrincipalId, "selected owner")
    : undefined;

  return inSerializableTransaction(async (transaction) => {
    const configuration = await loadResponseConfiguration(transaction, {
      organisationId: input.organisationId,
      auditId: input.request.auditId,
      itemId: input.request.itemId,
      outcome: input.request.outcome,
    });
    if (!configuration.permitted) throw new QuarterlyReviewError("invalid_input", "outcome is not permitted");
    if (!['DRAFT', 'IN_PROGRESS'].includes(configuration.audit_status)) {
      throw new QuarterlyReviewError("invalid_state", "audit responses are locked");
    }
    if (configuration.auditor_principal_id !== input.actorPrincipalId) {
      throw new QuarterlyReviewError("access_denied", "audit is not assigned to this auditor");
    }
    if (configuration.requires_reason && !comment) {
      throw new QuarterlyReviewError("invalid_input", "a reason is required for this outcome");
    }
    const withdrawsActiveFinding = Boolean(
      configuration.existing_finding_id &&
      configuration.existing_finding_status === "OPEN" &&
      !configuration.creates_finding,
    );
    if (withdrawsActiveFinding && !responseCorrectionReason) {
      throw new QuarterlyReviewError(
        "invalid_input",
        "a response correction reason is required",
      );
    }
    if (
      configuration.existing_response_id &&
      input.request.responseLockVersion !== configuration.existing_lock_version
    ) {
      throw new QuarterlyReviewError("version_conflict", "audit response changed");
    }
    if (!configuration.existing_response_id && input.request.responseLockVersion !== undefined) {
      throw new QuarterlyReviewError("version_conflict", "audit response changed");
    }

    const responseId = configuration.existing_response_id ?? randomUUID();
    const candidates = await listRemediationOwnerCandidatesFromSnapshot(
      transaction,
      input.organisationId,
      configuration.centre_id,
      at,
      true,
    );
    if (ownerId && !candidates.some((candidate) => candidate.principalId === ownerId)) {
      throw new QuarterlyReviewError("access_denied", "selected owner is not available");
    }
    const resolvedOwnerId = ownerId ?? (candidates.length === 1 ? candidates[0].principalId : undefined);
    if (configuration.existing_response_id) {
      await transaction.exec`
        UPDATE audit_responses
        SET outcome = ${input.request.outcome}, comment = ${comment ?? null},
            location_context = ${location ?? null},
            selected_owner_principal_id = ${resolvedOwnerId ?? null},
            responded_by_principal_id = ${input.actorPrincipalId},
            updated_at = ${at}, lock_version = lock_version + 1
        WHERE organisation_id = ${input.organisationId} AND id = ${responseId}
      `;
    } else {
      await transaction.exec`
        INSERT INTO audit_responses (
          id, organisation_id, audit_run_id, audit_item_id, outcome, comment,
          location_context, selected_owner_principal_id, responded_by_principal_id
          , created_at, updated_at
        ) VALUES (
          ${responseId}, ${input.organisationId}, ${input.request.auditId},
          ${input.request.itemId}, ${input.request.outcome}, ${comment ?? null},
          ${location ?? null}, ${resolvedOwnerId ?? null}, ${input.actorPrincipalId},
          ${at}, ${at}
        )
      `;
    }
    await transaction.exec`
      UPDATE audit_runs
      SET status = 'IN_PROGRESS', updated_at = ${at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.request.auditId}
        AND status IN ('DRAFT', 'IN_PROGRESS')
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: configuration.existing_response_id
        ? "quarterly_audit.response_updated"
        : "quarterly_audit.response_created",
      resourceType: "quarterly_audit",
      resourceId: input.request.auditId,
      scopeType: "centre",
      scopeId: configuration.centre_id,
      context: {
        itemLineageKey: configuration.lineage_key,
        outcome: input.request.outcome,
        outcomeChanged:
          configuration.existing_outcome !== null &&
          configuration.existing_outcome !== input.request.outcome,
      },
      occurredAt: at,
    });

    if (
      withdrawsActiveFinding &&
      configuration.existing_finding_id &&
      responseCorrectionReason
    ) {
      await withdrawFindingAndAction(transaction, {
        organisationId: input.organisationId,
        centreId: configuration.centre_id,
        findingId: configuration.existing_finding_id,
        actionId: configuration.existing_action_id,
        actionStatus: configuration.existing_action_status,
        actorPrincipalId: input.actorPrincipalId,
        reason: responseCorrectionReason,
        occurredAt: at,
      });
    }

    const createNow =
      configuration.immediate ||
      (configuration.critical &&
        input.request.outcome === "NOT_OBSERVED" &&
        configuration.creates_action);
    const generated = createNow
      ? await ensureFindingAndAction(transaction, {
          configuration,
          responseId,
          actorPrincipalId: input.actorPrincipalId,
          ...(resolvedOwnerId ? { ownerPrincipalId: resolvedOwnerId } : {}),
          occurredAt: at,
          immediate: true,
        })
      : { findingCreated: false, actionCreated: false, ownerResolutionRequired: false };
    return {
      responseId,
      lockVersion: (configuration.existing_lock_version ?? 0) + 1,
      auditStatus: "IN_PROGRESS",
      immediateFindingCreated: generated.findingCreated,
      immediateActionCreated: generated.actionCreated,
      ownerResolutionRequired: generated.ownerResolutionRequired,
    };
  });
}

interface FinalisationRow {
  item_id: string;
  section_id: string;
  lineage_key: string;
  wording: string;
  source_classification: string;
  scoring_weight: number | string;
  scored: boolean;
  critical: boolean;
  evidence_requirement: "none" | "optional" | "required";
  response_id: string | null;
  outcome: AuditOutcome | null;
  comment: string | null;
  selected_owner_principal_id: string | null;
  creates_finding: boolean | null;
  creates_action: boolean | null;
  immediate: boolean | null;
  severity: FindingSeverity | null;
  due_days: number | null;
  independent_verification_required: boolean | null;
  required_remediation: string | null;
  requires_reason: boolean | null;
  score_factor: number | string | null;
  denominator_treatment: "included" | "excluded" | null;
}

async function loadFinalisationRows(
  transaction: Transaction,
  input: { organisationId: string; auditId: string; templateVersionId: string; scoringPolicyId: string },
): Promise<FinalisationRow[]> {
  return transaction.queryAll<FinalisationRow>`
    SELECT
      item.id AS item_id, item.section_id, item.lineage_key, item.wording,
      item.source_classification, item.scoring_weight, item.scored, item.critical,
      item.evidence_requirement, response.id AS response_id, response.outcome,
      response.comment, response.selected_owner_principal_id,
      configuration.creates_finding, configuration.creates_action,
      configuration.immediate, configuration.severity, configuration.due_days,
      configuration.independent_verification_required,
      configuration.required_remediation, scoring.requires_reason,
      scoring.score_factor, scoring.denominator_treatment
    FROM audit_template_items AS item
    LEFT JOIN audit_responses AS response
      ON response.organisation_id = item.organisation_id
     AND response.audit_run_id = ${input.auditId}
     AND response.audit_item_id = item.id
    LEFT JOIN audit_item_outcome_configurations AS configuration
      ON configuration.organisation_id = item.organisation_id
     AND configuration.audit_item_id = item.id
     AND configuration.outcome = response.outcome
     AND configuration.permitted
    LEFT JOIN audit_scoring_outcome_rules AS scoring
      ON scoring.organisation_id = item.organisation_id
     AND scoring.scoring_policy_id = ${input.scoringPolicyId}
     AND scoring.outcome = response.outcome
    WHERE item.organisation_id = ${input.organisationId}
      AND item.template_version_id = ${input.templateVersionId}
    ORDER BY item.section_id, item.sort_order
  `;
}

async function ensureAuditReady(input: {
  organisationId: string;
  auditId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  at: Date;
}): Promise<AuditStatusTransitionResponse> {
  return inSerializableTransaction(async (transaction) => {
    const run = await transaction.queryRow<{
      status: AuditStatus; lock_version: number; template_version_id: string;
      scoring_policy_id: string; auditor_principal_id: string; centre_id: string;
    }>`
      SELECT run.status, run.lock_version, run.template_version_id,
             version.scoring_policy_id, run.auditor_principal_id, run.centre_id
      FROM audit_runs AS run
      JOIN audit_template_versions AS version
        ON version.organisation_id = run.organisation_id AND version.id = run.template_version_id
      WHERE run.organisation_id = ${input.organisationId} AND run.id = ${input.auditId}
      FOR UPDATE OF run
    `;
    if (!run) throw new QuarterlyReviewError("not_found", "audit is not available");
    if (run.auditor_principal_id !== input.actorPrincipalId) {
      throw new QuarterlyReviewError("access_denied", "audit is not assigned to this auditor");
    }
    if (!['DRAFT', 'IN_PROGRESS'].includes(run.status)) {
      throw new QuarterlyReviewError("invalid_state", "audit cannot be submitted for review");
    }
    if (run.lock_version !== input.expectedLockVersion) {
      throw new QuarterlyReviewError("version_conflict", "audit changed");
    }
    const candidates = await listRemediationOwnerCandidatesFromSnapshot(
      transaction,
      input.organisationId,
      run.centre_id,
      input.at,
      true,
    );
    const rows = await loadFinalisationRows(transaction, {
      organisationId: input.organisationId,
      auditId: input.auditId,
      templateVersionId: run.template_version_id,
      scoringPolicyId: run.scoring_policy_id,
    });
    const issues: string[] = [];
    for (const row of rows) {
      if (!row.response_id || !row.outcome || !row.denominator_treatment) {
        issues.push(row.item_id);
        continue;
      }
      if (row.requires_reason && !row.comment?.trim()) issues.push(row.item_id);
      if (row.creates_action) {
        const owner = row.selected_owner_principal_id ??
          (candidates.length === 1 ? candidates[0].principalId : null);
        if (!owner || !candidates.some((candidate) => candidate.principalId === owner)) {
          issues.push(row.item_id);
        }
      }
      if (row.critical && row.outcome === "NOT_OBSERVED") {
        const generated = await transaction.queryRow<{ finding_id: string; action_id: string }>`
          SELECT finding.id AS finding_id, action.id AS action_id
          FROM findings AS finding
          JOIN corrective_actions AS action
            ON action.organisation_id = finding.organisation_id AND action.finding_id = finding.id
          WHERE finding.organisation_id = ${input.organisationId}
            AND finding.audit_response_id = ${row.response_id}
            AND finding.status = 'OPEN'
            AND action.status <> 'WITHDRAWN'
        `;
        if (!generated) issues.push(row.item_id);
      }
    }
    if (issues.length > 0) {
      throw new QuarterlyReviewError(
        candidates.length === 1 ? "incomplete_audit" : "owner_resolution_required",
        "audit has incomplete responses or unresolved action owners",
      );
    }
    await transaction.exec`
      UPDATE audit_runs
      SET status = 'READY_FOR_REVIEW', ready_at = ${input.at},
          updated_at = ${input.at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.auditId}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "quarterly_audit.ready_for_review",
      resourceType: "quarterly_audit",
      resourceId: input.auditId,
      scopeType: "centre",
      scopeId: run.centre_id,
      context: { responseValidationPassed: true },
      occurredAt: input.at,
    });
    return { status: "READY_FOR_REVIEW", lockVersion: run.lock_version + 1 };
  });
}

export async function markAuditReady(input: {
  organisationId: string;
  auditId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  at?: Date;
}): Promise<AuditStatusTransitionResponse> {
  return ensureAuditReady({ ...input, at: input.at ?? new Date() });
}

export async function finaliseQuarterlyAudit(input: {
  organisationId: string;
  auditId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  at?: Date;
}): Promise<FinaliseQuarterlyAuditResponse> {
  const at = input.at ?? new Date();
  return inSerializableTransaction(async (transaction) => {
    const run = await transaction.queryRow<{
      status: AuditStatus; lock_version: number; template_version_id: string;
      scoring_policy_id: string; rounding_scale: number; auditor_principal_id: string;
      centre_id: string;
    }>`
      SELECT run.status, run.lock_version, run.template_version_id,
             version.scoring_policy_id, policy.rounding_scale,
             run.auditor_principal_id, run.centre_id
      FROM audit_runs AS run
      JOIN audit_template_versions AS version
        ON version.organisation_id = run.organisation_id AND version.id = run.template_version_id
      JOIN audit_scoring_policies AS policy
        ON policy.organisation_id = version.organisation_id AND policy.id = version.scoring_policy_id
      WHERE run.organisation_id = ${input.organisationId} AND run.id = ${input.auditId}
      FOR UPDATE OF run
    `;
    if (!run) throw new QuarterlyReviewError("not_found", "audit is not available");
    if (run.auditor_principal_id !== input.actorPrincipalId) {
      throw new QuarterlyReviewError("access_denied", "audit is not assigned to this auditor");
    }
    if (run.status !== "READY_FOR_REVIEW") {
      throw new QuarterlyReviewError("invalid_state", "audit is not ready for finalisation");
    }
    if (run.lock_version !== input.expectedLockVersion) {
      throw new QuarterlyReviewError("version_conflict", "audit changed");
    }
    const candidates = await listRemediationOwnerCandidatesFromSnapshot(
      transaction,
      input.organisationId,
      run.centre_id,
      at,
      true,
    );
    const rows = await loadFinalisationRows(transaction, {
      organisationId: input.organisationId,
      auditId: input.auditId,
      templateVersionId: run.template_version_id,
      scoringPolicyId: run.scoring_policy_id,
    });
    if (rows.some((row) => !row.response_id || !row.outcome || !row.denominator_treatment)) {
      throw new QuarterlyReviewError("incomplete_audit", "audit responses are incomplete");
    }

    const scoreItems: ScoreableAuditItem[] = [];
    for (const row of rows) {
      const owner = row.selected_owner_principal_id ??
        (candidates.length === 1 ? candidates[0].principalId : undefined);
      if (row.creates_action && (!owner || !candidates.some((candidate) => candidate.principalId === owner))) {
        throw new QuarterlyReviewError(
          "owner_resolution_required",
          "an authorised remediation owner must be selected",
        );
      }
      const generated = row.creates_finding && row.response_id
        ? await ensureFindingAndAction(transaction, {
            configuration: {
              organisation_id: input.organisationId,
              centre_id: run.centre_id,
              audit_run_id: input.auditId,
              item_id: row.item_id,
              lineage_key: row.lineage_key,
              wording: row.wording,
              source_classification: row.source_classification,
              severity: row.severity,
              due_days: row.due_days,
              independent_verification_required:
                row.independent_verification_required ?? false,
              required_remediation: row.required_remediation,
              evidence_requirement: row.evidence_requirement,
              creates_finding: row.creates_finding,
              creates_action: row.creates_action ?? false,
            },
            responseId: row.response_id,
            actorPrincipalId: input.actorPrincipalId,
            ...(owner ? { ownerPrincipalId: owner } : {}),
            occurredAt: at,
            immediate: row.immediate ?? false,
          })
        : {
            findingCreated: false,
            actionCreated: false,
            ownerResolutionRequired: false,
            severity: undefined,
          };
      if (row.outcome === "POSITIVE_PRACTICE" && row.response_id) {
        await transaction.exec`
          INSERT INTO positive_observations (
            id, organisation_id, centre_id, audit_run_id, audit_response_id,
            description, created_by_principal_id, created_at
          ) VALUES (
            ${randomUUID()}, ${input.organisationId}, ${run.centre_id},
            ${input.auditId}, ${row.response_id}, ${row.comment ?? row.wording},
            ${input.actorPrincipalId}, ${at}
          ) ON CONFLICT (organisation_id, audit_response_id) DO NOTHING
        `;
      }
      scoreItems.push({
        itemId: row.item_id,
        sectionId: row.section_id,
        weight: Number(row.scoring_weight),
        scored: row.scored,
        critical: row.critical,
        outcome: row.outcome!,
        ...(row.comment ? { comment: row.comment } : {}),
        ...(generated.severity ? { findingSeverity: generated.severity } : {}),
        findingCreated: row.creates_finding ? true : generated.findingCreated,
        actionCreated: row.creates_action ? true : generated.actionCreated,
      });
    }

    const outcomeRules = await transaction.queryAll<{
      outcome: AuditOutcome; score_factor: number | string | null;
      denominator_treatment: "included" | "excluded"; requires_reason: boolean;
    }>`
      SELECT outcome, score_factor, denominator_treatment, requires_reason
      FROM audit_scoring_outcome_rules
      WHERE organisation_id = ${input.organisationId}
        AND scoring_policy_id = ${run.scoring_policy_id}
    `;
    const bands = await transaction.queryAll<{
      band_code: string; label: string; minimum_score: number | string;
      maximum_score: number | string; priority: number;
    }>`
      SELECT band_code, label, minimum_score, maximum_score, priority
      FROM audit_performance_bands
      WHERE organisation_id = ${input.organisationId}
        AND scoring_policy_id = ${run.scoring_policy_id}
    `;
    const scoring = calculateAuditScore({
      items: scoreItems,
      outcomeRules: outcomeRules.map((rule): ScoringOutcomeRule => ({
        outcome: rule.outcome,
        scoreFactor: rule.score_factor === null ? null : Number(rule.score_factor),
        denominatorTreatment: rule.denominator_treatment,
        requiresReason: rule.requires_reason,
      })),
      bands: bands.map((band): PerformanceBand => ({
        code: band.band_code, label: band.label,
        minimumScore: Number(band.minimum_score), maximumScore: Number(band.maximum_score),
        priority: band.priority,
      })),
      roundingScale: run.rounding_scale,
    });
    if (scoring.validationIssues.length > 0) {
      throw new QuarterlyReviewError("incomplete_audit", "audit validation failed");
    }
    await transaction.exec`
      DELETE FROM audit_section_results
      WHERE organisation_id = ${input.organisationId} AND audit_run_id = ${input.auditId}
    `;
    for (const section of scoring.sections) {
      await transaction.exec`
        INSERT INTO audit_section_results (
          organisation_id, audit_run_id, section_id, eligible_weight,
          achieved_weight, score, coverage_percent, created_at
        ) VALUES (
          ${input.organisationId}, ${input.auditId}, ${section.sectionId},
          ${section.eligibleWeight}, ${section.achievedWeight}, ${section.score},
          ${section.coveragePercent}, ${at}
        )
      `;
    }
    const actionCount = await transaction.queryRow<{ count: number | string }>`
      SELECT count(*) AS count FROM corrective_actions AS action
      JOIN findings AS finding
        ON finding.organisation_id = action.organisation_id AND finding.id = action.finding_id
      WHERE finding.organisation_id = ${input.organisationId}
        AND finding.audit_run_id = ${input.auditId}
        AND finding.status = 'OPEN'
        AND action.status <> 'WITHDRAWN'
    `;
    await transaction.exec`
      UPDATE audit_runs
      SET status = 'FINALISED', finalised_at = ${at},
          finalised_by_principal_id = ${input.actorPrincipalId},
          overall_score = ${scoring.overallScore},
          performance_band_code = ${scoring.band?.code ?? null},
          performance_band_label = ${scoring.band?.label ?? null},
          risk_status = ${scoring.riskStatus},
          coverage_percent = ${scoring.coveragePercent},
          critical_finding_count = ${scoring.criticalFindingCount},
          high_finding_count = ${scoring.highFindingCount},
          action_count = ${Number(actionCount?.count ?? 0)},
          positive_practice_count = ${scoring.positivePracticeCount},
          updated_at = ${at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.auditId}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "quarterly_audit.finalised",
      resourceType: "quarterly_audit",
      resourceId: input.auditId,
      scopeType: "centre",
          scopeId: run.centre_id,
      context: {
        score: scoring.overallScore,
        riskStatus: scoring.riskStatus,
        methodologyPinned: true,
      },
      occurredAt: at,
    });
    return {
      auditId: input.auditId,
      status: "FINALISED",
      score: scoring.overallScore,
      riskStatus: scoring.riskStatus,
    };
  });
}

interface ActionMutationRow {
  id: string;
  centre_id: string;
  finding_id: string;
  owner_principal_id: string | null;
  status: CorrectiveActionStatus;
  severity: FindingSeverity;
  evidence_requirement: "none" | "optional" | "required";
  independent_verification_required: boolean;
  remediation_submitted_by_principal_id: string | null;
  lock_version: number;
}

async function loadActionForUpdate(
  transaction: Transaction,
  organisationId: string,
  actionId: string,
): Promise<ActionMutationRow> {
  const row = await transaction.queryRow<ActionMutationRow>`
    SELECT action.id, action.centre_id, action.finding_id,
           action.owner_principal_id, action.status, action.severity,
           action.evidence_requirement,
           (
             action.independent_verification_required
             OR action.severity = 'CRITICAL'
             OR COALESCE(configuration.immediate, FALSE)
           ) AS independent_verification_required,
           action.remediation_submitted_by_principal_id, action.lock_version
    FROM corrective_actions AS action
    JOIN findings AS finding
      ON finding.organisation_id = action.organisation_id
     AND finding.id = action.finding_id
    JOIN audit_responses AS response
      ON response.organisation_id = finding.organisation_id
     AND response.id = finding.audit_response_id
    LEFT JOIN audit_item_outcome_configurations AS configuration
      ON configuration.organisation_id = response.organisation_id
     AND configuration.audit_item_id = response.audit_item_id
     AND configuration.outcome = response.outcome
    WHERE action.organisation_id = ${organisationId} AND action.id = ${actionId}
    FOR UPDATE OF action
  `;
  if (!row) throw new QuarterlyReviewError("not_found", "action is not available");
  return row;
}

function requireActionVersion(row: ActionMutationRow, expected: number): void {
  if (row.lock_version !== expected) {
    throw new QuarterlyReviewError("version_conflict", "corrective action changed");
  }
}

export async function startCorrectiveAction(input: {
  organisationId: string;
  actionId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  at?: Date;
}): Promise<ActionTransitionResponse> {
  const at = input.at ?? new Date();
  return inSerializableTransaction(async (transaction) => {
    const action = await loadActionForUpdate(transaction, input.organisationId, input.actionId);
    requireActionVersion(action, input.expectedLockVersion);
    if (action.owner_principal_id !== input.actorPrincipalId) {
      throw new QuarterlyReviewError("access_denied", "action is not assigned to this principal");
    }
    if (!["OPEN", "MORE_INFORMATION_REQUIRED", "REJECTED"].includes(action.status)) {
      throw new QuarterlyReviewError("invalid_state", "action cannot be started");
    }
    await transaction.exec`
      UPDATE corrective_actions
      SET status = 'IN_PROGRESS', updated_at = ${at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.actionId}
    `;
    await recordActionEvent(transaction, {
      organisationId: input.organisationId, actionId: input.actionId,
      actorPrincipalId: input.actorPrincipalId, eventType: "remediation.started",
      fromStatus: action.status, toStatus: "IN_PROGRESS", occurredAt: at,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.started",
      resourceType: "corrective_action",
      resourceId: input.actionId,
      scopeType: "centre",
      scopeId: action.centre_id,
      context: {}, occurredAt: at,
    });
    return { actionId: input.actionId, status: "IN_PROGRESS", lockVersion: action.lock_version + 1 };
  });
}

export async function submitCorrectiveAction(input: {
  organisationId: string;
  actionId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  remediationNote: string;
  at?: Date;
}): Promise<ActionTransitionResponse> {
  const at = input.at ?? new Date();
  const note = optionalTrimmedText(input.remediationNote, "remediation note", 1000)!;
  return inSerializableTransaction(async (transaction) => {
    const action = await loadActionForUpdate(transaction, input.organisationId, input.actionId);
    requireActionVersion(action, input.expectedLockVersion);
    if (action.owner_principal_id !== input.actorPrincipalId) {
      throw new QuarterlyReviewError("access_denied", "action is not assigned to this principal");
    }
    if (action.status !== "IN_PROGRESS") {
      throw new QuarterlyReviewError("invalid_state", "action is not in progress");
    }
    if (action.evidence_requirement === "required") {
      const uploaded = await transaction.queryRow<{ count: number | string }>`
        SELECT count(*) AS count
        FROM corrective_action_evidence AS link
        JOIN evidence_items AS evidence
          ON evidence.organisation_id = link.organisation_id
         AND evidence.id = link.evidence_item_id
        WHERE link.organisation_id = ${input.organisationId}
          AND link.corrective_action_id = ${input.actionId}
          AND evidence.upload_status = 'UPLOADED'
          AND evidence.availability_status IN ('AVAILABLE_LOCAL_UNSCANNED', 'AVAILABLE')
      `;
      if (Number(uploaded?.count ?? 0) === 0) {
        throw new QuarterlyReviewError("invalid_state", "required remediation evidence is missing");
      }
    }
    await transaction.exec`
      UPDATE corrective_actions
      SET status = 'VERIFICATION_REQUIRED',
          remediation_submitted_by_principal_id = ${input.actorPrincipalId},
          remediation_submitted_at = ${at}, updated_at = ${at},
          lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.actionId}
    `;
    await recordActionEvent(transaction, {
      organisationId: input.organisationId, actionId: input.actionId,
      actorPrincipalId: input.actorPrincipalId,
      eventType: "remediation.submitted_for_verification",
      fromStatus: "IN_PROGRESS", toStatus: "VERIFICATION_REQUIRED",
      reason: note, occurredAt: at,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.evidence_submitted",
      resourceType: "corrective_action", resourceId: input.actionId,
      scopeType: "centre", scopeId: action.centre_id,
      context: { verificationRequested: true }, occurredAt: at,
    });
    return {
      actionId: input.actionId,
      status: "VERIFICATION_REQUIRED",
      lockVersion: action.lock_version + 1,
    };
  });
}

export async function verifyAndCloseCorrectiveAction(input: {
  organisationId: string;
  actionId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  verificationNote?: string;
  at?: Date;
}): Promise<ActionTransitionResponse> {
  const at = input.at ?? new Date();
  const note = optionalTrimmedText(input.verificationNote, "verification note", 1000);
  return inSerializableTransaction(async (transaction) => {
    const action = await loadActionForUpdate(transaction, input.organisationId, input.actionId);
    requireActionVersion(action, input.expectedLockVersion);
    if (action.status !== "VERIFICATION_REQUIRED") {
      throw new QuarterlyReviewError("invalid_state", "action is not awaiting verification");
    }
    if (
      action.independent_verification_required &&
      action.remediation_submitted_by_principal_id === input.actorPrincipalId
    ) {
      throw new QuarterlyReviewError("access_denied", "independent verification is required");
    }
    await transaction.exec`
      UPDATE corrective_actions
      SET status = 'CLOSED', verified_by_principal_id = ${input.actorPrincipalId},
          verified_at = ${at}, closed_at = ${at}, updated_at = ${at},
          lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.actionId}
    `;
    await transaction.exec`
      UPDATE findings
      SET status = 'RESOLVED', updated_at = ${at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${action.finding_id}
    `;
    await recordActionEvent(transaction, {
      organisationId: input.organisationId, actionId: input.actionId,
      actorPrincipalId: input.actorPrincipalId,
      eventType: "remediation.verified_and_closed",
      fromStatus: "VERIFICATION_REQUIRED", toStatus: "CLOSED",
      reason: note, occurredAt: at,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.closed",
      resourceType: "corrective_action", resourceId: input.actionId,
      scopeType: "centre", scopeId: action.centre_id,
      context: { independentVerification: action.independent_verification_required },
      occurredAt: at,
    });
    return { actionId: input.actionId, status: "CLOSED", lockVersion: action.lock_version + 1 };
  });
}

export async function returnCorrectiveAction(input: {
  organisationId: string;
  actionId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  reason: string;
  disposition: "MORE_INFORMATION_REQUIRED" | "REJECTED";
  at?: Date;
}): Promise<ActionTransitionResponse> {
  const at = input.at ?? new Date();
  const reason = optionalTrimmedText(input.reason, "return reason", 1000)!;
  return inSerializableTransaction(async (transaction) => {
    const action = await loadActionForUpdate(transaction, input.organisationId, input.actionId);
    requireActionVersion(action, input.expectedLockVersion);
    if (action.status !== "VERIFICATION_REQUIRED") {
      throw new QuarterlyReviewError("invalid_state", "action is not awaiting verification");
    }
    if (
      action.independent_verification_required &&
      action.remediation_submitted_by_principal_id === input.actorPrincipalId
    ) {
      throw new QuarterlyReviewError("access_denied", "independent review is required");
    }
    await transaction.exec`
      UPDATE corrective_actions
      SET status = ${input.disposition}, updated_at = ${at}, lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.actionId}
    `;
    await recordActionEvent(transaction, {
      organisationId: input.organisationId, actionId: input.actionId,
      actorPrincipalId: input.actorPrincipalId, eventType: "remediation.returned",
      fromStatus: "VERIFICATION_REQUIRED", toStatus: input.disposition,
      reason, occurredAt: at,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "corrective_action.returned",
      resourceType: "corrective_action", resourceId: input.actionId,
      scopeType: "centre", scopeId: action.centre_id,
      context: { disposition: input.disposition }, occurredAt: at,
    });
    return { actionId: input.actionId, status: input.disposition, lockVersion: action.lock_version + 1 };
  });
}

export async function acknowledgeAudit(input: {
  organisationId: string;
  centreId: string;
  auditId: string;
  actorPrincipalId: string;
  comment?: string;
  at?: Date;
}): Promise<AcknowledgeAuditResponse> {
  const at = input.at ?? new Date();
  const comment = optionalTrimmedText(input.comment, "acknowledgement comment", 1000);
  return inSerializableTransaction(async (transaction) => {
    const run = await transaction.queryRow<{ status: AuditStatus }>`
      SELECT status FROM audit_runs
      WHERE organisation_id = ${input.organisationId}
        AND centre_id = ${input.centreId} AND id = ${input.auditId}
      FOR SHARE
    `;
    if (!run) throw new QuarterlyReviewError("not_found", "audit is not available");
    if (run.status !== "FINALISED") {
      throw new QuarterlyReviewError("invalid_state", "only a finalised audit can be acknowledged");
    }
    const existing = await transaction.queryRow<{ id: string; acknowledged_at: Date }>`
      SELECT id, acknowledged_at FROM audit_acknowledgements
      WHERE organisation_id = ${input.organisationId}
        AND audit_run_id = ${input.auditId}
        AND principal_id = ${input.actorPrincipalId}
    `;
    if (existing) {
      return { acknowledgementId: existing.id, acknowledgedAt: existing.acknowledged_at.toISOString() };
    }
    const id = randomUUID();
    await transaction.exec`
      INSERT INTO audit_acknowledgements (
        id, organisation_id, centre_id, audit_run_id, principal_id,
        comment, acknowledged_at
      ) VALUES (
        ${id}, ${input.organisationId}, ${input.centreId}, ${input.auditId},
        ${input.actorPrincipalId}, ${comment ?? null}, ${at}
      )
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.actorPrincipalId,
      action: "quarterly_audit.acknowledged",
      resourceType: "audit_acknowledgement", resourceId: id,
      scopeType: "centre", scopeId: input.centreId,
      context: { meaning: "reviewed_not_legal_agreement" }, occurredAt: at,
    });
    return { acknowledgementId: id, acknowledgedAt: at.toISOString() };
  });
}

export async function loadComplianceOversight(
  organisationId: string,
  at: Date = new Date(),
): Promise<ComplianceOversightResponse> {
  const counts = await centreSuccessDB.queryRow<{
    completed: number | string; in_progress: number | string; outstanding: number | string;
    below_threshold: number | string; critical_findings: number | string;
    high_findings: number | string; open_actions: number | string;
    overdue_actions: number | string; awaiting_verification: number | string;
  }>`
    SELECT
      count(*) FILTER (WHERE run.status = 'FINALISED') AS completed,
      count(*) FILTER (WHERE run.status IN ('DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW')) AS in_progress,
      (SELECT count(*) FROM centres AS centre
       WHERE centre.organisation_id = ${organisationId} AND centre.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM audit_runs AS current_run
           WHERE current_run.organisation_id = centre.organisation_id
             AND current_run.centre_id = centre.id
             AND current_run.review_period_start = ${quarterStart(at)}::date
         )) AS outstanding,
      count(*) FILTER (
        WHERE run.status = 'FINALISED'
          AND EXISTS (
            SELECT 1
            FROM audit_template_versions AS version
            JOIN audit_performance_bands AS band
              ON band.organisation_id = version.organisation_id
             AND band.scoring_policy_id = version.scoring_policy_id
             AND band.band_code = run.performance_band_code
            WHERE version.organisation_id = run.organisation_id
              AND version.id = run.template_version_id
              AND band.below_internal_threshold
          )
      ) AS below_threshold,
      COALESCE((SELECT count(*) FROM findings WHERE organisation_id = ${organisationId}
                AND severity = 'CRITICAL' AND status = 'OPEN'), 0) AS critical_findings,
      COALESCE((SELECT count(*) FROM findings WHERE organisation_id = ${organisationId}
                AND severity = 'HIGH' AND status = 'OPEN'), 0) AS high_findings,
      COALESCE((SELECT count(*) FROM corrective_actions WHERE organisation_id = ${organisationId}
                AND status NOT IN ('CLOSED', 'WITHDRAWN')), 0) AS open_actions,
      COALESCE((SELECT count(*) FROM corrective_actions WHERE organisation_id = ${organisationId}
                AND status NOT IN ('CLOSED', 'WITHDRAWN') AND due_at < ${at}), 0) AS overdue_actions,
      COALESCE((SELECT count(*) FROM corrective_actions WHERE organisation_id = ${organisationId}
                AND status = 'VERIFICATION_REQUIRED'), 0) AS awaiting_verification
    FROM audit_runs AS run
    WHERE run.organisation_id = ${organisationId}
  `;
  const centres = await centreSuccessDB.queryAll<{
    centre_id: string; centre_name: string; latest_audit_id: string | null;
    latest_score: number | string | null; risk_status: ComplianceOversightResponse["centres"][number]["riskStatus"] | null;
    open_actions: number | string; overdue_actions: number | string;
  }>`
    SELECT centre.id AS centre_id, centre.name AS centre_name,
           latest.id AS latest_audit_id, latest.overall_score AS latest_score,
           latest.risk_status,
           (SELECT count(*) FROM corrective_actions AS action
            WHERE action.organisation_id = centre.organisation_id
              AND action.centre_id = centre.id
              AND action.status NOT IN ('CLOSED', 'WITHDRAWN')) AS open_actions,
           (SELECT count(*) FROM corrective_actions AS action
            WHERE action.organisation_id = centre.organisation_id
              AND action.centre_id = centre.id
              AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
              AND action.due_at < ${at}) AS overdue_actions
    FROM centres AS centre
    LEFT JOIN LATERAL (
      SELECT run.id, run.overall_score, run.risk_status
      FROM audit_runs AS run
      WHERE run.organisation_id = centre.organisation_id
        AND run.centre_id = centre.id AND run.status = 'FINALISED'
      ORDER BY run.finalised_at DESC LIMIT 1
    ) AS latest ON TRUE
    WHERE centre.organisation_id = ${organisationId} AND centre.status = 'active'
    ORDER BY centre.name, centre.id
  `;
  return {
    counts: {
      completed: Number(counts?.completed ?? 0), inProgress: Number(counts?.in_progress ?? 0),
      outstanding: Number(counts?.outstanding ?? 0),
      centresBelowInternalThreshold: Number(counts?.below_threshold ?? 0),
      criticalFindings: Number(counts?.critical_findings ?? 0),
      highFindings: Number(counts?.high_findings ?? 0),
      openCorrectiveActions: Number(counts?.open_actions ?? 0),
      overdueCorrectiveActions: Number(counts?.overdue_actions ?? 0),
      awaitingVerification: Number(counts?.awaiting_verification ?? 0),
    },
    centres: centres.map((centre) => ({
      centreId: centre.centre_id, centreName: centre.centre_name,
      ...(centre.latest_audit_id ? { latestAuditId: centre.latest_audit_id } : {}),
      ...(centre.latest_score !== null ? { latestScore: Number(centre.latest_score) } : {}),
      ...(centre.risk_status ? { riskStatus: centre.risk_status } : {}),
      openActions: Number(centre.open_actions), overdueActions: Number(centre.overdue_actions),
    })),
  };
}
