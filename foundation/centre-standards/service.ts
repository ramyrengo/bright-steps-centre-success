import { randomUUID } from "node:crypto";
import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { loadOrganisationCentreAuthorisationFacts } from "../authorization/batch-centres";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import type { AuthorisationQueryExecutor } from "../authorization/database";
import { authorise, type PrincipalAuthorisationContext } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { listRemediationOwnerCandidatesFromSnapshot } from "../quarterly-reviews/queries";
import { inSerializableTransaction } from "../transactions";
import type { AuditOutcome, FindingSeverity } from "../quarterly-reviews/types";
import type {
  CompleteStandardsCheckRequest,
  CompleteStandardsCheckResponse,
  OpenStandardsCheckSummary,
  StandardsAnswerOption,
  StandardsCheckDetailResponse,
  StandardsQuestion,
  StandardsRecordedResponse,
  StandardsWorkspaceResponse,
} from "./contracts";
import { formatLocalMinute } from "./time";
import {
  CentreStandardsError,
  deriveOperationalTimeliness,
  requireStandardsUuid,
  type OperationalOccurrenceStatus,
} from "./types";

interface StandardsExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<void>;
}

export interface PrincipalOrganisation {
  principalId: string;
  organisationId: string;
  context: PrincipalAuthorisationContext;
}

interface OccurrenceRow {
  id: string;
  organisation_id: string;
  centre_id: string;
  centre_name: string;
  centre_timezone: string;
  deployment_id: string;
  schedule_revision_id: string;
  template_version_id: string;
  standard_name: string;
  synthetic: boolean;
  synthetic_notice: string | null;
  business_date: string;
  opens_at: Date;
  due_at: Date;
  status: OperationalOccurrenceStatus;
  completed_by_principal_id: string | null;
  completed_at: Date | null;
  question_count: number | string;
}

interface QuestionConfigurationRow {
  item_id: string;
  wording: string;
  instructions: string | null;
  sort_order: number;
  outcome: AuditOutcome;
  creates_finding: boolean;
  creates_action: boolean;
  severity: FindingSeverity | null;
  due_days: number | null;
  independent_verification_required: boolean;
  required_remediation: string | null;
  source_classification: string;
}

interface ResponseRow {
  audit_item_id: string;
  wording: string;
  outcome: AuditOutcome;
}

export interface CentreStandardsDependencies {
  now: () => Date;
}

const runtimeDependencies: CentreStandardsDependencies = { now: () => new Date() };

function countedExecutor(transaction: Transaction, onQuery: () => void): StandardsExecutor {
  return {
    queryAll: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryAll(strings, ...values);
    }) as StandardsExecutor["queryAll"],
    queryRow: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryRow(strings, ...values);
    }) as StandardsExecutor["queryRow"],
    exec: async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      await transaction.exec(strings, ...values);
    },
  };
}

export async function loadPrincipalOrganisation(
  executor: StandardsExecutor,
  principalId: string,
  decisionAt: Date,
): Promise<PrincipalOrganisation> {
  const organisations = await executor.queryAll<{ organisation_id: string }>`
    SELECT DISTINCT membership.organisation_id
    FROM organisation_memberships AS membership
    JOIN organisations AS organisation ON organisation.id = membership.organisation_id
    JOIN principals AS principal ON principal.id = membership.principal_id
    WHERE membership.principal_id = ${principalId}
      AND principal.status = 'active'
      AND organisation.status = 'active'
      AND membership.status = 'active'
      AND membership.effective_from <= ${decisionAt}
      AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
    ORDER BY membership.organisation_id
  `;
  if (organisations.length !== 1) {
    throw new CentreStandardsError("access_denied", "Centre Standards is not available");
  }
  const organisationId = organisations[0].organisation_id;
  const context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
    principalId,
    activeOrganisationId: organisationId,
    at: decisionAt,
  });
  return { principalId, organisationId, context };
}

function centreDecision(input: {
  context: PrincipalAuthorisationContext;
  resource: Parameters<typeof authorise>[0]["resource"];
  decisionAt: Date;
  requestedCapability: typeof capability.operationalCheckRead | typeof capability.operationalCheckComplete;
}): boolean {
  return authorise({
    context: input.context,
    capability: input.requestedCapability,
    resource: input.resource,
    at: input.decisionAt,
  }).allowed;
}

function safeOutcomeOption(outcome: AuditOutcome): StandardsAnswerOption {
  const labels: Record<AuditOutcome, string> = {
    COMPLIANT: "No issue to report",
    PARTIALLY_COMPLIANT: "Report a partial synthetic test issue",
    NON_COMPLIANT: "Report a synthetic test issue",
    NOT_APPLICABLE: "Not applicable",
    NOT_OBSERVED: "Not observed",
    IMMEDIATE_ACTION_REQUIRED: "Report an immediate synthetic test issue",
    POSITIVE_PRACTICE: "Positive practice observed",
  };
  return { value: outcome, label: labels[outcome] };
}

function occurrenceSummary(
  row: OccurrenceRow,
  authority: { canComplete: boolean; canRead: boolean },
  decisionAt: Date,
): OpenStandardsCheckSummary {
  const timeliness = deriveOperationalTimeliness({
    status: row.status,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    decisionAt,
  });
  if (timeliness !== "DUE" && timeliness !== "OVERDUE") {
    throw new CentreStandardsError("context_unavailable", "open projection included completed work");
  }
  return {
    occurrenceId: row.id,
    standardName: row.standard_name,
    synthetic: row.synthetic,
    ...(row.synthetic_notice ? { syntheticNotice: row.synthetic_notice } : {}),
    centreName: row.centre_name,
    businessDate: row.business_date,
    dueLocalTime: formatLocalMinute(row.due_at, row.centre_timezone),
    timeliness,
    questionCount: Number(row.question_count),
    state: "OPEN",
    canComplete: authority.canComplete,
  };
}

async function loadOccurrenceRows(
  executor: StandardsExecutor,
  organisationId: string,
  centreIds: readonly string[],
  decisionAt: Date,
): Promise<OccurrenceRow[]> {
  return executor.queryAll<OccurrenceRow>`
    SELECT
      occurrence.id,
      occurrence.organisation_id,
      occurrence.centre_id,
      centre.name AS centre_name,
      occurrence.centre_timezone,
      occurrence.deployment_id,
      occurrence.schedule_revision_id,
      occurrence.template_version_id,
      version.title AS standard_name,
      version.synthetic,
      deployment.synthetic_notice,
      occurrence.business_date::text,
      occurrence.opens_at,
      occurrence.due_at,
      occurrence.status,
      occurrence.completed_by_principal_id,
      occurrence.completed_at,
      (
        SELECT count(*)
        FROM audit_template_items AS item
        WHERE item.organisation_id = occurrence.organisation_id
          AND item.template_version_id = occurrence.template_version_id
      ) AS question_count
    FROM operational_check_occurrences AS occurrence
    JOIN centres AS centre
      ON centre.organisation_id = occurrence.organisation_id
     AND centre.id = occurrence.centre_id
    JOIN operational_standard_deployments AS deployment
      ON deployment.organisation_id = occurrence.organisation_id
     AND deployment.centre_id = occurrence.centre_id
     AND deployment.id = occurrence.deployment_id
    JOIN audit_template_versions AS version
      ON version.organisation_id = occurrence.organisation_id
     AND version.id = occurrence.template_version_id
     AND version.template_subtype = 'OPERATIONAL_STANDARD'
    WHERE occurrence.organisation_id = ${organisationId}
      AND occurrence.centre_id = ANY(${centreIds}::uuid[])
      AND occurrence.status = 'OPEN'
      AND occurrence.opens_at <= ${decisionAt}
    ORDER BY occurrence.due_at, occurrence.id
  `;
}

export interface BuildStandardsWorkspaceResult {
  response: StandardsWorkspaceResponse;
  diagnostics: { queryCount: number };
}

export async function buildStandardsWorkspace(
  input: { principalId: string },
  dependencies: CentreStandardsDependencies = runtimeDependencies,
): Promise<BuildStandardsWorkspaceResult> {
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => { queryCount += 1; });
  const decisionAt = dependencies.now();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipalOrganisation(executor, input.principalId, decisionAt);
    const facts = await loadOrganisationCentreAuthorisationFacts(
      executor,
      principal.organisationId,
      decisionAt,
    );
    const centreAuthority = new Map<string, { canComplete: boolean; canRead: boolean }>();
    for (const centre of facts.centres) {
      const canComplete = centreDecision({
        context: principal.context,
        resource: centre.resource,
        decisionAt,
        requestedCapability: capability.operationalCheckComplete,
      });
      const explicitRead = centreDecision({
        context: principal.context,
        resource: centre.resource,
        decisionAt,
        requestedCapability: capability.operationalCheckRead,
      });
      if (canComplete || explicitRead) {
        centreAuthority.set(centre.id, { canComplete, canRead: true });
      }
    }
    const invalidAuthorised = facts.invalidCentres.filter((centre) => {
      const resource = {
        kind: "centre" as const,
        organisationId: principal.organisationId,
        centreId: centre.id,
        organisationalUnitIds: centre.organisationalUnitIds,
      };
      return centreDecision({
        context: principal.context,
        resource,
        decisionAt,
        requestedCapability: capability.operationalCheckComplete,
      }) || centreDecision({
        context: principal.context,
        resource,
        decisionAt,
        requestedCapability: capability.operationalCheckRead,
      });
    });
    const base = { cacheControl: "private, no-store" as const, asOf: decisionAt.toISOString() };
    if (centreAuthority.size === 0) {
      await transaction.commit();
      if (invalidAuthorised.length > 0) {
        return {
          response: {
            ...base,
            status: "partial",
            warning: "Some authorised centre check information could not be established safely.",
          },
          diagnostics: { queryCount },
        };
      }
      return { response: { ...base, status: "unsupported" }, diagnostics: { queryCount } };
    }
    const rows = await loadOccurrenceRows(
      executor,
      principal.organisationId,
      [...centreAuthority.keys()],
      decisionAt,
    );
    const openChecks = rows.map((row) =>
      occurrenceSummary(row, centreAuthority.get(row.centre_id)!, decisionAt));
    await transaction.commit();
    return {
      response: invalidAuthorised.length > 0
        ? {
            ...base,
            status: "partial",
            openChecks,
            warning: "Some authorised centre check information could not be established safely.",
          }
        : { ...base, status: "ready", openChecks },
      diagnostics: { queryCount },
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CentreStandardsError) throw error;
    throw new CentreStandardsError(
      "context_unavailable",
      "Centre Standards is temporarily unavailable",
      { cause: error },
    );
  }
}

async function loadOccurrence(
  executor: StandardsExecutor,
  organisationId: string,
  occurrenceId: string,
  lock: boolean,
): Promise<OccurrenceRow> {
  const row = lock
    ? await executor.queryRow<OccurrenceRow>`
        SELECT
          occurrence.id, occurrence.organisation_id, occurrence.centre_id,
          centre.name AS centre_name, occurrence.centre_timezone,
          occurrence.deployment_id, occurrence.schedule_revision_id,
          occurrence.template_version_id, version.title AS standard_name,
          version.synthetic, deployment.synthetic_notice,
          occurrence.business_date::text, occurrence.opens_at, occurrence.due_at, occurrence.status,
          occurrence.completed_by_principal_id, occurrence.completed_at,
          (SELECT count(*) FROM audit_template_items AS item
           WHERE item.organisation_id = occurrence.organisation_id
             AND item.template_version_id = occurrence.template_version_id) AS question_count
        FROM operational_check_occurrences AS occurrence
        JOIN centres AS centre ON centre.organisation_id = occurrence.organisation_id AND centre.id = occurrence.centre_id
        JOIN operational_standard_deployments AS deployment
          ON deployment.organisation_id = occurrence.organisation_id
         AND deployment.centre_id = occurrence.centre_id AND deployment.id = occurrence.deployment_id
        JOIN operational_standard_schedule_revisions AS schedule
          ON schedule.organisation_id = occurrence.organisation_id
         AND schedule.centre_id = occurrence.centre_id
         AND schedule.deployment_id = occurrence.deployment_id
         AND schedule.id = occurrence.schedule_revision_id
        JOIN audit_template_versions AS version
          ON version.organisation_id = occurrence.organisation_id
         AND version.id = occurrence.template_version_id
         AND version.template_subtype = 'OPERATIONAL_STANDARD'
        WHERE occurrence.organisation_id = ${organisationId} AND occurrence.id = ${occurrenceId}
        FOR UPDATE OF occurrence
      `
    : await executor.queryRow<OccurrenceRow>`
        SELECT
          occurrence.id, occurrence.organisation_id, occurrence.centre_id,
          centre.name AS centre_name, occurrence.centre_timezone,
          occurrence.deployment_id, occurrence.schedule_revision_id,
          occurrence.template_version_id, version.title AS standard_name,
          version.synthetic, deployment.synthetic_notice,
          occurrence.business_date::text, occurrence.opens_at, occurrence.due_at, occurrence.status,
          occurrence.completed_by_principal_id, occurrence.completed_at,
          (SELECT count(*) FROM audit_template_items AS item
           WHERE item.organisation_id = occurrence.organisation_id
             AND item.template_version_id = occurrence.template_version_id) AS question_count
        FROM operational_check_occurrences AS occurrence
        JOIN centres AS centre ON centre.organisation_id = occurrence.organisation_id AND centre.id = occurrence.centre_id
        JOIN operational_standard_deployments AS deployment
          ON deployment.organisation_id = occurrence.organisation_id
         AND deployment.centre_id = occurrence.centre_id AND deployment.id = occurrence.deployment_id
        JOIN operational_standard_schedule_revisions AS schedule
          ON schedule.organisation_id = occurrence.organisation_id
         AND schedule.centre_id = occurrence.centre_id
         AND schedule.deployment_id = occurrence.deployment_id
         AND schedule.id = occurrence.schedule_revision_id
        JOIN audit_template_versions AS version
          ON version.organisation_id = occurrence.organisation_id
         AND version.id = occurrence.template_version_id
         AND version.template_subtype = 'OPERATIONAL_STANDARD'
        WHERE occurrence.organisation_id = ${organisationId} AND occurrence.id = ${occurrenceId}
      `;
  if (!row) throw new CentreStandardsError("not_found", "check is not available");
  if (row.synthetic && !row.synthetic_notice) {
    throw new CentreStandardsError("context_unavailable", "synthetic notice is unavailable");
  }
  return row;
}

async function loadCentreAuthority(
  executor: StandardsExecutor,
  principal: PrincipalOrganisation,
  centreId: string,
  decisionAt: Date,
): Promise<{ canComplete: boolean; canRead: boolean }> {
  const facts = await loadOrganisationCentreAuthorisationFacts(
    executor,
    principal.organisationId,
    decisionAt,
  );
  const centre = facts.centres.find((candidate) => candidate.id === centreId);
  if (!centre) throw new CentreStandardsError("access_denied", "check is not available");
  const canComplete = centreDecision({
    context: principal.context,
    resource: centre.resource,
    decisionAt,
    requestedCapability: capability.operationalCheckComplete,
  });
  const canRead = canComplete || centreDecision({
    context: principal.context,
    resource: centre.resource,
    decisionAt,
    requestedCapability: capability.operationalCheckRead,
  });
  if (!canRead) throw new CentreStandardsError("access_denied", "check is not available");
  return { canComplete, canRead };
}

async function loadQuestionConfigurations(
  executor: StandardsExecutor,
  organisationId: string,
  templateVersionId: string,
): Promise<QuestionConfigurationRow[]> {
  return executor.queryAll<QuestionConfigurationRow>`
    SELECT
      item.id AS item_id,
      item.wording,
      item.instructions,
      item.sort_order,
      configuration.outcome,
      configuration.creates_finding,
      configuration.creates_action,
      configuration.severity,
      configuration.due_days,
      configuration.independent_verification_required,
      configuration.required_remediation,
      item.source_classification
    FROM audit_template_items AS item
    JOIN audit_item_outcome_configurations AS configuration
      ON configuration.organisation_id = item.organisation_id
     AND configuration.audit_item_id = item.id
     AND configuration.permitted
    WHERE item.organisation_id = ${organisationId}
      AND item.template_version_id = ${templateVersionId}
    ORDER BY item.sort_order, configuration.outcome
  `;
}

function buildQuestions(rows: readonly QuestionConfigurationRow[]): StandardsQuestion[] {
  const questions = new Map<string, StandardsQuestion>();
  for (const row of rows) {
    const question = questions.get(row.item_id) ?? {
      questionId: row.item_id,
      wording: row.wording,
      ...(row.instructions ? { instructions: row.instructions } : {}),
      options: [],
    };
    question.options.push(safeOutcomeOption(row.outcome));
    questions.set(row.item_id, question);
  }
  return [...questions.values()];
}

export async function loadStandardsCheckDetail(
  input: { principalId: string; occurrenceId: string },
  dependencies: CentreStandardsDependencies = runtimeDependencies,
): Promise<StandardsCheckDetailResponse> {
  const transaction = await centreSuccessDB.begin();
  const executor = countedExecutor(transaction, () => undefined);
  const decisionAt = dependencies.now();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipalOrganisation(executor, input.principalId, decisionAt);
    const occurrence = await loadOccurrence(
      executor,
      principal.organisationId,
      requireStandardsUuid(input.occurrenceId, "occurrence ID"),
      false,
    );
    if (occurrence.status === "OPEN" && occurrence.opens_at.getTime() > decisionAt.getTime()) {
      throw new CentreStandardsError("not_found", "check is not available");
    }
    const authority = await loadCentreAuthority(
      executor,
      principal,
      occurrence.centre_id,
      decisionAt,
    );
    const configurationRows = await loadQuestionConfigurations(
      executor,
      principal.organisationId,
      occurrence.template_version_id,
    );
    const responseRows = occurrence.status === "COMPLETED"
      ? await executor.queryAll<ResponseRow>`
          SELECT response.audit_item_id, item.wording, response.outcome
          FROM operational_check_responses AS response
          JOIN audit_template_items AS item
            ON item.organisation_id = response.organisation_id
           AND item.id = response.audit_item_id
          WHERE response.organisation_id = ${principal.organisationId}
            AND response.occurrence_id = ${occurrence.id}
          ORDER BY item.sort_order
        `
      : [];
    await transaction.commit();
    const timeliness = deriveOperationalTimeliness({
      status: occurrence.status,
      dueAt: occurrence.due_at,
      completedAt: occurrence.completed_at,
      decisionAt,
    });
    const responses: StandardsRecordedResponse[] = responseRows.map((row) => ({
      questionId: row.audit_item_id,
      wording: row.wording,
      answerLabel: safeOutcomeOption(row.outcome).label,
    }));
    return {
      cacheControl: "private, no-store",
      occurrenceId: occurrence.id,
      standardName: occurrence.standard_name,
      synthetic: occurrence.synthetic,
      ...(occurrence.synthetic_notice ? { syntheticNotice: occurrence.synthetic_notice } : {}),
      centreName: occurrence.centre_name,
      businessDate: occurrence.business_date,
      dueLocalTime: formatLocalMinute(occurrence.due_at, occurrence.centre_timezone),
      timeliness,
      state: occurrence.status,
      ...(occurrence.completed_at
        ? { completedLocalTime: formatLocalMinute(occurrence.completed_at, occurrence.centre_timezone) }
        : {}),
      questionCount: Number(occurrence.question_count),
      ...(occurrence.status === "OPEN" ? { canComplete: authority.canComplete } : {}),
      questions: buildQuestions(configurationRows),
      ...(occurrence.status === "COMPLETED" ? { responses } : {}),
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CentreStandardsError) throw error;
    throw new CentreStandardsError("context_unavailable", "check is temporarily unavailable", {
      cause: error,
    });
  }
}

function validateAnswers(
  request: CompleteStandardsCheckRequest,
  rows: readonly QuestionConfigurationRow[],
): Array<{ row: QuestionConfigurationRow; answer: AuditOutcome }> {
  const questionIds = [...new Set(rows.map((row) => row.item_id))];
  if (request.answers.length !== questionIds.length) {
    throw new CentreStandardsError("incomplete_response", "answer every question before submitting");
  }
  const submitted = new Map<string, string>();
  for (const answer of request.answers) {
    const questionId = requireStandardsUuid(answer.questionId, "question ID");
    if (submitted.has(questionId)) {
      throw new CentreStandardsError("invalid_input", "duplicate question answer");
    }
    submitted.set(questionId, answer.value);
  }
  return questionIds.map((questionId) => {
    const value = submitted.get(questionId);
    const row = rows.find((candidate) => candidate.item_id === questionId && candidate.outcome === value);
    if (!row) throw new CentreStandardsError("invalid_input", "answer is not permitted");
    return { row, answer: row.outcome };
  });
}

export async function completeStandardsCheck(
  input: { principalId: string; request: CompleteStandardsCheckRequest },
  dependencies: CentreStandardsDependencies = runtimeDependencies,
): Promise<CompleteStandardsCheckResponse> {
  const decisionAt = dependencies.now();
  const occurrenceId = requireStandardsUuid(input.request.occurrenceId, "occurrence ID");
  return inSerializableTransaction(async (transaction) => {
    const executor = countedExecutor(transaction, () => undefined);
    const principal = await loadPrincipalOrganisation(executor, input.principalId, decisionAt);
    const occurrence = await loadOccurrence(executor, principal.organisationId, occurrenceId, true);
    if (occurrence.status === "OPEN" && occurrence.opens_at.getTime() > decisionAt.getTime()) {
      throw new CentreStandardsError("not_found", "check is not available");
    }
    const authority = await loadCentreAuthority(
      executor,
      principal,
      occurrence.centre_id,
      decisionAt,
    );
    if (!authority.canComplete) {
      throw new CentreStandardsError("access_denied", "check is not available");
    }
    if (occurrence.status === "COMPLETED" && occurrence.completed_at) {
      return {
        outcome: "ALREADY_COMPLETED",
        completedAt: occurrence.completed_at.toISOString(),
        completedLocalTime: formatLocalMinute(
          occurrence.completed_at,
          occurrence.centre_timezone,
        ),
        completedByRequester: occurrence.completed_by_principal_id === principal.principalId,
      };
    }
    if (occurrence.opens_at.getTime() > decisionAt.getTime()) {
      throw new CentreStandardsError("invalid_state", "check is not open yet");
    }

    const rows = await loadQuestionConfigurations(
      executor,
      principal.organisationId,
      occurrence.template_version_id,
    );
    if (rows.length === 0) {
      throw new CentreStandardsError("invalid_state", "check configuration is unavailable");
    }
    const validated = validateAnswers(input.request, rows);
    const createsAction = validated.some(({ row }) => row.creates_action);
    const ownerPrincipalId = createsAction
      ? await listRemediationOwnerCandidatesFromSnapshot(
          executor,
          principal.organisationId,
          occurrence.centre_id,
          decisionAt,
          true,
        ).then((candidates) => {
          if (candidates.length !== 1) {
            throw new CentreStandardsError(
              "invalid_state",
              "one current remediation owner is required",
            );
          }
          return candidates[0].principalId;
        })
      : undefined;
    let issueRaised = false;
    for (const { row, answer } of validated) {
      const responseId = randomUUID();
      await executor.exec`
        INSERT INTO operational_check_responses (
          id, organisation_id, centre_id, occurrence_id, template_version_id,
          audit_item_id, outcome, responded_by_principal_id, responded_at
        ) VALUES (
          ${responseId}, ${principal.organisationId}, ${occurrence.centre_id},
          ${occurrence.id}, ${occurrence.template_version_id}, ${row.item_id},
          ${answer}, ${principal.principalId}, ${decisionAt}
        )
      `;
      if (!row.creates_action) continue;
      if (
        !row.creates_finding || !row.severity || row.due_days === null ||
        !row.required_remediation
      ) {
        throw new CentreStandardsError("invalid_state", "governed outcome is incomplete");
      }
      issueRaised = true;
      const findingId = randomUUID();
      const actionId = randomUUID();
      const marker = "SYNTHETIC STAGING TEST";
      const description = `${marker} — ${row.wording}: ${safeOutcomeOption(answer).label}.`;
      const requiredRemediation = row.required_remediation.startsWith(marker)
        ? row.required_remediation
        : `${marker} — ${row.required_remediation}`;
      await executor.exec`
        INSERT INTO findings (
          id, organisation_id, centre_id, source_family, check_response_id,
          item_lineage_key, severity, description, source_classification,
          status, created_by_principal_id, created_at, updated_at
        ) SELECT
          ${findingId}, ${principal.organisationId}, ${occurrence.centre_id},
          'OPERATIONAL_CHECK', ${responseId}, item.lineage_key, ${row.severity},
          ${description}, ${row.source_classification}, 'OPEN',
          ${principal.principalId}, ${decisionAt}, ${decisionAt}
        FROM audit_template_items AS item
        WHERE item.organisation_id = ${principal.organisationId}
          AND item.id = ${row.item_id}
          AND item.template_version_id = ${occurrence.template_version_id}
      `;
      await executor.exec`
        INSERT INTO corrective_actions (
          id, organisation_id, centre_id, finding_id, owner_principal_id,
          title, required_remediation, evidence_requirement, severity, due_at,
          independent_verification_required, status, created_at, updated_at
        ) VALUES (
          ${actionId}, ${principal.organisationId}, ${occurrence.centre_id},
          ${findingId}, ${ownerPrincipalId ?? null}, ${`${marker} — Centre Standard follow-up`},
          ${requiredRemediation}, 'none', ${row.severity},
          ${new Date(decisionAt.getTime() + row.due_days * 86_400_000)},
          ${row.independent_verification_required}, 'OPEN', ${decisionAt}, ${decisionAt}
        )
      `;
      await executor.exec`
        INSERT INTO corrective_action_events (
          id, organisation_id, corrective_action_id, actor_principal_id,
          event_type, from_status, to_status, reason, occurred_at, event_sequence
        ) VALUES (
          ${randomUUID()}, ${principal.organisationId}, ${actionId},
          ${principal.principalId}, 'operational_check.action_created', NULL,
          'OPEN', 'Created atomically from approved synthetic Centre Standards content.',
          ${decisionAt}, 1
        )
      `;
    }

    await executor.exec`
      UPDATE operational_check_occurrences
      SET status = 'COMPLETED',
          completed_by_principal_id = ${principal.principalId},
          completed_at = ${decisionAt},
          updated_at = ${decisionAt},
          lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId}
        AND id = ${occurrence.id}
        AND status = 'OPEN'
    `;
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_check.completed",
      resourceType: "operational_check_occurrence",
      resourceId: occurrence.id,
      scopeType: "centre",
      scopeId: occurrence.centre_id,
      context: { issueRaised, questionCount: validated.length },
      occurredAt: decisionAt,
    });
    return {
      outcome: "COMPLETED",
      completedAt: decisionAt.toISOString(),
      completedLocalTime: formatLocalMinute(decisionAt, occurrence.centre_timezone),
      issueRaised,
    };
  });
}
